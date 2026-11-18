package main

import "testing"

func TestParseCPUTimes(t *testing.T) {
	stat := "cpu  100 5 50 800 20 3 7 15 0 0\ncpu0 50 2 25 400 10 1 3 8 0 0\ncpu1 50 3 25 400 10 2 4 7 0 0\nintr 1 2 3\n"
	times, cpus, ok := parseCPUTimes(stat)
	if !ok || cpus != 2 || times.user != 100 || times.steal != 15 || times.total() != 1000 {
		t.Fatalf("parse: %+v cpus=%d ok=%v", times, cpus, ok)
	}
	after := times
	after.user += 20
	after.idle += 70
	after.steal += 10
	share := cpuShareBetween(times, after)
	if share == nil || share.Us != 20 || share.Id != 70 || share.St != 10 || share.Sy != 0 {
		t.Fatalf("share: %+v", share)
	}
	if cpuShareBetween(times, times) != nil {
		t.Fatalf("no elapsed ticks must give no share")
	}
}

func TestParseMemInfo(t *testing.T) {
	mem := parseMemInfo("MemTotal:  8388608 kB\nMemFree:  1048576 kB\nMemAvailable:  4194304 kB\nBuffers:  102400 kB\nCached:  2097152 kB\nSReclaimable: 51200 kB\nSwapTotal: 2097152 kB\nSwapFree: 1048576 kB\n")
	if mem == nil || mem.TotalMiB != 8192 || mem.FreeMiB != 1024 || mem.UsedMiB != 4096 || mem.AvailMiB != 4096 {
		t.Fatalf("mem: %+v", mem)
	}
	if mem.BuffCacheMiB != 2198 || mem.SwapUsedMiB != 1024 {
		t.Fatalf("buff/cache or swap: %+v", mem)
	}
	if parseMemInfo("garbage") != nil {
		t.Fatalf("no MemTotal must give nil")
	}
}
