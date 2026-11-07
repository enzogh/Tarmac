package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

// Bans, in two kinds:
//   - ssh: on top of the connection limiter (TARMAC-FW-SSH), the agent reads
//     sshd's log and bans from SSH an address that keeps failing to log in
//     (each wrong password, or each connection given up without logging in,
//     see fwSSHConnections). Robots guessing passwords are often slow (one
//     try every few minutes): they never trip a per-minute limit, but they
//     do pile up failures.
// Every ban is shared with the other servers of the workspace, see
// firewall_banshare.go.
//   - all: an address that keeps knocking on rpcbind over TCP (counted by the
//     kernel, see TARMAC-FW-RPC) is cut off from the whole server. Only TCP
//     counts: a UDP source address is trivially forged, and a forged flood
//     must not get somebody else banned.
// Bans live in ipsets with a timeout, so the kernel lifts them by itself;
// repeat offenders get longer and longer bans.
type fwBanKind string

const (
	fwBanSSH fwBanKind = "ssh"
	fwBanAll fwBanKind = "all"
)

func fwBanSet(kind fwBanKind, v6 bool) string {
	if kind == fwBanAll {
		if v6 {
			return fwBanAllSet6
		}
		return fwBanAllSet4
	}
	if v6 {
		return fwSSHBanSet6
	}
	return fwSSHBanSet4
}

const (
	fwSSHBanSet4 = "tarmac-sshban4"
	fwSSHBanSet6 = "tarmac-sshban6"
	fwBanAllSet4 = "tarmac-ban4"
	fwBanAllSet6 = "tarmac-ban6"
	// Failed logins are counted over this sliding window.
	fwSSHBanWindow = time.Hour
	// Each repeat offence multiplies the previous ban by this factor...
	fwSSHBanFactor = 6
	// ...up to this ceiling.
	fwSSHBanMax = 7 * 24 * time.Hour
	// A ban is forgotten (the next one starts over) this long after it ends.
	fwSSHBanMemory = 7 * 24 * time.Hour
	// Addresses tracked at once; the stalest go first beyond it.
	fwSSHBanMaxTracked = 20000
)

type fwSSHBan struct {
	attempts int
	minutes  int
	escalate bool
	// Never banned (all kind; the ssh kind uses the limiter's exemptions).
	exempt []string
}

type fwSSHBanEntry struct {
	Failures []int64 `json:"-"`
	Strikes  int     `json:"strikes"`
	Until    int64   `json:"until"`
}

type fwBanConfig struct {
	ban    fwSSHBan
	exempt []*net.IPNet
}

var fwSSHBans = struct {
	sync.Mutex
	cfg     map[fwBanKind]*fwBanConfig
	port    int
	byKey   map[string]*fwSSHBanEntry // "<kind>|<address>"
	loaded  bool
	running bool
}{cfg: map[fwBanKind]*fwBanConfig{}, byKey: map[string]*fwSSHBanEntry{}}

func fwBanEntryKey(kind fwBanKind, key string) string {
	return string(kind) + "|" + key
}

// fwSplitBanKey: saved before kinds existed, a bare address is an SSH ban.
func fwSplitBanKey(raw string) (fwBanKind, string) {
	if kind, key, ok := strings.Cut(raw, "|"); ok {
		return fwBanKind(kind), key
	}
	return fwBanSSH, raw
}

func fwSSHBanStatePath() string {
	return envOrDefault("AGENT_SSH_BAN_STATE_PATH", "/var/lib/tarmac-agent/ssh-bans.json")
}

// "Failed password for invalid user admin from 203.0.113.9 port 51234 ssh2".
// The greedy ".*" keeps the LAST "from <ip> port", so a user name crafted
// to contain one can't get somebody else banned.
var fwSSHFailedPattern = regexp.MustCompile(`^(?:error: )?Failed (\S+) for .* from (\S+) port \d+(?: ssh2)?\s*$`)

// fwSSHFailureSource returns the address a sshd log line reports as having
// failed to log in. A rejected key (the client trying its keys one by one)
// or the "none" probe every client starts with don't count.
func fwSSHFailureSource(line string) (net.IP, bool) {
	match := fwSSHFailedPattern.FindStringSubmatch(strings.TrimSpace(line))
	if match == nil {
		return nil, false
	}
	if method := match[1]; method == "publickey" || method == "none" {
		return nil, false
	}
	ip := net.ParseIP(match[2])
	if ip == nil {
		return nil, false
	}
	if v4 := ip.To4(); v4 != nil {
		ip = v4
	}
	return ip, true
}

// fwSSHBanKey: one IPv4 address, or the /64 an IPv6 address belongs to
// (like the limiter: a single host owns a whole /64).
func fwSSHBanKey(ip net.IP) string {
	if v4 := ip.To4(); v4 != nil {
		return v4.String()
	}
	network := &net.IPNet{IP: ip.Mask(net.CIDRMask(64, 128)), Mask: net.CIDRMask(64, 128)}
	return network.String()
}

var fwNeverBanned = func() []*net.IPNet {
	var out []*net.IPNet
	for _, cidr := range []string{"10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "169.254.0.0/16", "127.0.0.0/8", "fc00::/7", "fe80::/10", "::1/128"} {
		_, network, _ := net.ParseCIDR(cidr)
		out = append(out, network)
	}
	return out
}()

func fwContainsIP(networks []*net.IPNet, ip net.IP) bool {
	for _, network := range networks {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

// fwSSHBanDuration: the base ban, multiplied by the factor for every
// earlier offence still remembered, capped.
func fwSSHBanDuration(cfg fwSSHBan, strike int) time.Duration {
	duration := time.Duration(cfg.minutes) * time.Minute
	if !cfg.escalate {
		return duration
	}
	for i := 1; i < strike && duration < fwSSHBanMax; i++ {
		duration *= fwSSHBanFactor
	}
	if duration > fwSSHBanMax {
		duration = fwSSHBanMax
	}
	return duration
}

// fwSSHBanRecord counts one failed login and says how long to ban the
// address for (0: not yet, or already banned). Pure but for the entry.
func fwSSHBanRecord(entry *fwSSHBanEntry, cfg fwSSHBan, now time.Time) time.Duration {
	if entry.Until > now.Unix() {
		// Already banned: a failure here comes from a session opened before.
		return 0
	}
	cutoff := now.Add(-fwSSHBanWindow).Unix()
	kept := entry.Failures[:0]
	for _, at := range entry.Failures {
		if at > cutoff {
			kept = append(kept, at)
		}
	}
	entry.Failures = append(kept, now.Unix())
	if len(entry.Failures) < cfg.attempts {
		return 0
	}
	if entry.Until == 0 || now.Unix()-entry.Until > int64(fwSSHBanMemory/time.Second) {
		entry.Strikes = 0
	}
	entry.Strikes++
	duration := fwSSHBanDuration(cfg, entry.Strikes)
	entry.Until = now.Add(duration).Unix()
	entry.Failures = nil
	return duration
}

func fwParseNetworks(cidrs []string) []*net.IPNet {
	var out []*net.IPNet
	for _, cidr := range cidrs {
		if _, network, err := net.ParseCIDR(cidr); err == nil {
			out = append(out, network)
		}
	}
	return out
}

// fwConfigureBans is called on every firewall apply: a nil ban turns that
// kind off.
func fwConfigureBans(limit *fwSSHLimit, guard *fwRPCGuard) {
	fwSSHBans.Lock()
	defer fwSSHBans.Unlock()
	delete(fwSSHBans.cfg, fwBanSSH)
	delete(fwSSHBans.cfg, fwBanAll)
	if limit != nil && limit.ban != nil {
		fwSSHBans.cfg[fwBanSSH] = &fwBanConfig{ban: *limit.ban, exempt: fwParseNetworks(limit.exempt)}
		fwSSHBans.port = 22
		if len(limit.ports) > 0 {
			fmt.Sscanf(limit.ports[0], "%d", &fwSSHBans.port)
		}
	}
	if guard != nil && guard.ban != nil {
		// The kernel already counted the attempts: the first report bans.
		ban := *guard.ban
		ban.attempts = 1
		fwSSHBans.cfg[fwBanAll] = &fwBanConfig{ban: ban, exempt: fwParseNetworks(append(append([]string{}, guard.ban.exempt...), guard.exempt...))}
	}
}

// fwConfigureSSHBan: SSH bans only (tests, older callers).
func fwConfigureSSHBan(limit *fwSSHLimit) {
	fwConfigureBans(limit, nil)
}

// fwBanCount: addresses of this kind banned right now.
func fwBanCount(kind fwBanKind) int {
	fwSSHBans.Lock()
	defer fwSSHBans.Unlock()
	if fwSSHBans.cfg[kind] == nil {
		return 0
	}
	now := time.Now().Unix()
	count := 0
	for raw, entry := range fwSSHBans.byKey {
		if k, _ := fwSplitBanKey(raw); k == kind && entry.Until > now {
			count++
		}
	}
	return count
}

func fwSSHBanCount() int { return fwBanCount(fwBanSSH) }

// fwSSHBanFailure handles one failed login read from sshd's log.
func fwSSHBanFailure(ip net.IP, now time.Time) {
	fwBanOffence(fwBanSSH, ip, now)
}

// fwRPCBanTrigger: the kernel saw this address knock on rpcbind over TCP
// too often (TFW:Q).
func fwRPCBanTrigger(ip net.IP, now time.Time) {
	fwBanOffence(fwBanAll, ip, now)
}

func fwBanOffence(kind fwBanKind, ip net.IP, now time.Time) {
	fwSSHBans.Lock()
	cfg := fwSSHBans.cfg[kind]
	if cfg == nil || fwContainsIP(fwNeverBanned, ip) || fwContainsIP(cfg.exempt, ip) {
		fwSSHBans.Unlock()
		return
	}
	key := fwSSHBanKey(ip)
	entryKey := fwBanEntryKey(kind, key)
	entry := fwSSHBans.byKey[entryKey]
	if entry == nil {
		if len(fwSSHBans.byKey) >= fwSSHBanMaxTracked {
			fwSSHBanPruneLocked(now, true)
		}
		entry = &fwSSHBanEntry{}
		fwSSHBans.byKey[entryKey] = entry
	}
	duration := fwSSHBanRecord(entry, cfg.ban, now)
	strikes := entry.Strikes
	until := entry.Until
	port := fwSSHBans.port
	var snapshot map[string]fwSSHBanEntry
	if duration > 0 {
		snapshot = fwSSHBanSnapshotLocked(now)
	}
	fwSSHBans.Unlock()
	if duration == 0 {
		return
	}

	if err := fwBanAdd(kind, key, ip.To4() == nil, duration); err != nil {
		log.Printf("firewall: cannot ban %s: %v", key, err)
		return
	}
	// Reported with the next heartbeat, for the other servers of the workspace.
	fwQueueNewBan(kind, key, until, strikes)
	if kind == fwBanAll {
		log.Printf("firewall: %s banned from the whole server for %s (rpcbind spam, offence #%d)", key, duration, strikes)
	} else {
		log.Printf("firewall: %s banned from SSH for %s (offence #%d)", key, duration, strikes)
		fwRecordEvent(fwEvent{Verdict: "blocked", RuleID: fwSSHBanID, Source: ip.String(), Protocol: "tcp", Port: port, Count: 1}, now)
	}
	fwSSHBanSave(snapshot)
}

// fwSSHBanPruneLocked drops addresses with nothing left to remember; when
// aggressive (the table is full), also those only counting failures.
func fwSSHBanPruneLocked(now time.Time, aggressive bool) {
	forget := now.Add(-fwSSHBanMemory).Unix()
	cutoff := now.Add(-fwSSHBanWindow).Unix()
	for key, entry := range fwSSHBans.byKey {
		recent := len(entry.Failures) > 0 && entry.Failures[len(entry.Failures)-1] > cutoff
		if entry.Until < forget && (aggressive || !recent) {
			delete(fwSSHBans.byKey, key)
		}
	}
}

func fwSSHBanSnapshotLocked(now time.Time) map[string]fwSSHBanEntry {
	fwSSHBanPruneLocked(now, false)
	out := map[string]fwSSHBanEntry{}
	for key, entry := range fwSSHBans.byKey {
		if entry.Until > 0 {
			out[key] = fwSSHBanEntry{Strikes: entry.Strikes, Until: entry.Until}
		}
	}
	return out
}

func fwSSHBanSave(snapshot map[string]fwSSHBanEntry) {
	data, err := json.Marshal(snapshot)
	if err != nil {
		return
	}
	path := fwSSHBanStatePath()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err == nil {
		_ = os.Rename(tmp, path)
	}
}

// fwSSHBanLoadLocked reads the bans and offences saved before a restart
// (or a reboot, which empties the ipsets), once.
func fwSSHBanLoadLocked() {
	if fwSSHBans.loaded {
		return
	}
	fwSSHBans.loaded = true
	data, err := os.ReadFile(fwSSHBanStatePath())
	if err != nil {
		return
	}
	saved := map[string]fwSSHBanEntry{}
	if err := json.Unmarshal(data, &saved); err != nil {
		return
	}
	for key, entry := range saved {
		entry := entry
		fwSSHBans.byKey[key] = &entry
	}
}

func fwBanAdd(kind fwBanKind, key string, v6 bool, duration time.Duration) error {
	set := fwBanSet(kind, v6)
	seconds := int(duration / time.Second)
	if seconds < 1 {
		seconds = 1
	}
	out, err := exec.Command("ipset", "add", set, key, "timeout", fmt.Sprint(seconds), "-exist").CombinedOutput()
	if err != nil {
		return fmt.Errorf("ipset add: %s", strings.TrimSpace(string(out)))
	}
	return nil
}

// fwEnsureSSHBanSets creates the ban sets of a kind (before a rule
// references them) and puts back its bans still running.
func fwEnsureSSHBanSets(ctx context.Context) error {
	return fwEnsureBanSets(ctx, fwBanSSH)
}

func fwEnsureBanSets(ctx context.Context, kind fwBanKind) error {
	if _, err := ensureAgentSystemPackages(ctx, []string{"ipset"}); err != nil || !commandExists("ipset") {
		return errors.New("le paquet ipset est requis pour bannir des adresses et n’a pas pu être installé")
	}
	script := fmt.Sprintf("create %s hash:ip family inet timeout 0 maxelem 65536 -exist\ncreate %s hash:net family inet6 timeout 0 maxelem 65536 -exist\n", fwBanSet(kind, false), fwBanSet(kind, true))
	cmd := exec.CommandContext(ctx, "ipset", "restore")
	cmd.Stdin = strings.NewReader(script)
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("ipset restore: %s", strings.TrimSpace(string(out)))
	}

	fwSSHBans.Lock()
	fwSSHBanLoadLocked()
	now := time.Now()
	type pending struct {
		key  string
		v6   bool
		left time.Duration
	}
	var restore []pending
	for raw, entry := range fwSSHBans.byKey {
		k, key := fwSplitBanKey(raw)
		if k != kind {
			continue
		}
		if left := time.Unix(entry.Until, 0).Sub(now); left > 0 {
			restore = append(restore, pending{key, strings.Contains(key, ":"), left})
		}
	}
	fwSSHBans.Unlock()
	sort.Slice(restore, func(i, j int) bool { return restore[i].key < restore[j].key })
	for _, ban := range restore {
		if err := fwBanAdd(kind, ban.key, ban.v6, ban.left); err != nil {
			return err
		}
	}
	return nil
}

// fwDestroyBanSets, once no rule references them any more (kind off).
func fwDestroyBanSets(kind fwBanKind) {
	if !commandExists("ipset") {
		return
	}
	for _, v6 := range []bool{false, true} {
		_ = exec.Command("ipset", "destroy", fwBanSet(kind, v6)).Run()
	}
}

func fwDestroySSHBanSets() { fwDestroyBanSets(fwBanSSH) }

// startSSHAuthLogReader follows sshd's messages in the journal for the life
// of the agent; failures only count while bans are on (fwConfigureSSHBan).
func startSSHAuthLogReader() {
	if !commandExists("journalctl") {
		log.Printf("firewall: journalctl unavailable, failed SSH logins won't lead to bans")
		return
	}
	fwSSHBans.Lock()
	if fwSSHBans.running {
		fwSSHBans.Unlock()
		return
	}
	fwSSHBans.running = true
	fwSSHBans.Unlock()
	go func() {
		for {
			// _COMM: sshd, or sshd-session for OpenSSH 9.8+ (one per connection).
			cmd := exec.Command("journalctl", "--follow", "--lines=0", "--output=cat", "_COMM=sshd", "_COMM=sshd-session")
			stdout, err := cmd.StdoutPipe()
			if err == nil {
				err = cmd.Start()
			}
			if err != nil {
				log.Printf("firewall: cannot follow sshd's log: %v", err)
				time.Sleep(30 * time.Second)
				continue
			}
			scanner := bufio.NewScanner(stdout)
			scanner.Buffer(make([]byte, 64*1024), 64*1024)
			connections := &fwSSHConnections{}
			for scanner.Scan() {
				if ip, ok := connections.observe(scanner.Text(), time.Now()); ok {
					fwSSHBanFailure(ip, time.Now())
				}
			}
			_ = cmd.Wait()
			time.Sleep(10 * time.Second)
		}
	}()
}
