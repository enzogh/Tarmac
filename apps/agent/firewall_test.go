package main

import (
	"bufio"
	"encoding/json"
	"net"
	"strconv"
	"strings"
	"testing"
)

func fwTestPayload(t *testing.T, raw string) fwDesired {
	t.Helper()
	var payload map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		t.Fatal(err)
	}
	desired, err := parseFirewallPayload(payload)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	return desired
}

func fwJoin(rules [][]string) string {
	lines := make([]string, len(rules))
	for i, rule := range rules {
		lines[i] = strings.Join(rule, " ")
	}
	return strings.Join(lines, "\n")
}

func fwChain(plan fwPlan, name string) *vpnChainSpec {
	for i := range plan.chains {
		if plan.chains[i].chain == name {
			return &plan.chains[i]
		}
	}
	return nil
}

func TestFirewallParseRejectsBadInput(t *testing.T) {
	cases := []string{
		`{"mesh":{"mode":"enforce","allows":[{"id":"r1","protocol":"tcp","ports":["70000"]}]}}`,
		`{"mesh":{"mode":"enforce","allows":[{"id":"r1","protocol":"any","ports":["22"]}]}}`,
		`{"mesh":{"mode":"enforce","allows":[{"id":"r1","protocol":"tcp","sources":["not-an-ip"]}]}}`,
		`{"mesh":{"mode":"enforce","allows":[{"id":"bad id;","protocol":"tcp"}]}}`,
		`{"mesh":{"mode":"panic"}}`,
		`{"public":{"mode":"enforce","denies":[{"id":"r1","protocol":"tcp","ports":["30-20"]}]}}`,
	}
	for _, raw := range cases {
		var payload map[string]interface{}
		_ = json.Unmarshal([]byte(raw), &payload)
		if _, err := parseFirewallPayload(payload); err == nil {
			t.Errorf("expected an error for %s", raw)
		}
	}
}

func TestFirewallOpenWithoutRulesInstallsNothing(t *testing.T) {
	desired := fwTestPayload(t, `{"revision":"1","mesh":{"mode":"open"},"public":{"mode":"open"}}`)
	plan := buildFirewallPlan(desired, false, []string{"eth0"}, true)
	if len(plan.chains) != 0 {
		t.Fatalf("expected no chain, got %d", len(plan.chains))
	}
	if len(plan.obsolete) == 0 {
		t.Fatal("expected every chain to be removed")
	}
}

func TestFirewallMeshOpenOnlyBlocks(t *testing.T) {
	desired := fwTestPayload(t, `{"revision":"1","mesh":{"mode":"open","denies":[
		{"id":"deny-ssh","protocol":"tcp","ports":["22"],"sources":["10.16.0.5"]}
	],"allows":[{"id":"allow-web","protocol":"tcp","ports":["443"]}]}}`)
	plan := buildFirewallPlan(desired, false, []string{"eth0"}, false)
	mesh := fwChain(plan, fwChainMesh)
	if mesh == nil {
		t.Fatal("mesh chain missing")
	}
	body := fwJoin(mesh.rules)
	if !strings.Contains(body, "-s 10.16.0.5/32 -p tcp --dport 22 -m comment --comment tarmac-fw:deny-ssh -j DROP") {
		t.Errorf("deny rule missing:\n%s", body)
	}
	if !strings.Contains(body, "--log-prefix TFW:R0 ") {
		t.Errorf("deny rule is not logged:\n%s", body)
	}
	// Open mode: allows are irrelevant and nothing is dropped by default.
	if strings.Contains(body, "allow-web") || strings.Contains(body, "tarmac-fw:default") {
		t.Errorf("open mode must only block:\n%s", body)
	}
	in := fwChain(plan, fwChainIn)
	if in == nil || strings.Contains(fwJoin(in.rules), fwChainPub) {
		t.Errorf("public chain must not be wired when the internet zone is open without blocks")
	}
	if fwChain(plan, fwChainDnat) != nil {
		t.Error("no Docker: the DNAT chain must not exist")
	}
}

func TestFirewallMeshEnforceOrder(t *testing.T) {
	desired := fwTestPayload(t, `{"revision":"1","mesh":{"mode":"enforce",
		"denies":[{"id":"d1","protocol":"any","sources":["10.16.0.9"]}],
		"allows":[{"id":"sys:dns","protocol":"tcpudp","ports":["5300"]},{"id":"a1","protocol":"tcp","ports":["22","8000-8100"],"sources":["10.16.0.5","10.16.0.6"]}]}}`)
	plan := buildFirewallPlan(desired, false, nil, true)
	mesh := fwChain(plan, fwChainMesh)
	body := fwJoin(mesh.rules)
	order := []string{
		"--ctstate RELATED,ESTABLISHED -j RETURN",
		"-p 4 -j RETURN",
		"-p icmp -j RETURN",
		"-s 10.16.0.9/32 -m comment --comment tarmac-fw:d1 -j DROP",
		"-p tcp --dport 5300 -m comment --comment tarmac-fw:sys:dns -j RETURN",
		"-p udp --dport 5300 -m comment --comment tarmac-fw:sys:dns -j RETURN",
		"-s 10.16.0.5/32 -p tcp --dport 22 -m comment --comment tarmac-fw:a1 -j RETURN",
		"-s 10.16.0.6/32 -p tcp --dport 8000:8100 -m comment --comment tarmac-fw:a1 -j RETURN",
		"--log-prefix TFW:B ",
		"--comment tarmac-fw:default -j DROP",
	}
	last := -1
	for _, needle := range order {
		at := strings.Index(body, needle)
		if at < 0 {
			t.Fatalf("missing %q in:\n%s", needle, body)
		}
		if at < last {
			t.Fatalf("%q is out of order in:\n%s", needle, body)
		}
		last = at
	}
	// No uplink: only the mesh is dispatched.
	in := fwJoin(fwChain(plan, fwChainIn).rules)
	if !strings.Contains(in, "-i tarmacwg0 -j TARMAC-FW-MESH") || strings.Contains(in, fwChainPub) {
		t.Errorf("unexpected dispatch:\n%s", in)
	}
	// Docker published ports: matched on the original destination port.
	meshD := fwJoin(fwChain(plan, fwChainMeshD).rules)
	if !strings.Contains(meshD, "-s 10.16.0.5/32 -p tcp -m conntrack --ctorigdstport 22 -m comment --comment tarmac-fw:a1 -j RETURN") {
		t.Errorf("docker rule missing:\n%s", meshD)
	}
	if !strings.Contains(meshD, "--log-prefix TFW:Bd ") {
		t.Errorf("docker default not tagged:\n%s", meshD)
	}
	dnat := fwJoin(fwChain(plan, fwChainDnat).rules)
	if !strings.HasPrefix(dnat, "-m conntrack ! --ctstate DNAT -j RETURN") {
		t.Errorf("DNAT chain must skip non-DNAT traffic first:\n%s", dnat)
	}
	// Children are created before the chains that jump to them.
	names := []string{}
	for _, chain := range plan.chains {
		names = append(names, chain.chain)
	}
	if strings.Join(names, ",") != "TARMAC-FW-MESH,TARMAC-FW-IN,TARMAC-FW-MESH-D,TARMAC-FW-DNAT" {
		t.Errorf("unexpected chain order: %v", names)
	}
}

func TestFirewallPublicFamilies(t *testing.T) {
	desired := fwTestPayload(t, `{"revision":"1","ping":false,"public":{"mode":"observe",
		"denies":[{"id":"ban","protocol":"any","sources":["203.0.113.0/24","2001:db8::/32"]}],
		"allows":[{"id":"office","protocol":"tcp","ports":["22"],"sources":["198.51.100.7"]},{"id":"web","protocol":"tcp","ports":["443"]}]}}`)
	v4 := buildFirewallPlan(desired, false, []string{"eth0"}, false)
	pub4 := fwJoin(fwChain(v4, fwChainPub).rules)
	if !strings.Contains(pub4, "-s 203.0.113.0/24 -m comment --comment tarmac-fw:ban -j DROP") || strings.Contains(pub4, "2001:db8") {
		t.Errorf("v4 public chain wrong:\n%s", pub4)
	}
	if !strings.Contains(pub4, "-p icmp ! --icmp-type echo-request -j RETURN") {
		t.Errorf("ping disabled must still let other ICMP through:\n%s", pub4)
	}
	if !strings.Contains(pub4, "--log-prefix TFW:O ") || strings.Contains(pub4, "default -j DROP") {
		t.Errorf("observe mode must log without dropping:\n%s", pub4)
	}
	if !strings.Contains(fwJoin(fwChain(v4, fwChainIn).rules), "-i eth0 -j TARMAC-FW-PUB") {
		t.Error("uplink not dispatched")
	}

	v6 := buildFirewallPlan(desired, true, []string{"eth0"}, false)
	if fwChain(v6, fwChainMesh) != nil {
		t.Error("the mesh is IPv4 only")
	}
	pub6 := fwJoin(fwChain(v6, fwChainPub).rules)
	if !strings.Contains(pub6, "-s 2001:db8::/32 -m comment --comment tarmac-fw:ban -j DROP") || strings.Contains(pub6, "203.0.113") {
		t.Errorf("v6 public chain wrong:\n%s", pub6)
	}
	if strings.Contains(pub6, "tarmac-fw:office") {
		t.Errorf("an IPv4-only allow must not appear in IPv6:\n%s", pub6)
	}
	if !strings.Contains(pub6, "-p tcp --dport 443 -m comment --comment tarmac-fw:web -j RETURN") {
		t.Errorf("any-source allow missing in IPv6:\n%s", pub6)
	}
	if !strings.Contains(pub6, "-p ipv6-icmp ! --icmpv6-type echo-request -j RETURN") {
		t.Errorf("ICMPv6 must stay open:\n%s", pub6)
	}
}

func TestFirewallPublicWithoutUplinkIsInactive(t *testing.T) {
	desired := fwTestPayload(t, `{"public":{"mode":"enforce"}}`)
	plan := buildFirewallPlan(desired, false, nil, false)
	if len(plan.chains) != 0 {
		t.Fatalf("no uplink: nothing to filter, got %d chain(s)", len(plan.chains))
	}
}

func TestFirewallQuoteArgs(t *testing.T) {
	got := fwQuoteArgs([]string{"-j", "LOG", "--log-prefix", "TFW:B "})
	if got != `-j LOG --log-prefix "TFW:B "` {
		t.Fatalf("got %s", got)
	}
}

func TestFirewallParseLogLine(t *testing.T) {
	line := "TFW:R1 IN=tarmacwg0 OUT= MAC= SRC=10.16.0.5 DST=10.16.0.220 LEN=60 TOS=0x00 PREC=0x00 TTL=64 ID=4242 DF PROTO=TCP SPT=51544 DPT=22 WINDOW=64240 RES=0x00 SYN URGP=0"
	event, ok := fwParseLogLine(line, []string{"a", "deny-ssh"})
	if !ok {
		t.Fatal("not parsed")
	}
	if event.Verdict != "blocked" || event.RuleID != "deny-ssh" || event.Source != "10.16.0.5" || event.Dest != "10.16.0.220" ||
		event.Protocol != "tcp" || event.Port != 22 || event.Iface != "tarmacwg0" || event.Docker {
		t.Fatalf("unexpected event %+v", event)
	}
	event, ok = fwParseLogLine("TFW:Od IN=eth0 OUT=docker0 SRC=2001:db8::1 DST=172.17.0.2 PROTO=UDP SPT=1 DPT=53", nil)
	if !ok || event.Verdict != "observed" || !event.Docker || event.Protocol != "udp" || event.Port != 53 {
		t.Fatalf("unexpected docker event %+v", event)
	}
	event, ok = fwParseLogLine("TFW:B IN=eth0 OUT= SRC=198.51.100.1 DST=192.0.2.1 PROTO=ICMP TYPE=8 CODE=0", nil)
	if !ok || event.Protocol != "icmp" || event.Port != 0 {
		t.Fatalf("unexpected icmp event %+v", event)
	}
	if _, ok := fwParseLogLine("UFW BLOCK IN=eth0 SRC=1.2.3.4", nil); ok {
		t.Fatal("foreign log lines must be ignored")
	}
}

func TestFirewallParseListening(t *testing.T) {
	output := `tcp   LISTEN 0      4096       0.0.0.0:22        0.0.0.0:*    users:(("sshd",pid=812,fd=3))
tcp   LISTEN 0      4096          [::]:22           [::]:*    users:(("sshd",pid=812,fd=4))
tcp   LISTEN 0      4096     127.0.0.1:5432      0.0.0.0:*    users:(("postgres",pid=900,fd=5))
tcp   LISTEN 0      4096 127.0.0.53%lo:53        0.0.0.0:*    users:(("systemd-resolve",pid=500,fd=14))
udp   UNCONN 0      0          0.0.0.0:51820     0.0.0.0:*
tcp   LISTEN 0      4096   10.16.0.220:2049      0.0.0.0:*
tcp   LISTEN 0      4096             *:443             *:*    users:(("docker-proxy",pid=1,fd=4),("docker-proxy",pid=2,fd=4))`
	ports := fwParseListening(output)
	got := []string{}
	for _, port := range ports {
		got = append(got, port.Protocol+"/"+strings.Join(port.Addresses, ",")+":"+strconv.Itoa(port.Port)+"="+strings.Join(port.Processes, ","))
	}
	want := "tcp/*:22=sshd tcp/*:443=docker-proxy tcp/10.16.0.220:2049= udp/*:51820="
	if strings.Join(got, " ") != want {
		t.Fatalf("got  %s\nwant %s", strings.Join(got, " "), want)
	}
}


func TestFirewallParseCounters(t *testing.T) {
	output := `*filter
:TARMAC-FW-MESH - [0:0]
[12:720] -A TARMAC-FW-MESH -s 10.16.0.5/32 -p tcp -m tcp --dport 22 -m comment --comment "tarmac-fw:deny-ssh" -j DROP
[3:180] -A TARMAC-FW-MESH-D -s 10.16.0.5/32 -p tcp -m conntrack --ctorigdstport 22 -m comment --comment tarmac-fw:deny-ssh -j DROP
[0:0] -A TARMAC-FW-MESH -p tcp -m tcp --dport 5300 -m comment --comment tarmac-fw:sys:dns -j RETURN
[40:2400] -A TARMAC-FW-MESH -m limit --limit 30/min -j LOG --log-prefix "TFW:B "
[7:420] -A INPUT -m comment --comment "tarmac-fw:ghost" -j DROP
COMMIT`
	counters := map[string]uint64{}
	fwParseCounters(output, counters)
	if counters["deny-ssh"] != 15 || counters["sys:dns"] != 0 || len(counters) != 2 {
		t.Fatalf("unexpected counters %v", counters)
	}
}

func TestFirewallParseUplinks(t *testing.T) {
	got := fwParseUplinks("default via 51.68.0.1 dev ens3 proto dhcp src 51.68.1.2 metric 100\ndefault dev tarmacvpn0 scope link\ndefault proto static metric 1024 nexthop via 10.0.0.1 dev eth1 weight 1 nexthop via 10.0.1.1 dev ens3 weight 1")
	if strings.Join(got, ",") != "ens3,eth1" {
		t.Fatalf("got %v", got)
	}
}

func TestFirewallSSHLimit(t *testing.T) {
	desired := fwTestPayload(t, `{"revision":"1","mesh":{"mode":"open"},"public":{"mode":"open"},
		"sshLimit":{"ports":["22","2222"],"exempt":["198.51.100.7","2001:db8::/48"]}}`)

	plan := buildFirewallPlan(desired, false, []string{"eth0"}, false)
	pub := fwChain(plan, fwChainPub)
	ssh := fwChain(plan, fwChainSSH)
	sshX := fwChain(plan, fwChainSSHX)
	if pub == nil || ssh == nil || sshX == nil {
		t.Fatal("an open public zone with the SSH limit on must still install the limiter")
	}
	body := fwJoin(pub.rules)
	for _, want := range []string{
		"-p tcp --dport 22 -m conntrack --ctstate NEW -j TARMAC-FW-SSH",
		"-p tcp --dport 2222 -m conntrack --ctstate NEW -j TARMAC-FW-SSH",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("missing %q in:\n%s", want, body)
		}
	}
	if strings.Contains(body, "DROP") {
		t.Errorf("an open zone must drop nothing but the SSH excess:\n%s", body)
	}
	limiter := fwJoin(ssh.rules)
	if !strings.HasPrefix(limiter, "-s 198.51.100.7/32 -j RETURN\n") || strings.Contains(limiter, "2001:db8") {
		t.Errorf("IPv4 exemption must come first, alone:\n%s", limiter)
	}
	if !strings.Contains(limiter, "--hashlimit-srcmask 32 --hashlimit-name tarmac-ssh4 -j TARMAC-FW-SSH-X") {
		t.Errorf("IPv4 limiter missing:\n%s", limiter)
	}
	if got := fwJoin(sshX.rules); !strings.Contains(got, "TFW:S ") || !strings.HasSuffix(got, "--comment tarmac-fw:ssh-limit -j DROP") {
		t.Errorf("excess must be logged then dropped:\n%s", got)
	}
	// Children before parents: the jump targets must exist first.
	order := map[string]int{}
	for i, chain := range plan.chains {
		order[chain.chain] = i
	}
	if !(order[fwChainSSHX] < order[fwChainSSH] && order[fwChainSSH] < order[fwChainPub] && order[fwChainPub] < order[fwChainIn]) {
		t.Errorf("bad chain order: %v", order)
	}

	plan6 := buildFirewallPlan(desired, true, []string{"eth0"}, false)
	ssh6 := fwChain(plan6, fwChainSSH)
	if ssh6 == nil {
		t.Fatal("IPv6 limiter missing")
	}
	limiter6 := fwJoin(ssh6.rules)
	if !strings.Contains(limiter6, "-s 2001:db8::/48 -j RETURN") || strings.Contains(limiter6, "198.51.100.7") ||
		!strings.Contains(limiter6, "--hashlimit-srcmask 64 --hashlimit-name tarmac-ssh6") {
		t.Errorf("IPv6 limiter wrong:\n%s", limiter6)
	}

	// Off again: the limiter chains are removed.
	off := fwTestPayload(t, `{"revision":"2","public":{"mode":"enforce"}}`)
	plan = buildFirewallPlan(off, false, []string{"eth0"}, false)
	if fwChain(plan, fwChainSSH) != nil || fwChain(plan, fwChainSSHX) != nil {
		t.Error("limiter chains must be gone when the limit is off")
	}
	removed := map[string]bool{}
	for _, chain := range plan.obsolete {
		removed[chain.chain] = true
	}
	if !removed[fwChainSSH] || !removed[fwChainSSHX] {
		t.Error("limiter chains must be listed as obsolete")
	}
	if strings.Contains(fwJoin(fwChain(plan, fwChainPub).rules), fwChainSSH) {
		t.Error("public chain still jumps to the limiter")
	}
}

func TestFirewallSSHLimitParse(t *testing.T) {
	if desired := fwTestPayload(t, `{"sshLimit":{"ports":[]}}`); desired.sshLimit != nil || desired.active() {
		t.Error("a limit without ports is off")
	}
	for _, raw := range []string{
		`{"sshLimit":{"ports":["22;rm"]}}`,
		`{"sshLimit":{"ports":["22"],"exempt":["nope"]}}`,
	} {
		var payload map[string]interface{}
		_ = json.Unmarshal([]byte(raw), &payload)
		if _, err := parseFirewallPayload(payload); err == nil {
			t.Errorf("expected an error for %s", raw)
		}
	}
	event, ok := fwParseLogLine("TFW:S IN=eth0 OUT= SRC=203.0.113.9 DST=198.51.100.1 PROTO=TCP SPT=50000 DPT=22", nil)
	if !ok || event.Verdict != "blocked" || event.RuleID != "ssh-limit" || event.Port != 22 {
		t.Errorf("bad SSH limit event: %+v", event)
	}
}

func TestFirewallOutbound(t *testing.T) {
	desired := fwTestPayload(t, `{"revision":"1","outbound":{"mode":"enforce",
		"denies":[{"id":"no-smtp","protocol":"tcp","ports":["25"]}],
		"allows":[{"id":"https","protocol":"tcp","ports":["443"]},{"id":"partner","protocol":"any","sources":["198.51.100.0/24"]}]}}`)
	plan := buildFirewallPlan(desired, false, []string{"eth0"}, false)
	out := fwChain(plan, fwChainOut)
	egr := fwChain(plan, fwChainEgr)
	if out == nil || egr == nil {
		t.Fatal("outbound chains missing")
	}
	if got := fwJoin(out.rules); got != "-o lo -j RETURN\n-o eth0 -j TARMAC-FW-EGR" {
		t.Errorf("OUTPUT jump wrong:\n%s", got)
	}
	body := fwJoin(egr.rules)
	for _, want := range []string{
		"-m owner --uid-owner 0 -j RETURN",
		"-p udp --dport 53 -j RETURN",
		"-p tcp --dport 25 -m limit --limit 30/min --limit-burst 20 -j LOG --log-prefix TFW:XR0 ",
		"-p tcp --dport 25 -m comment --comment tarmac-fw:no-smtp -j DROP",
		"-p tcp --dport 443 -m comment --comment tarmac-fw:https -j RETURN",
		// The remote end is the destination.
		"-d 198.51.100.0/24 -m comment --comment tarmac-fw:partner -j RETURN",
		"--log-prefix TFW:XB ",
		"--comment tarmac-fw:default -j DROP",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("missing %q in:\n%s", want, body)
		}
	}
	// System exemptions come before any user rule.
	if strings.Index(body, "--uid-owner 0") > strings.Index(body, "no-smtp") {
		t.Error("root exemption must precede the rules")
	}
	if fwChain(plan, fwChainIn) == nil || len(fwChain(plan, fwChainIn).rules) != 1 {
		t.Error("inbound must stay untouched by an outbound-only payload")
	}
	// Observed outbound packets carry the X tag, parsed back as outbound.
	event, ok := fwParseLogLine("TFW:XO IN= OUT=eth0 SRC=192.0.2.10 DST=203.0.113.9 LEN=60 PROTO=TCP SPT=40000 DPT=6667", nil)
	if !ok || !event.Outbound || event.Verdict != "observed" || event.Iface != "eth0" || event.Dest != "203.0.113.9" || event.Port != 6667 {
		t.Errorf("bad outbound event: %+v", event)
	}
	// Off: the chains go away.
	plan = buildFirewallPlan(fwTestPayload(t, `{"revision":"2","outbound":{"mode":"open"}}`), false, []string{"eth0"}, false)
	if fwChain(plan, fwChainOut) != nil {
		t.Error("outbound chain must be removed when off")
	}
}

func TestFirewallCountries(t *testing.T) {
	desired := fwTestPayload(t, `{"revision":"1","public":{"mode":"open","denies":[{"id":"geo","protocol":"any","countries":["CN","ru"]}]}}`)
	if got := fwDesiredCountries(desired); strings.Join(got, ",") != "CN,RU" {
		t.Fatalf("countries: %v", got)
	}
	plan := buildFirewallPlan(desired, false, []string{"eth0"}, false)
	body := fwJoin(fwChain(plan, fwChainPub).rules)
	for _, want := range []string{
		"-m set --match-set tarmac-geo4-CN src -m comment --comment tarmac-fw:geo -j DROP",
		"-m set --match-set tarmac-geo4-RU src -m comment --comment tarmac-fw:geo -j DROP",
	} {
		if !strings.Contains(body, want) {
			t.Errorf("missing %q in:\n%s", want, body)
		}
	}
	if strings.Contains(body, "-j DROP\n-m comment --comment tarmac-fw:geo") || strings.Contains(body, "\n-m comment --comment tarmac-fw:geo -j DROP") {
		t.Errorf("a country rule must never become an any-source rule:\n%s", body)
	}
	body6 := fwJoin(fwChain(buildFirewallPlan(desired, true, []string{"eth0"}, false), fwChainPub).rules)
	if !strings.Contains(body6, "--match-set tarmac-geo6-CN src") {
		t.Errorf("IPv6 country set missing:\n%s", body6)
	}
	for _, raw := range []string{
		`{"public":{"mode":"open","denies":[{"id":"x","protocol":"any","countries":["CHN"]}]}}`,
		`{"public":{"mode":"open","denies":[{"id":"x","protocol":"any","countries":["CN"],"sources":["1.2.3.4"]}]}}`,
		`{"public":{"mode":"open","denies":[{"id":"x","protocol":"any","countries":["  "]}]}}`,
	} {
		var payload map[string]interface{}
		_ = json.Unmarshal([]byte(raw), &payload)
		if _, err := parseFirewallPayload(payload); err == nil {
			t.Errorf("expected an error for %s", raw)
		}
	}
}

func TestFirewallRangeToCIDRs(t *testing.T) {
	cases := map[[2]string]string{
		{"1.0.1.0", "1.0.3.255"}:       "1.0.1.0/24,1.0.2.0/23",
		{"10.0.0.0", "10.0.0.255"}:     "10.0.0.0/24",
		{"192.0.2.5", "192.0.2.5"}:     "192.0.2.5/32",
		{"0.0.0.0", "255.255.255.255"}: "0.0.0.0/0",
	}
	for bounds, want := range cases {
		got := strings.Join(fwRangeToCIDRs(net.ParseIP(bounds[0]), net.ParseIP(bounds[1])), ",")
		if got != want {
			t.Errorf("%v: got %s, want %s", bounds, got, want)
		}
	}
	data := fwGeoData{}
	scanner := bufio.NewScanner(strings.NewReader("ripencc|FR|ipv4|2.0.0.0|1048576|20100712|allocated\nripencc|FR|ipv6|2001:660::|32|19990101|allocated\nripencc|*|ipv4|*|1|summary\n"))
	fwParseGeoLines(scanner, data)
	if got := data["FR"]; strings.Join(got[0], ",") != "2.0.0.0/12" || strings.Join(got[1], ",") != "2001:660::/32" {
		t.Errorf("parsed: %+v", got)
	}
}
