package main

import (
	"log"
	"net"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Bans shared across the workspace: an address banned here is reported to
// the control plane with the heartbeat, which hands it to every other
// server of the workspace (command.firewall_bans, and the firewall payload
// for servers that reconnect later). A robot hammering one server is then
// cut off from all of them at once instead of being caught server by
// server.

type fwSharedBan struct {
	Kind    string `json:"kind"`
	Address string `json:"address"`
	Until   int64  `json:"until"`
	Strikes int    `json:"strikes"`
}

// Bans decided here since the last heartbeat, waiting to be reported.
var fwNewBans = struct {
	sync.Mutex
	list []fwSharedBan
}{}

// Cap on bans buffered between two heartbeats (a wave of robots).
const fwMaxNewBans = 500

func fwQueueNewBan(kind fwBanKind, key string, until int64, strikes int) {
	fwNewBans.Lock()
	defer fwNewBans.Unlock()
	if len(fwNewBans.list) >= fwMaxNewBans {
		return
	}
	fwNewBans.list = append(fwNewBans.list, fwSharedBan{Kind: string(kind), Address: key, Until: until, Strikes: strikes})
}

func fwDrainNewBans() []fwSharedBan {
	fwNewBans.Lock()
	defer fwNewBans.Unlock()
	out := fwNewBans.list
	fwNewBans.list = nil
	return out
}

// fwBanAddress reads a ban key back: one IPv4 address, or an IPv6 /64.
func fwBanAddress(key string) (net.IP, bool, bool) {
	if ip := net.ParseIP(key); ip != nil && ip.To4() != nil {
		return ip.To4(), false, true
	}
	ip, network, err := net.ParseCIDR(key)
	if err != nil || ip.To4() != nil {
		return nil, false, false
	}
	if ones, bits := network.Mask.Size(); ones != 64 || bits != 128 {
		return nil, false, false
	}
	return network.IP, true, true
}

// fwParseSharedBans reads the bans of a payload ("bans" or "sharedBans").
func fwParseSharedBans(raw interface{}) []fwSharedBan {
	items, _ := raw.([]interface{})
	var out []fwSharedBan
	for _, item := range items {
		entry, ok := item.(map[string]interface{})
		if !ok {
			continue
		}
		ban := fwSharedBan{
			Kind:    readString(entry, "kind"),
			Address: readString(entry, "address"),
			Strikes: readInt(entry, "strikes", 1),
		}
		switch until := entry["until"].(type) {
		case float64:
			ban.Until = int64(until)
		case string:
			ban.Until, _ = strconv.ParseInt(until, 10, 64)
		}
		out = append(out, ban)
	}
	return out
}

// fwApplySharedBans puts bans decided on other servers in place here, when
// this server has that kind of ban turned on and the address isn't one it
// exempts. Returns how many were added.
func fwApplySharedBans(bans []fwSharedBan, now time.Time) int {
	type pending struct {
		kind fwBanKind
		key  string
		v6   bool
		left time.Duration
	}
	var add []pending
	fwSSHBans.Lock()
	fwSSHBanLoadLocked()
	for _, ban := range bans {
		kind := fwBanKind(ban.Kind)
		cfg := fwSSHBans.cfg[kind]
		if cfg == nil || ban.Until <= now.Unix() {
			continue
		}
		ip, v6, ok := fwBanAddress(ban.Address)
		if !ok || fwContainsIP(fwNeverBanned, ip) || fwContainsIP(cfg.exempt, ip) {
			continue
		}
		// Never longer than a local ban could be.
		until := ban.Until
		if limit := now.Add(fwSSHBanMax).Unix(); until > limit {
			until = limit
		}
		entryKey := fwBanEntryKey(kind, ban.Address)
		entry := fwSSHBans.byKey[entryKey]
		if entry == nil {
			if len(fwSSHBans.byKey) >= fwSSHBanMaxTracked {
				fwSSHBanPruneLocked(now, true)
			}
			entry = &fwSSHBanEntry{}
			fwSSHBans.byKey[entryKey] = entry
		}
		// A repeat offence anywhere counts here too: the next local ban of
		// this address escalates from there.
		if ban.Strikes > entry.Strikes && ban.Strikes < 100 {
			entry.Strikes = ban.Strikes
		}
		if entry.Until >= until {
			continue
		}
		entry.Until = until
		entry.Failures = nil
		add = append(add, pending{kind, ban.Address, v6, time.Unix(until, 0).Sub(now)})
	}
	var snapshot map[string]fwSSHBanEntry
	if len(add) > 0 {
		snapshot = fwSSHBanSnapshotLocked(now)
	}
	fwSSHBans.Unlock()

	added := 0
	for _, ban := range add {
		if err := fwBanAdd(ban.kind, ban.key, ban.v6, ban.left); err != nil {
			log.Printf("firewall: cannot apply shared ban of %s: %v", ban.key, err)
			continue
		}
		added++
	}
	if snapshot != nil {
		fwSSHBanSave(snapshot)
	}
	if added > 0 {
		log.Printf("firewall: %d address(es) banned on another server of the workspace, banned here too", added)
	}
	return added
}

// ---------------------------------------------------------------------
// Failed SSH connections
// ---------------------------------------------------------------------

// sshd's last word on a connection that never logged in: "Connection
// closed by invalid user admin 203.0.113.9 port 51234 [preauth]". Robots
// facing a server without passwords never get a "Failed password" line,
// only this one. Only connections that named a user count: a port probe or
// ssh-keyscan never does. The greedy ".*" keeps the last "<ip> port", so a
// crafted user name can't frame another address.
var fwSSHGaveUpPattern = regexp.MustCompile(`^(?:Connection (?:closed|reset) by|Disconnected from) (?:authenticating|invalid) user (?:.* )?(\S+) port (\d+) \[preauth\]\s*$`)

var fwSSHFailedPortPattern = regexp.MustCompile(` from (\S+) port (\d+)(?: ssh2)?\s*$`)

// fwSSHConnections remembers the connections already counted (a failed
// password), so their closing line doesn't count them a second time.
type fwSSHConnections struct {
	counted map[string]int64
}

const fwSSHConnMemory = 10 * 60

// observe returns the address to count a failure for, if the line is one:
// each failed password, or the end of a connection that failed without
// one. A mistyped password followed by a success is one failure, as before.
func (c *fwSSHConnections) observe(line string, now time.Time) (net.IP, bool) {
	if c.counted == nil {
		c.counted = map[string]int64{}
	}
	line = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), "error: "))
	if ip, ok := fwSSHFailureSource(line); ok {
		if match := fwSSHFailedPortPattern.FindStringSubmatch(line); match != nil {
			c.remember(ip.String()+"|"+match[2], now)
		}
		return ip, true
	}
	match := fwSSHGaveUpPattern.FindStringSubmatch(line)
	if match == nil {
		return nil, false
	}
	ip := net.ParseIP(match[1])
	if ip == nil {
		return nil, false
	}
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	key := ip.String() + "|" + match[2]
	if _, done := c.counted[key]; done {
		delete(c.counted, key)
		return nil, false
	}
	return ip, true
}

func (c *fwSSHConnections) remember(key string, now time.Time) {
	if len(c.counted) > 5000 {
		cutoff := now.Unix() - fwSSHConnMemory
		for k, at := range c.counted {
			if at < cutoff {
				delete(c.counted, k)
			}
		}
	}
	c.counted[key] = now.Unix()
}
