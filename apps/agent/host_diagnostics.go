package main

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// What hosting providers' support asks for along with the MTR before
// escalating a network ticket (see the link report in the API): the
// server's load as top prints it, and a plain ping to the other server.
// Both run while the path trace runs, so they describe the same moment.

// CPU times from the first line of /proc/stat, in clock ticks.
type cpuTimes struct {
	user, nice, system, idle, iowait, irq, softirq, steal uint64
}

func (t cpuTimes) total() uint64 {
	return t.user + t.nice + t.system + t.idle + t.iowait + t.irq + t.softirq + t.steal
}

// Shares of CPU time in percent, as top's "%Cpu(s)" line shows them.
type cpuShare struct {
	Us float64 `json:"us"`
	Sy float64 `json:"sy"`
	Ni float64 `json:"ni"`
	Id float64 `json:"id"`
	Wa float64 `json:"wa"`
	Hi float64 `json:"hi"`
	Si float64 `json:"si"`
	St float64 `json:"st"`
}

// Memory as top's "MiB Mem" / "MiB Swap" lines show it.
type memShare struct {
	TotalMiB     float64 `json:"totalMiB"`
	FreeMiB      float64 `json:"freeMiB"`
	UsedMiB      float64 `json:"usedMiB"`
	BuffCacheMiB float64 `json:"buffCacheMiB"`
	AvailMiB     float64 `json:"availMiB"`
	SwapTotalMiB float64 `json:"swapTotalMiB"`
	SwapFreeMiB  float64 `json:"swapFreeMiB"`
	SwapUsedMiB  float64 `json:"swapUsedMiB"`
}

type hostLoad struct {
	// End of the measurement, UTC.
	At string `json:"at"`
	// CPU shares are averaged over this window (the whole diagnostic).
	WindowSec float64   `json:"windowSec"`
	Cpus      int       `json:"cpus"`
	Cpu       *cpuShare `json:"cpu,omitempty"`
	Load      []float64 `json:"load,omitempty"`
	UptimeSec float64   `json:"uptimeSec"`
	Mem       *memShare `json:"mem,omitempty"`
}

type diagnosticPing struct {
	Command string `json:"command"`
	Output  string `json:"output"`
	Error   string `json:"error,omitempty"`
}

// parseCPUTimes reads the aggregate "cpu" line and counts the per-CPU ones.
func parseCPUTimes(stat string) (cpuTimes, int, bool) {
	var times cpuTimes
	found, cpus := false, 0
	for _, line := range strings.Split(stat, "\n") {
		fields := strings.Fields(line)
		if len(fields) == 0 || !strings.HasPrefix(fields[0], "cpu") {
			continue
		}
		if fields[0] != "cpu" {
			cpus++
			continue
		}
		values := make([]uint64, 8)
		for index := range values {
			if index+1 < len(fields) {
				values[index], _ = strconv.ParseUint(fields[index+1], 10, 64)
			}
		}
		times = cpuTimes{values[0], values[1], values[2], values[3], values[4], values[5], values[6], values[7]}
		found = true
	}
	return times, cpus, found
}

func readCPUTimes() (cpuTimes, int, bool) {
	raw, err := os.ReadFile("/proc/stat")
	if err != nil {
		return cpuTimes{}, 0, false
	}
	return parseCPUTimes(string(raw))
}

func cpuShareBetween(before, after cpuTimes) *cpuShare {
	total := float64(after.total() - before.total())
	if after.total() <= before.total() || total <= 0 {
		return nil
	}
	pct := func(a, b uint64) float64 {
		if b < a {
			return 0
		}
		return round1(float64(b-a) * 100 / total)
	}
	return &cpuShare{
		Us: pct(before.user, after.user),
		Sy: pct(before.system, after.system),
		Ni: pct(before.nice, after.nice),
		Id: pct(before.idle, after.idle),
		Wa: pct(before.iowait, after.iowait),
		Hi: pct(before.irq, after.irq),
		Si: pct(before.softirq, after.softirq),
		St: pct(before.steal, after.steal),
	}
}

func round1(v float64) float64 {
	return float64(int64(v*10+0.5)) / 10
}

// parseMemInfo follows procps' top: used = total - available, buff/cache
// = Buffers + Cached + SReclaimable.
func parseMemInfo(raw string) *memShare {
	kb := map[string]float64{}
	scanner := bufio.NewScanner(strings.NewReader(raw))
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		if value, err := strconv.ParseFloat(fields[1], 64); err == nil {
			kb[strings.TrimSuffix(fields[0], ":")] = value
		}
	}
	total, ok := kb["MemTotal"]
	if !ok || total <= 0 {
		return nil
	}
	avail, ok := kb["MemAvailable"]
	if !ok {
		avail = kb["MemFree"] + kb["Buffers"] + kb["Cached"]
	}
	mib := func(v float64) float64 { return round1(v / 1024) }
	return &memShare{
		TotalMiB:     mib(total),
		FreeMiB:      mib(kb["MemFree"]),
		UsedMiB:      mib(total - avail),
		BuffCacheMiB: mib(kb["Buffers"] + kb["Cached"] + kb["SReclaimable"]),
		AvailMiB:     mib(avail),
		SwapTotalMiB: mib(kb["SwapTotal"]),
		SwapFreeMiB:  mib(kb["SwapFree"]),
		SwapUsedMiB:  mib(kb["SwapTotal"] - kb["SwapFree"]),
	}
}

// hostLoadSince completes a measurement started with readCPUTimes.
func hostLoadSince(before cpuTimes, beforeOK bool, started time.Time) *hostLoad {
	now := time.Now()
	load := &hostLoad{At: now.UTC().Format(time.RFC3339), WindowSec: round1(now.Sub(started).Seconds())}
	after, cpus, afterOK := readCPUTimes()
	load.Cpus = cpus
	if beforeOK && afterOK {
		load.Cpu = cpuShareBetween(before, after)
	}
	if raw, err := os.ReadFile("/proc/loadavg"); err == nil {
		fields := strings.Fields(string(raw))
		for index := 0; index < 3 && index < len(fields); index++ {
			if value, err := strconv.ParseFloat(fields[index], 64); err == nil {
				load.Load = append(load.Load, value)
			}
		}
	}
	if raw, err := os.ReadFile("/proc/uptime"); err == nil {
		if fields := strings.Fields(string(raw)); len(fields) > 0 {
			load.UptimeSec, _ = strconv.ParseFloat(fields[0], 64)
		}
	}
	if raw, err := os.ReadFile("/proc/meminfo"); err == nil {
		load.Mem = parseMemInfo(string(raw))
	}
	return load
}

// runDiagnosticPing runs the system ping and keeps its output verbatim:
// that's what a support team expects to read. -O prints the probes left
// unanswered, so the losses show up in the listing, not only in the total.
func runDiagnosticPing(targetIP string, count int) *diagnosticPing {
	if !commandExists("ping") {
		return &diagnosticPing{Error: "ping not found on agent (install iputils-ping)"}
	}
	run := func(withO bool) (string, string) {
		args := []string{"-n", "-c", strconv.Itoa(count), "-i", "0.2", "-W", "2"}
		if withO {
			args = append(args, "-O")
		}
		args = append(args, targetIP)
		ctx, cancel := context.WithTimeout(context.Background(), time.Duration(count)*200*time.Millisecond+15*time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, "ping", args...)
		cmd.Env = append(os.Environ(), "LC_ALL=C")
		output, _ := cmd.CombinedOutput()
		return "ping " + strings.Join(args, " "), string(output)
	}
	command, output := run(true)
	if strings.Contains(output, "invalid option") || strings.Contains(output, "unrecognized option") {
		command, output = run(false)
	}
	output = strings.TrimRight(output, "\n")
	const maxOutput = 32 << 10
	if len(output) > maxOutput {
		output = output[:maxOutput]
	}
	result := &diagnosticPing{Command: command, Output: output}
	if !strings.Contains(output, "packets transmitted") {
		result.Error = fmt.Sprintf("ping failed: %s", strings.TrimSpace(output))
	}
	return result
}
