package main

import (
	"testing"
	"time"
)

const iputilsOneLost = `PING 10.255.0.196 (10.255.0.196) 56(84) bytes of data.
64 bytes from 10.255.0.196: icmp_seq=1 ttl=64 time=82.1 ms
64 bytes from 10.255.0.196: icmp_seq=2 ttl=64 time=80.9 ms
64 bytes from 10.255.0.196: icmp_seq=4 ttl=64 time=1077 ms
64 bytes from 10.255.0.196: icmp_seq=5 ttl=64 time=81.5 ms

--- 10.255.0.196 ping statistics ---
5 packets transmitted, 4 received, 20% packet loss, time 808ms
rtt min/avg/max/mdev = 80.900/330.375/1077.000/431.200 ms
`

const busyboxAll = `PING 10.255.0.174 (10.255.0.174): 56 data bytes
64 bytes from 10.255.0.174: seq=0 ttl=64 time=23.112 ms
64 bytes from 10.255.0.174: seq=1 ttl=64 time=22.904 ms
64 bytes from 10.255.0.174: seq=2 ttl=64 time=23.500 ms
64 bytes from 10.255.0.174: seq=3 ttl=64 time=24.010 ms
64 bytes from 10.255.0.174: seq=4 ttl=64 time=23.000 ms

--- 10.255.0.174 ping statistics ---
5 packets transmitted, 5 packets received, 0% packet loss
round-trip min/avg/max = 22.904/23.305/24.010 ms
`

const iputilsDead = `PING 10.255.0.9 (10.255.0.9) 56(84) bytes of data.

--- 10.255.0.9 ping statistics ---
5 packets transmitted, 0 received, 100% packet loss, time 818ms
`

func TestParseOverlayPing(t *testing.T) {
	reading, ok := parseOverlayPing(iputilsOneLost)
	if !ok || reading.sent != 5 || reading.received != 4 {
		t.Fatalf("iputils counts: %+v ok=%v", reading, ok)
	}
	// Median, not the 330 ms average dragged up by one slow reply.
	if reading.latencyMs == nil || *reading.latencyMs != 81.8 {
		t.Fatalf("median latency: %v", reading.latencyMs)
	}

	reading, ok = parseOverlayPing(busyboxAll)
	if !ok || reading.sent != 5 || reading.received != 5 || reading.latencyMs == nil || *reading.latencyMs != 23.11 {
		t.Fatalf("busybox: %+v ok=%v lat=%v", reading, ok, reading.latencyMs)
	}

	reading, ok = parseOverlayPing(iputilsDead)
	if !ok || reading.sent != 5 || reading.received != 0 || reading.latencyMs != nil {
		t.Fatalf("dead: %+v ok=%v", reading, ok)
	}

	if _, ok := parseOverlayPing("ping: connect: Network is unreachable\n"); ok {
		t.Fatalf("no summary must not count as a result")
	}

	dup := "64 bytes from 1.1.1.1: icmp_seq=1 ttl=64 time=5 ms\n64 bytes from 1.1.1.1: icmp_seq=1 ttl=64 time=6 ms (DUP!)\n1 packets transmitted, 1 received, +1 duplicates, 0% packet loss\n"
	if reading, _ := parseOverlayPing(dup); reading.received != 1 || reading.sent != 1 {
		t.Fatalf("duplicates: %+v", reading)
	}
}

func overlayTestReading(received int, latency float64) overlayPingReading {
	reading := overlayPingReading{sent: 5, received: received}
	if received > 0 {
		reading.latencyMs = &latency
	}
	return reading
}

func TestOverlayProbeWindow(t *testing.T) {
	now := time.Now()
	var snap overlayProbeSnapshot

	// One lost ping among 20 recent ones: 5 %, under the 8 % bar (it used
	// to read 50 %).
	for _, received := range []int{5, 5, 4, 5} {
		snap = nextOverlayProbe(snap, overlayTestReading(received, 82), now)
	}
	if snap.packetLoss != 5 || !snap.hasLatency || snap.consecutiveFailures != 0 {
		t.Fatalf("isolated loss: %+v", snap)
	}

	// The lost ping leaves the window after 4 more probes.
	for i := 0; i < 3; i++ {
		snap = nextOverlayProbe(snap, overlayTestReading(5, 82), now)
	}
	if snap.packetLoss != 0 || len(snap.window) != overlayProbeWindow {
		t.Fatalf("window slide: %+v", snap)
	}

	// Real, repeated loss still shows: 2 lost per probe = 40 %.
	for i := 0; i < 4; i++ {
		snap = nextOverlayProbe(snap, overlayTestReading(3, 82), now)
	}
	if snap.packetLoss != 40 {
		t.Fatalf("sustained loss: %+v", snap)
	}

	// A dead link is reported at once, not averaged away.
	snap = nextOverlayProbe(snap, overlayTestReading(0, 0), now)
	if snap.packetLoss != 100 || snap.hasLatency || snap.consecutiveFailures != 1 {
		t.Fatalf("dead: %+v", snap)
	}
	snap = nextOverlayProbe(snap, overlayTestReading(0, 0), now)
	if snap.consecutiveFailures != 2 {
		t.Fatalf("failures must accumulate for the backoff: %+v", snap)
	}

	// Back up: fresh window, the outage doesn't linger as "degraded".
	snap = nextOverlayProbe(snap, overlayTestReading(5, 81), now)
	if snap.packetLoss != 0 || snap.consecutiveFailures != 0 || len(snap.window) != 1 || snap.latencyMs != 81 {
		t.Fatalf("recovery: %+v", snap)
	}
}

// Against the real control-plane rules: the flapping seen in production (one
// lost ping now and then over a ~80 ms transatlantic link) stays healthy.
func TestOverlayProbeAgainstThreshold(t *testing.T) {
	now := time.Now()
	var snap overlayProbeSnapshot
	worst := 0.0
	for i := 0; i < 200; i++ {
		received := 5
		if i%7 == 0 { // one drop every ~3 minutes, as observed
			received = 4
		}
		snap = nextOverlayProbe(snap, overlayTestReading(received, 82), now)
		if snap.packetLoss > worst {
			worst = snap.packetLoss
		}
	}
	if worst >= 8 {
		t.Fatalf("occasional single drops must stay under the 8 %% degraded bar, peaked at %v", worst)
	}
}
