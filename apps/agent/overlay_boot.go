package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// The private network has to come back on its own after a reboot.
//
// tarmacwg0 used to be created only when the control plane sent
// apply_overlay. On the node that hosts the control plane, that is a
// deadlock: Docker starts first, every container whose ports are bound to
// the node's overlay IP fails with "cannot assign requested address", the
// API is one of them, so it never sends the overlay that would bring that
// IP back. Ordinary nodes were also cut off from the private network (NFS,
// internal services) until the control plane answered.
//
// The agent now keeps the last overlay it applied on disk, re-applies it
// when it starts, and installs a oneshot unit that does the same before
// docker.service on the next boot.

const (
	overlayBootUnitName = "tarmac-overlay-restore.service"
	overlayRestoreFlag  = "--restore-overlay"
)

func overlayStatePath() string {
	return envOrDefault("AGENT_OVERLAY_STATE_PATH", "/var/lib/tarmac-agent/wireguard/overlay.json")
}

// overlayPersist stores the payload of the last successful apply_overlay.
// It only holds public data (address, port, peers' public keys and
// endpoints); the private key stays in its own file.
func overlayPersist(payload map[string]interface{}) {
	data, err := json.Marshal(payload)
	if err != nil {
		return
	}
	path := overlayStatePath()
	if current, err := os.ReadFile(path); err == nil && string(current) == string(data) {
		return
	}
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		log.Printf("overlay: cannot persist state: %v", err)
		return
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0600); err != nil {
		log.Printf("overlay: cannot persist state: %v", err)
		return
	}
	if err := os.Rename(tmp, path); err != nil {
		log.Printf("overlay: cannot persist state: %v", err)
	}
}

// restoreOverlayFromDisk re-applies the saved overlay. errNoSavedOverlay
// means this node never had one, which is not a failure.
var errNoSavedOverlay = errors.New("no saved overlay")

func restoreOverlayFromDisk() (string, error) {
	data, err := os.ReadFile(overlayStatePath())
	if err != nil {
		if os.IsNotExist(err) {
			return "", errNoSavedOverlay
		}
		return "", err
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(data, &payload); err != nil {
		return "", fmt.Errorf("saved overlay unreadable: %w", err)
	}
	return applyOverlay(payload)
}

func overlayInterfaceName(payload map[string]interface{}) string {
	if iface := readString(payload, "interfaceName"); iface != "" {
		return iface
	}
	return "tarmacwg0"
}

// restoreOverlayAtStartup runs when the agent process starts. If the boot
// unit already brought the interface up, it is left alone: re-applying
// would flush and re-add its address under running services for nothing.
func restoreOverlayAtStartup() {
	data, err := os.ReadFile(overlayStatePath())
	if err != nil {
		return
	}
	var payload map[string]interface{}
	if err := json.Unmarshal(data, &payload); err != nil {
		log.Printf("overlay: saved state unreadable, ignored: %v", err)
		return
	}
	iface := overlayInterfaceName(payload)
	if exec.Command("ip", "link", "show", iface).Run() == nil {
		return
	}
	if message, err := applyOverlay(payload); err != nil {
		log.Printf("overlay: restoring saved overlay failed: %v", err)
	} else {
		log.Printf("overlay: saved overlay restored (%s)", message)
	}
}

// runOverlayRestoreCommand is the boot unit's entry point
// (tarmac-agent --restore-overlay). It returns the process exit code.
func runOverlayRestoreCommand() int {
	message, err := restoreOverlayFromDisk()
	switch {
	case errors.Is(err, errNoSavedOverlay):
		log.Printf("overlay: nothing to restore")
		return 0
	case err != nil:
		log.Printf("overlay: restore failed: %v", err)
		return 1
	default:
		log.Printf("overlay: %s", message)
		return 0
	}
}

func overlayBootUnitContent(binary string) string {
	return fmt.Sprintf(`[Unit]
Description=Tarmac private network (WireGuard) before Docker
Documentation=https://github.com/enzogh/Tarmac
After=network.target systemd-modules-load.service
Before=docker.service tarmac-agent.service
ConditionPathExists=%s

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=%s %s
TimeoutStartSec=30

[Install]
WantedBy=multi-user.target
`, overlayStatePath(), binary, overlayRestoreFlag)
}

// ensureOverlayBootUnit installs and enables the boot unit. It is cheap to
// call on every apply_overlay: nothing is written or reloaded when the unit
// on disk is already current. The unit only orders itself before Docker
// (Before=, no Requires=), so a failed restore never keeps Docker down.
func ensureOverlayBootUnit() {
	if !commandExists("systemctl") {
		return
	}
	binary, err := os.Executable()
	if err != nil || strings.TrimSpace(binary) == "" {
		binary = "/usr/local/bin/tarmac-agent"
	}
	unitPath := filepath.Join("/etc/systemd/system", overlayBootUnitName)
	content := overlayBootUnitContent(binary)
	if current, err := os.ReadFile(unitPath); err == nil && string(current) == content {
		return
	}
	if err := os.WriteFile(unitPath, []byte(content), 0o644); err != nil {
		log.Printf("overlay: cannot write %s: %v", overlayBootUnitName, err)
		return
	}
	if out, err := exec.Command("systemctl", "daemon-reload").CombinedOutput(); err != nil {
		log.Printf("overlay: systemctl daemon-reload failed: %s", strings.TrimSpace(string(out)))
		return
	}
	// enable without --now: the interface is already up, the unit is for
	// the next boot.
	if out, err := exec.Command("systemctl", "enable", overlayBootUnitName).CombinedOutput(); err != nil {
		log.Printf("overlay: cannot enable %s: %s", overlayBootUnitName, strings.TrimSpace(string(out)))
		return
	}
	log.Printf("overlay: %s installed (private network restored before Docker at boot)", overlayBootUnitName)
}
