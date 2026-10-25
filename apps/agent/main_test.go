package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// commandExists memoizes $PATH lookups, but the agent installs packages
// itself (ensureAgentSystemPackages, ensureRclone). Without the reset those
// call sites now perform, a "not found" cached before an install outlived the
// install for the whole life of the process - the reason a node that had just
// had smartmontools installed reported no SMART data until its next restart.
func TestResetCommandExistsCacheSeesANewlyInstalledBinary(t *testing.T) {
	binDir := t.TempDir()
	t.Setenv("PATH", binDir+string(os.PathListSeparator)+os.Getenv("PATH"))

	const name = "tarmac-test-binary"
	resetCommandExistsCache()
	t.Cleanup(resetCommandExistsCache)

	if commandExists(name) {
		t.Fatalf("commandExists(%q) = true before the binary exists", name)
	}

	if err := os.WriteFile(filepath.Join(binDir, name), []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatalf("cannot create the test binary: %v", err)
	}

	if commandExists(name) {
		t.Fatalf("commandExists(%q) = true, want the memoized miss until the cache is reset", name)
	}

	resetCommandExistsCache()
	if !commandExists(name) {
		t.Fatalf("commandExists(%q) = false after resetCommandExistsCache, want true", name)
	}
}

// The reporting cycle collects the disks once and hands them to both the
// heartbeat and the state report, so buildStateReport must use what it is
// given rather than walking /proc/mounts again.
func TestBuildStateReportReusesTheGivenDisks(t *testing.T) {
	disks := []diskState{{Name: "sda1", MountPath: "/", CapacityGb: 100, UsedGb: 42}}

	report := buildStateReport("node-1", disks)

	if report.NodeID != "node-1" {
		t.Errorf("NodeID = %q, want %q", report.NodeID, "node-1")
	}
	if len(report.Disks) != 1 || report.Disks[0].Name != "sda1" {
		t.Errorf("Disks = %+v, want the single disk it was given", report.Disks)
	}
}

// collectSmartReports must never block its caller on smartctl: it answers
// from cache and refreshes in the background, so the reporting cycle (and
// with it the node showing up as online) is never held up by a disk that
// takes its time replying.
func TestCollectSmartReportsAnswersFromCacheWithoutBlocking(t *testing.T) {
	smartCache.mu.Lock()
	smartCache.reports = []smartState{{DiskName: "sda", Overall: "healthy"}}
	smartCache.collected = true
	smartCache.collectedAt = time.Now()
	smartCache.refreshing = false
	smartCache.mu.Unlock()
	t.Cleanup(func() {
		smartCache.mu.Lock()
		smartCache.reports = nil
		smartCache.collected = false
		smartCache.refreshing = false
		smartCache.mu.Unlock()
	})

	reports := collectSmartReports()
	if len(reports) != 1 || reports[0].DiskName != "sda" {
		t.Fatalf("collectSmartReports() = %+v, want the cached report", reports)
	}

	smartCache.mu.Lock()
	refreshing := smartCache.refreshing
	smartCache.mu.Unlock()
	if refreshing {
		t.Error("a fresh cache entry triggered a background refresh")
	}
}
