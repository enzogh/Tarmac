package main

import (
	"context"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Overlay link probe (latency / loss reported with every heartbeat).
//
// It used to be 2 pings with a 1 s timeout: a single lost or late reply read
// as 50 % loss - far above the control plane's 8 % "degraded" bar - and the
// link flapped degraded/healthy every few minutes while 300 pings in a row
// went through without a single loss. Now:
//   - 5 pings 200 ms apart (about a second per probe; probes of different
//     peers still run in parallel), each allowed 2 s to come back, so a slow
//     reply counts as latency, not loss;
//   - latency is the median reply, so one slow packet doesn't move it;
//   - loss is computed over the last overlayProbeWindow probes (~20 pings,
//     ~100 s): one isolated drop is 5 %, it takes repeated losses to cross
//     the bar;
//   - a probe that gets no reply at all is still reported at once as 100 %
//     loss (a dead link must not wait for the window to fill), and the
//     first answered probe after it starts a fresh window (a recovered link
//     doesn't drag its outage along for another minute and a half).
const (
	overlayProbePings  = 5
	overlayProbeWindow = 4
	overlayProbeWaitS  = 2
	overlayProbeMaxRun = 5 * time.Second
)

type overlayPingCount struct {
	sent     int
	received int
}

type overlayPingReading struct {
	sent      int
	received  int
	latencyMs *float64
}

// parseOverlayPing reads iputils / busybox ping output: the summary line for
// the counts, every "time=" reply for the median latency.
func parseOverlayPing(output string) (overlayPingReading, bool) {
	reading := overlayPingReading{}
	times := []float64{}
	haveSummary := false
	for _, line := range strings.Split(output, "\n") {
		trimmed := strings.TrimSpace(line)
		if index := strings.Index(trimmed, "time="); index >= 0 && strings.Contains(trimmed, "from") {
			raw := strings.TrimSpace(trimmed[index+len("time="):])
			raw = strings.TrimSpace(strings.TrimSuffix(strings.Fields(raw + " ")[0], "ms"))
			if value, err := strconv.ParseFloat(raw, 64); err == nil && value >= 0 {
				times = append(times, value)
			}
			continue
		}
		if strings.Contains(trimmed, "transmitted") && strings.Contains(trimmed, "received") {
			for _, chunk := range strings.Split(trimmed, ",") {
				fields := strings.Fields(strings.TrimSpace(chunk))
				if len(fields) < 2 {
					continue
				}
				value, err := strconv.Atoi(fields[0])
				if err != nil {
					continue
				}
				switch {
				case strings.Contains(chunk, "transmitted"):
					reading.sent = value
					haveSummary = true
				case strings.Contains(chunk, "received"):
					reading.received = value
				}
			}
		}
	}
	if !haveSummary {
		return reading, false
	}
	// Duplicates (DUP!) can make the reply lines outnumber the probes.
	if reading.received > reading.sent {
		reading.received = reading.sent
	}
	if len(times) > 0 {
		sort.Float64s(times)
		median := times[len(times)/2]
		if len(times)%2 == 0 {
			median = (times[len(times)/2-1] + times[len(times)/2]) / 2
		}
		median = round2(median)
		reading.latencyMs = &median
	}
	return reading, reading.sent > 0
}

// probeOverlayLatency pings a peer's private address. ok=false means no
// usable ping result at all (no binary, no output), not a lost link.
func probeOverlayLatency(iface, targetIP string) (overlayPingReading, bool) {
	if targetIP == "" || !commandExists("ping") {
		return overlayPingReading{}, false
	}
	base := []string{"-n", "-c", strconv.Itoa(overlayProbePings), "-i", "0.2", "-W", strconv.Itoa(overlayProbeWaitS)}
	// Kernel routing first (the WireGuard route already wins), then forced
	// through the overlay interface: avoids a false "dead" when the first
	// path fails and -I succeeds.
	commands := [][]string{
		append(append([]string{}, base...), targetIP),
		append(append([]string{"-I", iface}, base...), targetIP),
	}
	var fallback overlayPingReading
	haveFallback := false
	for _, args := range commands {
		ctx, cancel := context.WithTimeout(context.Background(), overlayProbeMaxRun)
		output, _ := exec.CommandContext(ctx, "ping", args...).CombinedOutput()
		cancel()
		reading, ok := parseOverlayPing(string(output))
		if !ok {
			continue
		}
		if reading.received > 0 {
			return reading, true
		}
		// Everything lost: keep it, but try the other path first.
		if !haveFallback {
			fallback, haveFallback = reading, true
		}
	}
	return fallback, haveFallback
}

// nextOverlayProbe folds a new reading into the cached snapshot and returns
// it along with what to report (latency nil = no reply this time).
func nextOverlayProbe(previous overlayProbeSnapshot, reading overlayPingReading, now time.Time) overlayProbeSnapshot {
	next := overlayProbeSnapshot{at: now, hasLoss: true}
	if reading.received == 0 {
		next.consecutiveFailures = previous.consecutiveFailures + 1
		next.packetLoss = 100
		next.window = append(trimOverlayWindow(previous.window, overlayProbeWindow-1), overlayPingCount{sent: reading.sent})
		return next
	}

	window := previous.window
	// Back from a dead probe: the outage is over, start counting afresh.
	if previous.consecutiveFailures > 0 {
		window = nil
	}
	window = append(trimOverlayWindow(window, overlayProbeWindow-1), overlayPingCount{sent: reading.sent, received: reading.received})
	sent, received := 0, 0
	for _, count := range window {
		sent += count.sent
		received += count.received
	}
	next.window = window
	// Until the window is full (agent just started, link just back), count
	// against a full window's worth of pings: one lost ping is then 5 %
	// whenever it happens, while heavy loss (2+ of the first 5) still
	// shows right away.
	denominator := sent
	if full := overlayProbeWindow * reading.sent; denominator < full {
		denominator = full
	}
	if denominator > 0 {
		next.packetLoss = round2(float64(sent-received) * 100 / float64(denominator))
	}
	if reading.latencyMs != nil {
		next.hasLatency = true
		next.latencyMs = *reading.latencyMs
	}
	return next
}

func trimOverlayWindow(window []overlayPingCount, keep int) []overlayPingCount {
	if keep <= 0 {
		return []overlayPingCount{}
	}
	if len(window) > keep {
		window = window[len(window)-keep:]
	}
	return append([]overlayPingCount{}, window...)
}
