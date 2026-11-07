package main

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func writeContainer(t *testing.T, root, id, name, hostconfig string) {
	t.Helper()
	dir := filepath.Join(root, id)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "hostconfig.json"), []byte(hostconfig), 0o600); err != nil {
		t.Fatal(err)
	}
	if name != "" {
		if err := os.WriteFile(filepath.Join(dir, "config.v2.json"), []byte(`{"Name":"/`+name+`"}`), 0o600); err != nil {
			t.Fatal(err)
		}
	}
}

func withDockerContainersDir(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	previous := dockerContainersDir
	dockerContainersDir = root
	t.Cleanup(func() { dockerContainersDir = previous })
	return root
}

func TestDockerReservedLoopbackTCPPorts(t *testing.T) {
	root := withDockerContainersDir(t)
	// Stalwart as found on KS_5: admin UI on loopback, SMTP on the public IP.
	writeContainer(t, root, "b470f181494f", "stalwart", `{
		"RestartPolicy": {"Name": "unless-stopped"},
		"PortBindings": {
			"8080/tcp": [{"HostIp": "127.0.0.1", "HostPort": "8090"}],
			"25/tcp":   [{"HostIp": "51.68.36.61", "HostPort": "25"}],
			"993/tcp":  [{"HostIp": "", "HostPort": "993"}],
			"53/udp":   [{"HostIp": "0.0.0.0", "HostPort": "5353"}]
		}}`)
	// Never started by Docker on its own: does not claim its port.
	writeContainer(t, root, "aaaaaaaaaaaa", "oneshot", `{
		"RestartPolicy": {"Name": "no"},
		"PortBindings": {"80/tcp": [{"HostIp": "127.0.0.1", "HostPort": "8092"}]}}`)
	writeContainer(t, root, "cccccccccccccccc", "", `{
		"RestartPolicy": {"Name": "always"},
		"PortBindings": {"80/tcp": [{"HostIp": "0.0.0.0", "HostPort": "8093"}]}}`)
	writeContainer(t, root, "broken", "broken", `{not json`)

	got := dockerReservedLoopbackTCPPorts()
	want := map[int]string{8090: "stalwart", 993: "stalwart", 8093: "conteneur cccccccccccc"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for port, name := range want {
		if got[port] != name {
			t.Fatalf("port %d: got %q, want %q (all: %v)", port, got[port], name, got)
		}
	}
}

func TestDockerReservedPortsWithoutDocker(t *testing.T) {
	dockerContainersDir = filepath.Join(t.TempDir(), "absent")
	t.Cleanup(func() { dockerContainersDir = "/var/lib/docker/containers" })
	if got := dockerReservedLoopbackTCPPorts(); len(got) != 0 {
		t.Fatalf("got %v, want none", got)
	}
}

// The KS_5 case: at boot nothing listens on the preferred port yet, but a
// container publishes it. The next free port must be chosen.
func TestPickInternalPdnsApiPortSkipsDockerPorts(t *testing.T) {
	root := withDockerContainersDir(t)

	// A free port, so that "nothing listens there yet" holds for the test.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	preferred := ln.Addr().(*net.TCPAddr).Port
	ln.Close()

	writeContainer(t, root, "b470f181494f", "stalwart", `{
		"RestartPolicy": {"Name": "unless-stopped"},
		"PortBindings": {"8080/tcp": [{"HostIp": "127.0.0.1", "HostPort": "`+strconv.Itoa(preferred)+`"}]}}`)

	got, err := pickInternalPdnsApiPort(context.Background(), preferred)
	if err != nil {
		t.Fatal(err)
	}
	if got == preferred {
		t.Fatalf("picked %d, which Docker container stalwart publishes", got)
	}
	if got != preferred+1 {
		t.Logf("picked %d (next free after %d)", got, preferred)
	}
}
