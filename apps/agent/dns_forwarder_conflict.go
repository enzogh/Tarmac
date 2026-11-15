package main

import (
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Port conflicts of the local *.tarmac.local forwarder (dnsmasq), and the
// ways out the panel offers for them.
//
// The forwarder only listens on 127.0.0.1:53 (bind-interfaces), so only a
// socket holding that address, or every address, gets in its way. Probing
// ":53" instead flagged nodes where systemd-resolved's stub listens on
// 127.0.0.53, or a service on a public address, although dnsmasq starts
// fine next to them.

// internalDnsHostsModeMarkerPath records the "use /etc/hosts" choice made
// from the panel for a node whose port 53 belongs to something else: names
// are then written to /etc/hosts on every route push, and whatever holds
// the port is left alone.
var internalDnsHostsModeMarkerPath = "/etc/tarmac-agent/internal-dns-hosts-mode"

func internalDnsHostsModeEnabled() bool {
	_, err := os.Stat(internalDnsHostsModeMarkerPath)
	return err == nil
}

func setInternalDnsHostsMode(enabled bool) error {
	if !enabled {
		if err := os.Remove(internalDnsHostsModeMarkerPath); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(internalDnsHostsModeMarkerPath), 0o755); err != nil {
		return err
	}
	return os.WriteFile(internalDnsHostsModeMarkerPath, []byte("enabled\n"), 0o600)
}

// forwarderListenBusy reports whether 127.0.0.1:53 can't be bound.
func forwarderListenBusy(protocol string) bool {
	switch protocol {
	case "tcp":
		ln, err := net.Listen("tcp", "127.0.0.1:53")
		if err != nil {
			return true
		}
		ln.Close()
	case "udp":
		pc, err := net.ListenPacket("udp", "127.0.0.1:53")
		if err != nil {
			return true
		}
		pc.Close()
	}
	return false
}

func blocksForwarderAddress(ip net.IP) bool {
	return ip.IsUnspecified() || ip.Equal(net.IPv4(127, 0, 0, 1))
}

// probeForwarderPortConflict says who holds 127.0.0.1:53, or nil when the
// forwarder can bind it.
func probeForwarderPortConflict() *dnsPortConflict {
	for _, protocol := range []string{"tcp", "udp"} {
		if !forwarderListenBusy(protocol) {
			continue
		}
		conflict := &dnsPortConflict{Port: 53, Protocol: protocol}
		pid, name := findProcessOnPortMatching(53, protocol, blocksForwarderAddress)
		conflict.ProcessName = name
		if pid > 0 {
			conflict.PID = &pid
			conflict.Container = dockerContainerOfPID(pid)
		}
		if conflict.Container == "" && (name == "docker-proxy" || pid == 0) {
			conflict.Container = dockerContainerPublishing(53, protocol)
		}
		// A container's port can't be freed by stopping a unit: that unit
		// is docker itself. The panel then only offers /etc/hosts.
		if pid > 0 && conflict.Container == "" {
			if unit := systemdUnitOfPID(pid); stoppableUnit(unit) {
				conflict.Unit = unit
			}
		}
		return conflict
	}
	return nil
}

// parseProcNetAddress decodes the "0100007F:0035" form of /proc/net/{tcp,udp}
// (each 32-bit word in host byte order, little-endian on every platform the
// agent ships for).
func parseProcNetAddress(field string) (net.IP, int, bool) {
	parts := strings.Split(field, ":")
	if len(parts) != 2 {
		return nil, 0, false
	}
	raw, err := hex.DecodeString(parts[0])
	if err != nil || (len(raw) != 4 && len(raw) != 16) {
		return nil, 0, false
	}
	port, err := strconv.ParseUint(parts[1], 16, 16)
	if err != nil {
		return nil, 0, false
	}
	ip := make(net.IP, len(raw))
	for word := 0; word < len(raw); word += 4 {
		for i := 0; i < 4; i++ {
			ip[word+i] = raw[word+3-i]
		}
	}
	return ip, int(port), true
}

// systemdUnitOfPID returns the .service a process runs in, from its cgroup
// ("0::/system.slice/unbound.service"), or "" outside of any service.
func systemdUnitOfPID(pid int) string {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/cgroup", pid))
	if err != nil {
		return ""
	}
	return systemdUnitFromCgroup(string(data))
}

func systemdUnitFromCgroup(content string) string {
	for _, line := range strings.Split(content, "\n") {
		fields := strings.SplitN(line, ":", 3)
		if len(fields) != 3 {
			continue
		}
		segments := strings.Split(fields[2], "/")
		for i := len(segments) - 1; i >= 0; i-- {
			if strings.HasSuffix(segments[i], ".service") {
				return segments[i]
			}
		}
	}
	return ""
}

// stoppableUnit leaves out what stopping would cut the node off from the
// control plane or take down every container: the panel must never offer it.
func stoppableUnit(unit string) bool {
	if unit == "" {
		return false
	}
	name := strings.TrimSuffix(unit, ".service")
	switch name {
	case "docker", "containerd", "ssh", "sshd", "dbus", "systemd-networkd", "NetworkManager", "init":
		return false
	}
	return !strings.HasPrefix(name, "tarmac") && !strings.HasPrefix(name, "user@")
}

// dockerContainerOfPID names the container a process runs in (a container
// on the host network binds port 53 directly, without docker-proxy).
func dockerContainerOfPID(pid int) string {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/cgroup", pid))
	if err != nil {
		return ""
	}
	id := dockerContainerIDFromCgroup(string(data))
	if id == "" {
		return ""
	}
	return dockerContainerName(filepath.Join(dockerContainersDir, id), id)
}

func dockerContainerIDFromCgroup(content string) string {
	for _, line := range strings.Split(content, "\n") {
		fields := strings.SplitN(line, ":", 3)
		if len(fields) != 3 {
			continue
		}
		for _, segment := range strings.Split(fields[2], "/") {
			segment = strings.TrimSuffix(strings.TrimPrefix(segment, "docker-"), ".scope")
			if len(segment) == 64 {
				if _, err := hex.DecodeString(segment); err == nil {
					return segment
				}
			}
		}
	}
	return ""
}

// dockerContainerPublishing names a container publishing port/protocol on
// loopback or every address (docker-proxy holds the port for it).
func dockerContainerPublishing(port int, protocol string) string {
	dirs, err := os.ReadDir(dockerContainersDir)
	if err != nil {
		return ""
	}
	want := strconv.Itoa(port)
	for _, dir := range dirs {
		if !dir.IsDir() {
			continue
		}
		base := filepath.Join(dockerContainersDir, dir.Name())
		cfg, ok := readDockerHostConfig(base)
		if !ok || !dockerContainerRunning(base) {
			continue
		}
		for containerPort, bindings := range cfg.PortBindings {
			if !strings.HasSuffix(containerPort, "/"+protocol) {
				continue
			}
			for _, binding := range bindings {
				if binding.HostPort == want && bindsLoopback(binding.HostIP) {
					return dockerContainerName(base, dir.Name())
				}
			}
		}
	}
	return ""
}
