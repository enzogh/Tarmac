package main

import (
	"encoding/binary"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func dnsTestQuery(id uint16, name string, qtype uint16) []byte {
	msg := make([]byte, 12)
	binary.BigEndian.PutUint16(msg[0:], id)
	msg[2] = 0x01 // RD
	binary.BigEndian.PutUint16(msg[4:], 1)
	msg = append(msg, encodeDnsName(name)...)
	tail := make([]byte, 4)
	binary.BigEndian.PutUint16(tail[0:], qtype)
	binary.BigEndian.PutUint16(tail[2:], dnsClassIN)
	return append(msg, tail...)
}

type dnsTestAnswer struct {
	rcode     byte
	aa        bool
	answers   int
	authority int
	ip        string
	ptr       string
}

// Reads what the tests need back from a response built by dnsReply (answers
// always point at the question name).
func dnsTestParse(t *testing.T, resp []byte) dnsTestAnswer {
	t.Helper()
	if len(resp) < 12 || resp[2]&0x80 == 0 {
		t.Fatalf("not a DNS response: %v", resp)
	}
	out := dnsTestAnswer{
		rcode:     resp[3] & 0x0F,
		aa:        resp[2]&0x04 != 0,
		answers:   int(binary.BigEndian.Uint16(resp[6:])),
		authority: int(binary.BigEndian.Uint16(resp[8:])),
	}
	q, ok := parseDnsQuestion(resp)
	if !ok {
		t.Fatalf("response question unreadable")
	}
	if out.answers > 0 {
		offset := q.end
		if resp[offset] != 0xC0 {
			t.Fatalf("expected a compressed answer name")
		}
		rrtype := binary.BigEndian.Uint16(resp[offset+2:])
		rdlen := int(binary.BigEndian.Uint16(resp[offset+10:]))
		rdata := resp[offset+12 : offset+12+rdlen]
		switch rrtype {
		case dnsTypeA:
			out.ip = net.IP(rdata).String()
		case dnsTypePTR:
			labels := []string{}
			for i := 0; i < len(rdata) && rdata[i] != 0; i += int(rdata[i]) + 1 {
				labels = append(labels, string(rdata[i+1:i+1+int(rdata[i])]))
			}
			out.ptr = strings.Join(labels, ".")
		}
	}
	return out
}

func dnsTestEntry() *vpnEntry {
	return &vpnEntry{
		iface:        "tarmacvpn0",
		addressCidr:  "10.16.101.1/24",
		clientSubnet: "10.16.101.0/24",
		clients: []vpnClient{
			// Linked to bob only.
			{publicKey: "a", ip: "10.16.101.2", policy: vpnPolicy{allow: []string{"10.16.102.7/32"}}, upstreams: []string{"9.9.9.9"}},
			// Every profile.
			{publicKey: "b", ip: "10.16.101.3", policy: vpnPolicy{allow: []string{"10.16.100.0/22", "10.16.104.0/21"}}, table: 21007},
			// Isolated.
			{publicKey: "c", ip: "10.16.101.4"},
		},
		dns: &vpnDnsSpec{
			zone: "intranet.internal",
			ttl:  10,
			records: []vpnDnsRecord{
				{name: "alice", ip: "10.16.101.2"},
				{name: "admin", ip: "10.16.101.3"},
				{name: "kiosk", ip: "10.16.101.4"},
				{name: "bob", ip: "10.16.102.7"},
			},
		},
	}
}

func dnsTestView(t *testing.T) *vpnDnsView {
	t.Helper()
	view, err := buildVpnDnsView(dnsTestEntry(), []string{"127.0.0.1:1"})
	if err != nil {
		t.Fatal(err)
	}
	return view
}

func dnsTestLocal(t *testing.T, view *vpnDnsView, client, name string, qtype uint16) (dnsTestAnswer, bool) {
	t.Helper()
	msg := dnsTestQuery(0x1234, name, qtype)
	q, ok := parseDnsQuestion(msg)
	if !ok {
		t.Fatalf("query for %s unreadable", name)
	}
	resp, handled := view.answerLocal(msg, q, view.clients[client])
	if !handled {
		return dnsTestAnswer{}, false
	}
	if binary.BigEndian.Uint16(resp[0:]) != 0x1234 {
		t.Fatalf("answer id not echoed")
	}
	return dnsTestParse(t, resp), true
}

func TestVpnDnsAnswersOnlyReachableNames(t *testing.T) {
	view := dnsTestView(t)
	cases := []struct {
		client, name string
		rcode        byte
		ip           string
	}{
		{"10.16.101.2", "bob.intranet.internal", dnsRcodeOK, "10.16.102.7"},
		{"10.16.101.2", "BOB.Intranet.Internal", dnsRcodeOK, "10.16.102.7"},
		{"10.16.101.2", "alice.intranet.internal", dnsRcodeOK, "10.16.101.2"}, // itself
		{"10.16.101.2", "admin.intranet.internal", dnsRcodeNXDomain, ""},      // not linked
		{"10.16.101.3", "kiosk.intranet.internal", dnsRcodeOK, "10.16.101.4"},
		{"10.16.101.3", "bob.intranet.internal", dnsRcodeOK, "10.16.102.7"},
		{"10.16.101.4", "alice.intranet.internal", dnsRcodeNXDomain, ""},
		{"10.16.101.4", "kiosk.intranet.internal", dnsRcodeOK, "10.16.101.4"},
		{"10.16.101.9", "alice.intranet.internal", dnsRcodeNXDomain, ""}, // unknown source
		{"10.16.101.3", "nobody.intranet.internal", dnsRcodeNXDomain, ""},
		{"10.16.101.3", "a.bob.intranet.internal", dnsRcodeNXDomain, ""},
	}
	for _, tc := range cases {
		got, handled := dnsTestLocal(t, view, tc.client, tc.name, dnsTypeA)
		if !handled {
			t.Fatalf("%s from %s: relayed instead of answered", tc.name, tc.client)
		}
		if got.rcode != tc.rcode || got.ip != tc.ip || !got.aa {
			t.Errorf("%s from %s: got rcode %d ip %q aa %v, want rcode %d ip %q", tc.name, tc.client, got.rcode, got.ip, got.aa, tc.rcode, tc.ip)
		}
		if got.rcode == dnsRcodeNXDomain && got.authority != 1 {
			t.Errorf("%s: negative answer without SOA", tc.name)
		}
	}
}

func TestVpnDnsOtherTypesAndReverse(t *testing.T) {
	view := dnsTestView(t)

	// The name exists: NODATA for AAAA, not NXDOMAIN (or clients give up on
	// the A record too).
	got, _ := dnsTestLocal(t, view, "10.16.101.2", "bob.intranet.internal", 28)
	if got.rcode != dnsRcodeOK || got.answers != 0 || got.authority != 1 {
		t.Errorf("AAAA: got %+v", got)
	}
	got, _ = dnsTestLocal(t, view, "10.16.101.2", "intranet.internal", dnsTypeSOA)
	if got.rcode != dnsRcodeOK || got.answers != 1 {
		t.Errorf("apex SOA: got %+v", got)
	}
	got, _ = dnsTestLocal(t, view, "10.16.101.2", "intranet.internal", dnsTypeNS)
	if got.rcode != dnsRcodeOK || got.answers != 0 {
		t.Errorf("apex NS: got %+v", got)
	}

	got, handled := dnsTestLocal(t, view, "10.16.101.2", "7.102.16.10.in-addr.arpa", dnsTypePTR)
	if !handled || got.ptr != "bob.intranet.internal" {
		t.Errorf("PTR bob: got %+v handled %v", got, handled)
	}
	got, handled = dnsTestLocal(t, view, "10.16.101.2", "3.101.16.10.in-addr.arpa", dnsTypePTR)
	if !handled || got.rcode != dnsRcodeNXDomain {
		t.Errorf("PTR of a profile out of reach: got %+v handled %v", got, handled)
	}
	if _, handled = dnsTestLocal(t, view, "10.16.101.2", "8.8.8.8.in-addr.arpa", dnsTypePTR); handled {
		t.Errorf("PTR of an unknown address must be relayed")
	}
	if _, handled = dnsTestLocal(t, view, "10.16.101.2", "example.com", dnsTypeA); handled {
		t.Errorf("names outside the zone must be relayed")
	}
	if _, handled = dnsTestLocal(t, view, "10.16.101.2", "notintranet.internal", dnsTypeA); handled {
		t.Errorf("a name merely ending like the zone must be relayed")
	}
}

func TestVpnDnsViewUpstreamsAndMarks(t *testing.T) {
	view := dnsTestView(t)
	alice := view.clients["10.16.101.2"]
	if len(alice.upstreams) != 1 || alice.upstreams[0] != "9.9.9.9:53" || alice.mark != 0 {
		t.Errorf("alice: %+v", alice)
	}
	admin := view.clients["10.16.101.3"]
	if admin.mark != vpnDnsMarkBase|21007 || len(admin.upstreams) != 0 {
		t.Errorf("admin: %+v", admin)
	}

	entry := dnsTestEntry()
	entry.clients[0].upstreams = []string{"10.16.101.1", "1.1.1.1"}
	view, _ = buildVpnDnsView(entry, nil)
	if got := view.clients["10.16.101.2"].upstreams; len(got) != 1 || got[0] != "1.1.1.1:53" {
		t.Errorf("the gateway itself must never be an upstream: %v", got)
	}

	rules := vpnDnsMarkRules(vpnDesired{entry: dnsTestEntry()})
	if len(rules) != 1 || rules[0].fwmark != "0x1000520f" || rules[0].table != "21007" || rules[0].pref != vpnRulePrefDns {
		t.Errorf("mark rules: %+v", rules)
	}
	if got := strings.Join(rules[0].args("add"), " "); got != "rule add pref 20050 fwmark 0x1000520f table 21007" {
		t.Errorf("rule args: %s", got)
	}
	if normalizeFwmark("0x1000520f/0xffffffff") != "0x1000520f" {
		t.Errorf("fwmark normalization")
	}
}

func TestVpnDnsPayloadParsing(t *testing.T) {
	payload := map[string]interface{}{
		"revision": "2026-11-17T10:00:00.000Z",
		"meshCidr": "10.16.0.0/16",
		"entry": map[string]interface{}{
			"interfaceName": "tarmacvpn0",
			"listenPort":    float64(51821),
			"addressCidr":   "10.16.101.1/24",
			"clientSubnet":  "10.16.101.0/24",
			"clients": []interface{}{
				map[string]interface{}{
					"publicKey": "xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=",
					"ip":        "10.16.101.2",
					"upstreams": []interface{}{"1.1.1.1"},
				},
			},
			"dns": map[string]interface{}{
				"zone":    "Intranet.Internal.",
				"ttl":     float64(10),
				"records": []interface{}{map[string]interface{}{"name": "alice", "ip": "10.16.101.2"}},
			},
		},
	}
	desired, err := parseVpnPayload(payload)
	if err != nil {
		t.Fatal(err)
	}
	if desired.entry.dns == nil || desired.entry.dns.zone != "intranet.internal" || len(desired.entry.dns.records) != 1 {
		t.Fatalf("dns spec: %+v", desired.entry.dns)
	}
	if got := desired.entry.clients[0].upstreams; len(got) != 1 || got[0] != "1.1.1.1" {
		t.Fatalf("upstreams: %v", got)
	}

	bad := func(mutate func(entry map[string]interface{})) {
		t.Helper()
		entry := map[string]interface{}{}
		for key, value := range payload["entry"].(map[string]interface{}) {
			entry[key] = value
		}
		mutate(entry)
		if _, err := parseVpnPayload(map[string]interface{}{"meshCidr": "10.16.0.0/16", "entry": entry}); err == nil {
			t.Errorf("expected a validation error")
		}
	}
	bad(func(entry map[string]interface{}) {
		entry["dns"] = map[string]interface{}{"zone": "bad zone"}
	})
	bad(func(entry map[string]interface{}) {
		entry["dns"] = map[string]interface{}{"zone": "ok.internal", "records": []interface{}{map[string]interface{}{"name": "-x", "ip": "10.16.101.2"}}}
	})
	bad(func(entry map[string]interface{}) {
		entry["clients"] = []interface{}{map[string]interface{}{
			"publicKey": "xTIBA5rboUvnH4htodjb6e697QjLERt1NAB4mZqp8Dg=", "ip": "10.16.101.2", "upstreams": []interface{}{"; rm -rf /"},
		}}
	})

	// Old API: no dns section, no resolver.
	delete(payload["entry"].(map[string]interface{}), "dns")
	desired, _ = parseVpnPayload(payload)
	if desired.entry.dns != nil || vpnDnsRedirectRules(desired) != nil || vpnDnsInputRules(desired) != nil {
		t.Errorf("no dns section must mean no resolver")
	}
}

func TestVpnDnsFirewallRules(t *testing.T) {
	desired := vpnDesired{meshCidr: "10.16.0.0/16", isolation: true, entry: dnsTestEntry()}
	redirect := vpnDnsRedirectRules(desired)
	if len(redirect) != 2 || strings.Join(redirect[0], " ") != "-i tarmacvpn0 -d 10.16.101.1/32 -p udp --dport 53 -j REDIRECT --to-ports 53535" {
		t.Errorf("redirect: %v", redirect)
	}
	save, restore := vpnDnsConnmarkRules(desired)
	if len(save) != 1 || strings.Join(save[0], " ") != "-s 10.16.101.1/32 -m mark --mark 0x10000000/0x10000000 -j CONNMARK --save-mark" {
		t.Errorf("connmark save: %v", save)
	}
	if len(restore) != 1 || strings.Join(restore[0], " ") != "-i tvpn+ -d 10.16.101.1/32 -m connmark --mark 0x10000000/0x10000000 -j CONNMARK --restore-mark" {
		t.Errorf("connmark restore: %v", restore)
	}
	if save, restore := vpnDnsConnmarkRules(vpnDesired{entry: &vpnEntry{addressCidr: "10.16.101.1/24"}}); save != nil || restore != nil {
		t.Errorf("no resolver, no connmark rules")
	}
	input := vpnClientInputRules(desired)
	joined := []string{}
	for _, rule := range input {
		joined = append(joined, strings.Join(rule, " "))
	}
	accept := "-i tarmacvpn0 -d 10.16.101.1/32 -p udp --dport 53535 -j ACCEPT"
	index := -1
	for i, rule := range joined {
		if rule == accept {
			index = i
		}
	}
	if index < 0 || index >= len(joined)-1 || joined[len(joined)-1] != "-i tarmacvpn0 -j DROP" {
		t.Errorf("resolver must be accepted before the final drop: %v", joined)
	}
}

func TestSystemDnsResolvers(t *testing.T) {
	path := filepath.Join(t.TempDir(), "resolv.conf")
	_ = os.WriteFile(path, []byte("# generated\nnameserver 127.0.0.53\nnameserver fe80::1%eth0\noptions edns0\nsearch lan\n"), 0o644)
	previous := vpnResolvConfPath
	vpnResolvConfPath = path
	defer func() { vpnResolvConfPath = previous }()
	got := systemDnsResolvers()
	if len(got) != 2 || got[0] != "127.0.0.53:53" || got[1] != "[fe80::1]:53" {
		t.Errorf("resolvers: %v", got)
	}
	_ = os.WriteFile(path, []byte(""), 0o644)
	if got := systemDnsResolvers(); len(got) != 2 || got[0] != "1.1.1.1:53" {
		t.Errorf("fallback: %v", got)
	}
}

// A fake upstream answering every query with a fixed A record, on UDP and
// TCP of the same loopback port.
func dnsTestUpstream(t *testing.T, ip string) string {
	t.Helper()
	udp, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.ParseIP("127.0.0.1")})
	if err != nil {
		t.Fatal(err)
	}
	port := udp.LocalAddr().(*net.UDPAddr).Port
	tcp, err := net.ListenTCP("tcp4", &net.TCPAddr{IP: net.ParseIP("127.0.0.1"), Port: port})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { udp.Close(); tcp.Close() })
	answer := func(msg []byte) []byte {
		q, _ := parseDnsQuestion(msg)
		return dnsReply(msg, q, dnsRcodeOK, [][]byte{dnsRR(dnsTypeA, 60, net.ParseIP(ip).To4())}, nil)
	}
	go func() {
		buf := make([]byte, 65535)
		for {
			n, from, err := udp.ReadFromUDP(buf)
			if err != nil {
				return
			}
			_, _ = udp.WriteToUDP(answer(buf[:n]), from)
		}
	}()
	go func() {
		for {
			conn, err := tcp.Accept()
			if err != nil {
				return
			}
			var length [2]byte
			if _, err := io.ReadFull(conn, length[:]); err == nil {
				msg := make([]byte, binary.BigEndian.Uint16(length[:]))
				if _, err := io.ReadFull(conn, msg); err == nil {
					resp := answer(msg)
					out := make([]byte, 2)
					binary.BigEndian.PutUint16(out, uint16(len(resp)))
					_, _ = conn.Write(append(out, resp...))
				}
			}
			conn.Close()
		}
	}()
	return udp.LocalAddr().String()
}

func TestVpnDnsServerEndToEnd(t *testing.T) {
	upstream := dnsTestUpstream(t, "93.184.215.14")
	view := &vpnDnsView{
		zone:     "intranet.internal",
		ttl:      10,
		gateway:  net.ParseIP("127.0.0.1").To4(),
		byName:   map[string]net.IP{"alice": net.ParseIP("127.0.0.1").To4()},
		byAddr:   map[string]string{"127.0.0.1": "alice"},
		clients:  map[string]*vpnDnsClientView{"127.0.0.1": {self: net.ParseIP("127.0.0.1").To4()}},
		fallback: []string{"127.0.0.1:1", upstream}, // first one refuses: falls through
	}
	probe, err := net.ListenUDP("udp4", &net.UDPAddr{IP: net.ParseIP("127.0.0.1")})
	if err != nil {
		t.Fatal(err)
	}
	addr := probe.LocalAddr().String()
	probe.Close()
	server, err := startVpnDnsServer(addr, view)
	if err != nil {
		t.Fatal(err)
	}
	defer server.stop()

	exchange := func(network string, msg []byte) []byte {
		t.Helper()
		conn, err := net.DialTimeout(network, addr, time.Second)
		if err != nil {
			t.Fatal(err)
		}
		defer conn.Close()
		_ = conn.SetDeadline(time.Now().Add(5 * time.Second))
		if network == "tcp" {
			out := make([]byte, 2)
			binary.BigEndian.PutUint16(out, uint16(len(msg)))
			_, _ = conn.Write(append(out, msg...))
			var length [2]byte
			if _, err := io.ReadFull(conn, length[:]); err != nil {
				t.Fatal(err)
			}
			resp := make([]byte, binary.BigEndian.Uint16(length[:]))
			if _, err := io.ReadFull(conn, resp); err != nil {
				t.Fatal(err)
			}
			return resp
		}
		_, _ = conn.Write(msg)
		buf := make([]byte, 65535)
		n, err := conn.Read(buf)
		if err != nil {
			t.Fatal(err)
		}
		return buf[:n]
	}

	for _, network := range []string{"udp", "tcp"} {
		got := dnsTestParse(t, exchange(network, dnsTestQuery(1, "alice.intranet.internal", dnsTypeA)))
		if got.ip != "127.0.0.1" || !got.aa {
			t.Errorf("%s local: %+v", network, got)
		}
		got = dnsTestParse(t, exchange(network, dnsTestQuery(2, "example.com", dnsTypeA)))
		if got.ip != "93.184.215.14" {
			t.Errorf("%s relayed: %+v", network, got)
		}
	}

	// Records swap live, without restarting the server.
	next := *view
	next.byName = map[string]net.IP{"alice-laptop": net.ParseIP("127.0.0.1").To4()}
	server.view.Store(&next)
	if got := dnsTestParse(t, exchange("udp", dnsTestQuery(3, "alice.intranet.internal", dnsTypeA))); got.rcode != dnsRcodeNXDomain {
		t.Errorf("old name still answers: %+v", got)
	}
	if got := dnsTestParse(t, exchange("udp", dnsTestQuery(4, "alice-laptop.intranet.internal", dnsTypeA))); got.ip != "127.0.0.1" {
		t.Errorf("new name: %+v", got)
	}

	// All upstreams down: SERVFAIL, not silence.
	dead := next
	dead.fallback = []string{"127.0.0.1:1"}
	server.view.Store(&dead)
	if got := dnsTestParse(t, exchange("tcp", dnsTestQuery(5, "example.com", dnsTypeA))); got.rcode != dnsRcodeServFail {
		t.Errorf("servfail: %+v", got)
	}
	// Garbage and responses are not answered with crashes.
	if resp := server.handle([]byte{1, 2, 3}, net.ParseIP("127.0.0.1"), false); resp != nil {
		t.Errorf("short packet answered")
	}
	if resp := server.handle(append(dnsTestQuery(6, "x", dnsTypeA)[:12], 0xC0), net.ParseIP("127.0.0.1"), false); resp == nil || resp[3]&0x0F != dnsRcodeFormErr {
		t.Errorf("malformed question: %v", resp)
	}
}
