package main

import (
	"net"
	"testing"
)

func TestParseProcNetAddress(t *testing.T) {
	cases := []struct {
		field string
		ip    string
		port  int
	}{
		{"0100007F:0035", "127.0.0.1", 53},
		{"3500007F:0035", "127.0.0.53", 53},
		{"00000000:0035", "0.0.0.0", 53},
		{"00000000000000000000000000000000:0035", "::", 53},
		{"0000000000000000FFFF00000100007F:0035", "127.0.0.1", 53},
	}
	for _, c := range cases {
		ip, port, ok := parseProcNetAddress(c.field)
		if !ok || !ip.Equal(net.ParseIP(c.ip)) || port != c.port {
			t.Errorf("%s: got %v:%d ok=%v, want %s:%d", c.field, ip, port, ok, c.ip, c.port)
		}
	}
	if _, _, ok := parseProcNetAddress("zz:0035"); ok {
		t.Error("garbage address parsed")
	}
}

func TestBlocksForwarderAddress(t *testing.T) {
	for addr, want := range map[string]bool{
		"127.0.0.1": true, "0.0.0.0": true, "::": true, "::ffff:127.0.0.1": true,
		"127.0.0.53": false, "127.0.0.54": false, "10.0.0.5": false,
	} {
		if got := blocksForwarderAddress(net.ParseIP(addr)); got != want {
			t.Errorf("%s: got %v, want %v", addr, got, want)
		}
	}
}

func TestSystemdUnitFromCgroup(t *testing.T) {
	if got := systemdUnitFromCgroup("0::/system.slice/unbound.service\n"); got != "unbound.service" {
		t.Errorf("v2: got %q", got)
	}
	v1 := "12:pids:/system.slice/named.service\n1:name=systemd:/system.slice/named.service\n"
	if got := systemdUnitFromCgroup(v1); got != "named.service" {
		t.Errorf("v1: got %q", got)
	}
	if got := systemdUnitFromCgroup("0::/user.slice/user-0.slice/session-3.scope\n"); got != "" {
		t.Errorf("session: got %q", got)
	}
}

func TestDockerContainerIDFromCgroup(t *testing.T) {
	id := "4f1c2e0b9a8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d9c8b7a6f5e4d3c2b"
	for _, content := range []string{
		"0::/system.slice/docker-" + id + ".scope\n",
		"11:memory:/docker/" + id + "\n",
	} {
		if got := dockerContainerIDFromCgroup(content); got != id {
			t.Errorf("%q: got %q", content, got)
		}
	}
	if got := dockerContainerIDFromCgroup("0::/system.slice/docker.service\n"); got != "" {
		t.Errorf("docker daemon: got %q", got)
	}
}

func TestStoppableUnit(t *testing.T) {
	for unit, want := range map[string]bool{
		"unbound.service": true, "systemd-resolved.service": true, "pihole-FTL.service": true,
		"docker.service": false, "ssh.service": false, "tarmac-agent.service": false, "": false,
	} {
		if got := stoppableUnit(unit); got != want {
			t.Errorf("%s: got %v, want %v", unit, got, want)
		}
	}
}
