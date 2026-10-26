package main

import (
	"strings"
	"testing"
)

const testKey = "zK5TQbSagVfhf0MEF/ff8DKmemxMz3xXRrlyB5c5RA8="

func validVpnPayload() map[string]interface{} {
	return map[string]interface{}{
		"revision":      "2026-10-25T12:00:00.000Z",
		"meshInterface": "tarmacwg0",
		"meshCidr":      "10.255.0.0/16",
		"entry": map[string]interface{}{
			"interfaceName": "tarmacvpn0",
			"listenPort":    float64(51821),
			"addressCidr":   "10.255.101.1/24",
			"clientSubnet":  "10.255.101.0/24",
			"clients": []interface{}{
				map[string]interface{}{"publicKey": testKey, "presharedKey": testKey, "ip": "10.255.101.2", "table": float64(22910)},
			},
		},
		"tunnels": []interface{}{
			map[string]interface{}{"name": "tvpna75fceb6", "localIp": "10.255.0.5", "remoteIp": "10.255.0.6", "table": float64(22910)},
		},
		"natSubnets": []interface{}{"10.255.101.0/24"},
	}
}

func TestParseVpnPayloadValid(t *testing.T) {
	desired, err := parseVpnPayload(validVpnPayload())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !desired.active() || desired.entry == nil || len(desired.entry.clients) != 1 || len(desired.tunnels) != 1 {
		t.Fatalf("payload not fully parsed: %+v", desired)
	}
	if desired.entry.clients[0].table != 22910 || desired.entry.listenPort != 51821 {
		t.Fatalf("numeric fields not parsed: %+v", desired.entry)
	}
}

func TestParseVpnPayloadEmptyIsTeardown(t *testing.T) {
	desired, err := parseVpnPayload(map[string]interface{}{})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if desired.active() {
		t.Fatal("an empty payload must mean: tear everything down")
	}
}

// Everything here ends up as arguments to ip/wg/iptables: anything that
// isn't exactly the expected shape has to be refused up front.
func TestParseVpnPayloadRejectsUnsafeValues(t *testing.T) {
	cases := map[string]func(p map[string]interface{}){
		"tunnel name outside our namespace": func(p map[string]interface{}) {
			p["tunnels"].([]interface{})[0].(map[string]interface{})["name"] = "eth0"
		},
		"tunnel ip": func(p map[string]interface{}) {
			p["tunnels"].([]interface{})[0].(map[string]interface{})["remoteIp"] = "10.0.0.1; reboot"
		},
		"table outside managed range": func(p map[string]interface{}) {
			p["tunnels"].([]interface{})[0].(map[string]interface{})["table"] = float64(254)
		},
		"client key": func(p map[string]interface{}) {
			p["entry"].(map[string]interface{})["clients"].([]interface{})[0].(map[string]interface{})["publicKey"] = "-h"
		},
		"entry interface": func(p map[string]interface{}) {
			p["entry"].(map[string]interface{})["interfaceName"] = "tvpn00000000"
		},
		"nat subnet": func(p map[string]interface{}) {
			p["natSubnets"] = []interface{}{"0.0.0.0/0 -j ACCEPT"}
		},
	}
	for name, mutate := range cases {
		payload := validVpnPayload()
		mutate(payload)
		if _, err := parseVpnPayload(payload); err == nil {
			t.Errorf("%s: expected a validation error", name)
		}
	}
}

func TestNormalizeRulePrefix(t *testing.T) {
	twentyFour := 24
	if got := normalizeRulePrefix("10.255.101.0", &twentyFour); got != "10.255.101.0/24" {
		t.Errorf("got %q", got)
	}
	// `ip -j rule` omits srclen for host routes.
	if got := normalizeRulePrefix("10.255.101.2", nil); got != "10.255.101.2/32" {
		t.Errorf("got %q", got)
	}
	if got := normalizeRulePrefix("all", nil); got != "" {
		t.Errorf("got %q", got)
	}
}

func TestParseVpnPayloadPolicy(t *testing.T) {
	payload := validVpnPayload()
	payload["isolation"] = true
	client := payload["entry"].(map[string]interface{})["clients"].([]interface{})[0].(map[string]interface{})
	client["policy"] = map[string]interface{}{
		"internet": true,
		"local":    false,
		"localDns": true,
		"allow":    []interface{}{"10.255.0.7/32", "10.255.102.3/32"},
		"dns":      []interface{}{"10.255.0.9/32"},
	}
	desired, err := parseVpnPayload(payload)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	policy := desired.entry.clients[0].policy
	if !desired.isolation || !policy.internet || policy.local || !policy.localDns || len(policy.allow) != 2 || len(policy.dns) != 1 {
		t.Fatalf("policy not fully parsed: %+v", policy)
	}

	client["policy"].(map[string]interface{})["allow"] = []interface{}{"10.255.0.7/32 -j ACCEPT"}
	if _, err := parseVpnPayload(payload); err == nil {
		t.Fatal("a policy destination that isn't a CIDR must be refused")
	}
}

func TestVpnClientRulesDropByDefault(t *testing.T) {
	payload := validVpnPayload()
	payload["isolation"] = true
	desired, err := parseVpnPayload(payload)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	desired.entry.clients[0].policy = vpnPolicy{internet: true, allow: []string{"10.255.0.7/32"}}

	forward := vpnClientForwardRules(desired)
	last := forward[len(forward)-1]
	if strings.Join(last, " ") != "-i tarmacvpn0 -j DROP" {
		t.Fatalf("forward rules must end with a drop, got %v", last)
	}
	joined := make([]string, 0, len(forward))
	for _, rule := range forward {
		joined = append(joined, strings.Join(rule, " "))
	}
	all := strings.Join(joined, "\n")
	for _, want := range []string{
		"-i tarmacvpn0 -s 10.255.101.2/32 -d 10.255.0.7/32 -j ACCEPT",
		"-i tarmacvpn0 -s 10.255.101.2/32 ! -d 10.255.0.0/16 -j ACCEPT",
	} {
		if !strings.Contains(all, want) {
			t.Fatalf("missing rule %q in:\n%s", want, all)
		}
	}

	input := vpnClientInputRules(desired)
	for _, rule := range input {
		if strings.Join(rule, " ") == "-i tarmacvpn0 -s 10.255.101.2/32 -j ACCEPT" {
			t.Fatal("a client without local access must not reach the entry node")
		}
	}
}
