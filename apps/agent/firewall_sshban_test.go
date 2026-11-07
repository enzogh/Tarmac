package main

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestSSHFailureSource(t *testing.T) {
	cases := map[string]string{
		"Failed password for ubuntu from 203.0.113.9 port 51234 ssh2":                                  "203.0.113.9",
		"Failed password for invalid user admin from 198.51.100.4 port 40000 ssh2":                     "198.51.100.4",
		"Failed keyboard-interactive/pam for root from 2001:db8::7 port 22 ssh2":                       "2001:db8::7",
		"error: Failed password for root from 192.0.2.1 port 1 ssh2":                                   "192.0.2.1",
		"Failed password for invalid user x from 192.0.2.66 port 1 ssh2 from 203.0.113.50 port 2 ssh2": "203.0.113.50",
		// A user name crafted to frame another address: the real one is last.
		"Failed password for invalid user a from 192.0.2.66 port 1 from 203.0.113.51 port 2 ssh2": "203.0.113.51",
		"Failed publickey for ubuntu from 203.0.113.9 port 51234 ssh2":                            "",
		"Failed none for invalid user a from 203.0.113.9 port 51234 ssh2":                         "",
		"Invalid user admin from 203.0.113.9 port 51234":                                          "",
		"Accepted password for ubuntu from 203.0.113.9 port 51234 ssh2":                           "",
		"Connection closed by authenticating user ubuntu 203.0.113.9 port 51234 [preauth]":        "",
	}
	for line, want := range cases {
		ip, ok := fwSSHFailureSource(line)
		got := ""
		if ok {
			got = ip.String()
		}
		if got != want {
			t.Errorf("%q: got %q, want %q", line, got, want)
		}
	}
}

func TestSSHBanKey(t *testing.T) {
	ip, _ := fwSSHFailureSource("Failed password for a from 2001:db8:1:2:3:4:5:6 port 1 ssh2")
	if got := fwSSHBanKey(ip); got != "2001:db8:1:2::/64" {
		t.Errorf("IPv6 bans cover the /64, got %s", got)
	}
	ip, _ = fwSSHFailureSource("Failed password for a from 203.0.113.9 port 1 ssh2")
	if got := fwSSHBanKey(ip); got != "203.0.113.9" {
		t.Errorf("got %s", got)
	}
}

func TestSSHBanEscalation(t *testing.T) {
	cfg := fwSSHBan{attempts: 3, minutes: 10, escalate: true}
	want := []time.Duration{10 * time.Minute, time.Hour, 6 * time.Hour, 36 * time.Hour, fwSSHBanMax, fwSSHBanMax}
	for strike, duration := range want {
		if got := fwSSHBanDuration(cfg, strike+1); got != duration {
			t.Errorf("offence #%d: got %s, want %s", strike+1, got, duration)
		}
	}
	if got := fwSSHBanDuration(fwSSHBan{attempts: 3, minutes: 10}, 4); got != 10*time.Minute {
		t.Errorf("without escalation every ban lasts the base: %s", got)
	}

	entry := &fwSSHBanEntry{}
	now := time.Unix(1_800_000_000, 0)
	fail := func(at time.Time) time.Duration { return fwSSHBanRecord(entry, cfg, at) }

	// Two failures, then the third within the hour: banned 10 min.
	if fail(now) != 0 || fail(now.Add(20*time.Minute)) != 0 {
		t.Fatal("banned too early")
	}
	if got := fail(now.Add(40 * time.Minute)); got != 10*time.Minute {
		t.Fatalf("third failure must ban for 10 min, got %s", got)
	}
	// Failures during the ban (sessions opened before) don't stack.
	if fail(now.Add(45*time.Minute)) != 0 {
		t.Error("a failure during a ban must not re-ban")
	}
	// Slow failures, more than an hour apart, never add up.
	slow := &fwSSHBanEntry{}
	for i := 0; i < 10; i++ {
		if fwSSHBanRecord(slow, cfg, now.Add(time.Duration(i)*61*time.Minute)) != 0 {
			t.Fatal("failures spread over more than the window must not ban")
		}
	}

	// Back after the ban: the next ban is 6 times longer.
	after := now.Add(2 * time.Hour)
	fail(after)
	fail(after.Add(time.Minute))
	if got := fail(after.Add(2 * time.Minute)); got != time.Hour {
		t.Fatalf("second offence must last 1 h, got %s", got)
	}
	// Long after (memory elapsed): starts over at 10 min.
	later := time.Unix(entry.Until, 0).Add(fwSSHBanMemory + time.Hour)
	fail(later)
	fail(later.Add(time.Minute))
	if got := fail(later.Add(2 * time.Minute)); got != 10*time.Minute || entry.Strikes != 1 {
		t.Fatalf("a forgotten offender starts over, got %s (strike %d)", got, entry.Strikes)
	}
}

func TestSSHBanSkipsPrivateAndExempt(t *testing.T) {
	limit := &fwSSHLimit{ports: []string{"22"}, exempt: []string{"198.51.100.7/32"}, ban: &fwSSHBan{attempts: 1, minutes: 10}}
	fwConfigureSSHBan(limit)
	defer fwConfigureSSHBan(nil)
	for _, raw := range []string{"10.255.0.5", "192.168.1.2", "198.51.100.7", "fe80::1"} {
		ip, _ := fwSSHFailureSource("Failed password for a from " + raw + " port 1 ssh2")
		fwSSHBanFailure(ip, time.Now())
	}
	fwSSHBans.Lock()
	tracked := len(fwSSHBans.byKey)
	fwSSHBans.Unlock()
	if tracked != 0 {
		t.Errorf("private and exempt addresses must never be counted, %d tracked", tracked)
	}
}

func TestFirewallSSHBanPlan(t *testing.T) {
	desired := fwTestPayload(t, `{"revision":"1","public":{"mode":"open"},
		"sshLimit":{"ports":["22"],"exempt":["198.51.100.7"],"ban":{"attempts":5,"minutes":10,"escalate":true}}}`)
	if ban := desired.sshLimit.ban; ban == nil || ban.attempts != 5 || ban.minutes != 10 || !ban.escalate {
		t.Fatalf("ban not parsed: %+v", desired.sshLimit.ban)
	}
	for v6, set := range map[bool]string{false: "tarmac-sshban4", true: "tarmac-sshban6"} {
		plan := buildFirewallPlan(desired, v6, []string{"eth0"}, false)
		ssh := fwJoin(fwChain(plan, fwChainSSH).rules)
		banRule := "-m set --match-set " + set + " src -j TARMAC-FW-SSH-B"
		at := strings.Index(ssh, banRule)
		if at < 0 || at > strings.Index(ssh, "hashlimit") {
			t.Errorf("ban check must come before the limiter:\n%s", ssh)
		}
		if !v6 && at < strings.Index(ssh, "-s 198.51.100.7/32 -j RETURN") {
			t.Errorf("exempt addresses must skip the ban check:\n%s", ssh)
		}
		b := fwChain(plan, fwChainSSHB)
		if b == nil || !strings.HasSuffix(fwJoin(b.rules), "--comment tarmac-fw:ssh-ban -j DROP") || !strings.Contains(fwJoin(b.rules), "TFW:K ") {
			t.Errorf("ban chain wrong: %+v", b)
		}
		order := map[string]int{}
		for i, chain := range plan.chains {
			order[chain.chain] = i
		}
		if order[fwChainSSHB] > order[fwChainSSH] {
			t.Error("ban chain must exist before the SSH chain jumps to it")
		}
	}

	// Ban off: the limiter stays, the ban chain goes.
	plain := fwTestPayload(t, `{"revision":"2","sshLimit":{"ports":["22"]}}`)
	plan := buildFirewallPlan(plain, false, []string{"eth0"}, false)
	if fwChain(plan, fwChainSSHB) != nil || strings.Contains(fwJoin(fwChain(plan, fwChainSSH).rules), "match-set") {
		t.Error("ban rules must be gone when bans are off")
	}

	for _, raw := range []string{
		`{"sshLimit":{"ports":["22"],"ban":{"attempts":0,"minutes":10}}}`,
		`{"sshLimit":{"ports":["22"],"ban":{"attempts":5,"minutes":0}}}`,
	} {
		desired := map[string]interface{}{}
		_ = jsonUnmarshal(raw, &desired)
		if _, err := parseFirewallPayload(desired); err == nil {
			t.Errorf("expected an error for %s", raw)
		}
	}
	event, ok := fwParseLogLine("TFW:K IN=eth0 OUT= SRC=203.0.113.9 DST=198.51.100.1 PROTO=TCP SPT=50000 DPT=22", nil)
	if !ok || event.RuleID != "ssh-ban" || event.Verdict != "blocked" {
		t.Errorf("bad ban event: %+v", event)
	}
}

func jsonUnmarshal(raw string, into interface{}) error {
	return json.Unmarshal([]byte(raw), into)
}

func TestFirewallRPCBanPlan(t *testing.T) {
	desired := fwTestPayload(t, `{"revision":"1","public":{"mode":"open"},
		"rpcGuard":{"ports":["111"],"exempt":["198.51.100.7"],"ban":{"attempts":10,"minutes":10,"escalate":true,"exempt":["51.68.36.61","2001:db8:9::1"]}}}`)
	if b := desired.rpcGuard.ban; b == nil || b.attempts != 10 || len(b.exempt) != 2 {
		t.Fatalf("ban not parsed: %+v", desired.rpcGuard.ban)
	}
	plan := buildFirewallPlan(desired, false, []string{"eth0"}, true)
	pub := fwJoin(fwChain(plan, fwChainPub).rules)
	if !strings.HasPrefix(pub, "-m set --match-set tarmac-ban4 src -j TARMAC-FW-BAN\n-m conntrack --ctstate RELATED,ESTABLISHED -j RETURN") {
		t.Errorf("the ban check must come first, before established:\n%s", pub)
	}
	if pubD := fwJoin(fwChain(plan, fwChainPubD).rules); !strings.HasPrefix(pubD, "-m set --match-set tarmac-ban4 src -j TARMAC-FW-BAN") {
		t.Errorf("ports published by Docker must be banned too:\n%s", pubD)
	}
	ban := fwJoin(fwChain(plan, fwChainBan).rules)
	for _, want := range []string{"-s 51.68.36.61/32 -j RETURN", "-s 198.51.100.7/32 -j RETURN", "TFW:A ", "--comment tarmac-fw:rpc-ban -j DROP"} {
		if !strings.Contains(ban, want) {
			t.Errorf("missing %q in ban chain:\n%s", want, ban)
		}
	}
	if strings.Contains(ban, "2001:db8") {
		t.Errorf("IPv6 exemption in the IPv4 chain:\n%s", ban)
	}
	rpc := fwJoin(fwChain(plan, fwChainRPC).rules)
	trigger := "-p tcp --syn -m hashlimit --hashlimit-above 10/hour --hashlimit-burst 10"
	if !strings.Contains(rpc, trigger) || !strings.Contains(rpc, "TFW:Q ") || strings.Contains(rpc, "-p udp --syn") {
		t.Errorf("only TCP may trigger a ban:\n%s", rpc)
	}
	if strings.Index(rpc, trigger) > strings.Index(rpc, "tarmac-fw:rpc-guard -j DROP") || strings.Index(rpc, trigger) < strings.Index(rpc, "-s 198.51.100.7/32 -j RETURN") {
		t.Errorf("trigger must sit between the exemptions and the drop:\n%s", rpc)
	}
	order := map[string]int{}
	for i, chain := range plan.chains {
		order[chain.chain] = i
	}
	if order[fwChainBan] > order[fwChainPub] || order[fwChainBan] > order[fwChainPubD] {
		t.Errorf("ban chain must exist before the chains jumping to it: %v", order)
	}
	v6 := fwJoin(fwChain(buildFirewallPlan(desired, true, []string{"eth0"}, false), fwChainBan).rules)
	if !strings.Contains(v6, "-s 2001:db8:9::1/128 -j RETURN") {
		t.Errorf("IPv6 exemption missing:\n%s", v6)
	}

	// Ban off: guard alone, no ban chain nor set reference.
	off := fwTestPayload(t, `{"revision":"2","rpcGuard":{"ports":["111"]}}`)
	plan = buildFirewallPlan(off, false, []string{"eth0"}, false)
	if fwChain(plan, fwChainBan) != nil || strings.Contains(fwJoin(fwChain(plan, fwChainPub).rules), "tarmac-ban4") || strings.Contains(fwJoin(fwChain(plan, fwChainRPC).rules), "TFW:Q") {
		t.Error("ban rules must be gone when rpcbind bans are off")
	}

	event, ok := fwParseLogLine("TFW:Q IN=eth0 OUT= SRC=203.0.113.9 DST=198.51.100.1 PROTO=TCP SPT=50000 DPT=111", nil)
	if !ok || event.RuleID != "rpc-ban" || !event.trigger {
		t.Errorf("bad trigger event: %+v", event)
	}
	event, ok = fwParseLogLine("TFW:A IN=eth0 OUT= SRC=203.0.113.9 DST=198.51.100.1 PROTO=TCP SPT=50000 DPT=443", nil)
	if !ok || event.RuleID != "rpc-ban" || event.trigger {
		t.Errorf("bad banned-drop event: %+v", event)
	}
}

func TestBanKindsAreIndependent(t *testing.T) {
	limit := &fwSSHLimit{ports: []string{"22"}, ban: &fwSSHBan{attempts: 3, minutes: 10}}
	guard := &fwRPCGuard{ports: []string{"111"}, ban: &fwSSHBan{attempts: 10, minutes: 10, escalate: true, exempt: []string{"51.68.36.61/32"}}}
	fwConfigureBans(limit, guard)
	defer fwConfigureBans(nil, nil)
	fwSSHBans.Lock()
	all := fwSSHBans.cfg[fwBanAll]
	ssh := fwSSHBans.cfg[fwBanSSH]
	fwSSHBans.Unlock()
	if all == nil || all.ban.attempts != 1 || ssh == nil || ssh.ban.attempts != 3 {
		t.Fatalf("kernel-counted bans must trigger at once, SSH ones count failures: %+v %+v", all, ssh)
	}
	// A Tarmac server is never banned.
	ip, _ := fwSSHFailureSource("Failed password for a from 51.68.36.61 port 1 ssh2")
	fwRPCBanTrigger(ip, time.Now())
	fwSSHBans.Lock()
	_, tracked := fwSSHBans.byKey[fwBanEntryKey(fwBanAll, "51.68.36.61")]
	fwSSHBans.Unlock()
	if tracked {
		t.Error("an exempt address must never be banned")
	}
	if kind, key := fwSplitBanKey("203.0.113.9"); kind != fwBanSSH || key != "203.0.113.9" {
		t.Error("bans saved before kinds existed are SSH bans")
	}
	if kind, key := fwSplitBanKey("all|2001:db8::/64"); kind != fwBanAll || key != "2001:db8::/64" {
		t.Error("bad kinded key")
	}
}

func TestSSHConnectionsCountEachFailedConnectionOnce(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	c := &fwSSHConnections{}
	count := func(lines ...string) int {
		n := 0
		for _, line := range lines {
			if _, ok := c.observe(line, now); ok {
				n++
			}
		}
		return n
	}
	// Key-only server: robots only ever leave the closing line.
	if got := count(
		"Invalid user admin from 203.0.113.9 port 40001",
		"Connection closed by invalid user admin 203.0.113.9 port 40001 [preauth]",
		"Connection closed by authenticating user root 203.0.113.9 port 40002 [preauth]",
		"Disconnected from invalid user oracle 203.0.113.9 port 40003 [preauth]",
		"Connection reset by authenticating user root 203.0.113.9 port 40004 [preauth]",
	); got != 4 {
		t.Errorf("connections given up: got %d, want 4", got)
	}
	// Password server: each wrong password counts, the close line doesn't add one.
	if got := count(
		"Failed password for root from 198.51.100.4 port 5000 ssh2",
		"Failed password for root from 198.51.100.4 port 5000 ssh2",
		"Connection closed by authenticating user root 198.51.100.4 port 5000 [preauth]",
	); got != 2 {
		t.Errorf("wrong passwords: got %d, want 2", got)
	}
	// Port probes and ssh-keyscan name no user: not counted.
	if got := count(
		"Connection closed by 192.0.2.7 port 6000 [preauth]",
		"Received disconnect from 192.0.2.7 port 6001:11: Bye Bye [preauth]",
		"error: kex_exchange_identification: Connection closed by remote host",
		"Accepted publickey for ubuntu from 192.0.2.8 port 6002 ssh2",
	); got != 0 {
		t.Errorf("probes: got %d, want 0", got)
	}
	// A crafted user name can't frame another address.
	ip, ok := c.observe("Connection closed by invalid user x 192.0.2.66 port 1 203.0.113.50 port 7000 [preauth]", now)
	if !ok || ip.String() != "203.0.113.50" {
		t.Errorf("crafted user name: got %v", ip)
	}
	// An empty user name.
	ip, ok = c.observe("Connection closed by invalid user  203.0.113.51 port 7001 [preauth]", now)
	if !ok || ip.String() != "203.0.113.51" {
		t.Errorf("empty user name: got %v", ip)
	}
}

func TestSharedBansApplyOnlyWhereTheKindIsOn(t *testing.T) {
	t.Setenv("AGENT_SSH_BAN_STATE_PATH", t.TempDir()+"/bans.json")
	fwConfigureBans(&fwSSHLimit{ports: []string{"22"}, exempt: []string{"203.0.113.0/24"}, ban: &fwSSHBan{attempts: 5, minutes: 10}}, nil)
	defer fwConfigureBans(nil, nil)
	now := time.Now()
	bans := fwParseSharedBans([]interface{}{
		map[string]interface{}{"kind": "all", "address": "198.51.100.9", "until": float64(now.Add(time.Hour).Unix()), "strikes": float64(1)},
		map[string]interface{}{"kind": "ssh", "address": "203.0.113.9", "until": float64(now.Add(time.Hour).Unix()), "strikes": float64(1)},
		map[string]interface{}{"kind": "ssh", "address": "10.1.2.3", "until": float64(now.Add(time.Hour).Unix()), "strikes": float64(1)},
		map[string]interface{}{"kind": "ssh", "address": "198.51.100.10", "until": float64(now.Add(-time.Minute).Unix()), "strikes": float64(1)},
		map[string]interface{}{"kind": "ssh", "address": "not-an-ip", "until": float64(now.Add(time.Hour).Unix()), "strikes": float64(1)},
	})
	if len(bans) != 5 {
		t.Fatalf("parsed %d bans", len(bans))
	}
	// None of these may reach ipset: rpc bans are off here, the rest is
	// exempt, private, expired or invalid.
	if added := fwApplySharedBans(bans, now); added != 0 {
		t.Errorf("added %d", added)
	}
	fwSSHBans.Lock()
	_, tracked := fwSSHBans.byKey[fwBanEntryKey(fwBanSSH, "203.0.113.9")]
	fwSSHBans.Unlock()
	if tracked {
		t.Error("an exempt address was tracked")
	}
}

func TestBanAddress(t *testing.T) {
	if ip, v6, ok := fwBanAddress("198.51.100.9"); !ok || v6 || ip.String() != "198.51.100.9" {
		t.Errorf("ipv4: %v %v %v", ip, v6, ok)
	}
	if ip, v6, ok := fwBanAddress("2001:db8:1:2::/64"); !ok || !v6 || ip.String() != "2001:db8:1:2::" {
		t.Errorf("ipv6: %v %v %v", ip, v6, ok)
	}
	for _, bad := range []string{"2001:db8::/48", "0.0.0.0/0", "x", "2001:db8::1"} {
		if _, _, ok := fwBanAddress(bad); ok {
			t.Errorf("%q accepted", bad)
		}
	}
}
