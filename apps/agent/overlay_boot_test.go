package main

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestOverlayPersistRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "wireguard", "overlay.json")
	t.Setenv("AGENT_OVERLAY_STATE_PATH", path)

	payload := map[string]interface{}{
		"interfaceName": "tarmacwg0",
		"addressCidr":   "10.255.0.176/24",
		"listenPort":    float64(51820),
		"peers": []interface{}{
			map[string]interface{}{"publicKey": "abc=", "endpoint": "1.2.3.4:51820", "allowedIps": []interface{}{"10.255.0.33/32"}},
		},
	}
	overlayPersist(payload)

	info, err := os.Stat(path)
	if err != nil {
		t.Fatalf("state not written: %v", err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("state mode = %v, want 0600", info.Mode().Perm())
	}
	before := info.ModTime()

	// Same payload again (sent every few minutes): file left untouched.
	overlayPersist(payload)
	if info, _ := os.Stat(path); !info.ModTime().Equal(before) {
		t.Fatalf("unchanged payload rewrote the state file")
	}

	data, _ := os.ReadFile(path)
	for _, want := range []string{`"addressCidr":"10.255.0.176/24"`, `"publicKey":"abc="`} {
		if !strings.Contains(string(data), want) {
			t.Fatalf("state %s missing %s", data, want)
		}
	}
}

func TestRestoreOverlayWithoutSavedState(t *testing.T) {
	t.Setenv("AGENT_OVERLAY_STATE_PATH", filepath.Join(t.TempDir(), "missing.json"))
	if _, err := restoreOverlayFromDisk(); !errors.Is(err, errNoSavedOverlay) {
		t.Fatalf("err = %v, want errNoSavedOverlay", err)
	}
	if code := runOverlayRestoreCommand(); code != 0 {
		t.Fatalf("exit code = %d, want 0 when there is nothing to restore", code)
	}
}

func TestRestoreOverlayRejectsCorruptState(t *testing.T) {
	path := filepath.Join(t.TempDir(), "overlay.json")
	t.Setenv("AGENT_OVERLAY_STATE_PATH", path)
	if err := os.WriteFile(path, []byte("{not json"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := restoreOverlayFromDisk(); err == nil || errors.Is(err, errNoSavedOverlay) {
		t.Fatalf("err = %v, want an unreadable-state error", err)
	}
}

func TestOverlayBootUnitOrdersBeforeDocker(t *testing.T) {
	t.Setenv("AGENT_OVERLAY_STATE_PATH", "/var/lib/tarmac-agent/wireguard/overlay.json")
	unit := overlayBootUnitContent("/usr/local/bin/tarmac-agent")
	for _, want := range []string{
		"Before=docker.service tarmac-agent.service",
		"ConditionPathExists=/var/lib/tarmac-agent/wireguard/overlay.json",
		"ExecStart=/usr/local/bin/tarmac-agent --restore-overlay",
		"Type=oneshot",
		"WantedBy=multi-user.target",
	} {
		if !strings.Contains(unit, want) {
			t.Fatalf("unit missing %q:\n%s", want, unit)
		}
	}
	// Ordering only: a failed restore must never keep Docker from starting.
	if strings.Contains(unit, "Requires=") || strings.Contains(unit, "RequiredBy=") {
		t.Fatalf("unit must not make Docker depend on it:\n%s", unit)
	}
}
