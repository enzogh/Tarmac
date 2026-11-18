package main

import (
	"encoding/binary"
	"errors"
	"math"
	"net"
	"os"
	"sort"
	"strings"
	"syscall"
	"time"
)

// MTR-style path measurement (command.run_path_trace), for the link reports
// sent to hosting providers: the route over the internet to another node's
// PUBLIC address, every hop probed several times, with per-hop loss and
// latency - the table providers' support teams ask for.
//
// Every round sends one ICMP echo per TTL (5 ms apart) and then waits up to
// a second for the answers; late answers are still matched to their probe
// in the next rounds. Once the destination answers, later rounds stop at
// its hop. Ten rounds take about 11 s.
const (
	pathTraceMaxHops       = 30
	pathTraceDefaultRounds = 10
	pathTraceMaxRounds     = 30
	pathTraceRoundWait     = time.Second
	pathTraceSendGap       = 5 * time.Millisecond
	// A destination that never answers (ping filtered): probe a few hops
	// past the last router that did, not all 30.
	pathTraceSilentTail = 3
	// Answers kept per probe for the classic traceroute listing (3 probes
	// per hop, like traceroute itself).
	pathTraceListedProbes = 3
	pathTraceMaxPings     = 200
)

type pathTraceHop struct {
	Hop      int      `json:"hop"`
	IP       *string  `json:"ip"`
	OtherIPs []string `json:"otherIps,omitempty"`
	Sent     int      `json:"sent"`
	Received int      `json:"received"`
	LossPct  float64  `json:"lossPct"`
	LastMs   *float64 `json:"lastMs"`
	AvgMs    *float64 `json:"avgMs"`
	BestMs   *float64 `json:"bestMs"`
	WorstMs  *float64 `json:"worstMs"`
	StdevMs  *float64 `json:"stdevMs"`
	// The first rounds' probes one by one (nil when unanswered), for the
	// traceroute listing.
	Probes []*pathTraceSample `json:"probes"`
}

type pathTraceSample struct {
	IP string  `json:"ip"`
	Ms float64 `json:"ms"`
}

type pathTraceData struct {
	TargetIP string         `json:"targetIp"`
	Rounds   int            `json:"rounds"`
	Reached  bool           `json:"reached"`
	Hops     []pathTraceHop `json:"hops"`
	// Asked with pingCount / withLoad: a plain ping to the same address and
	// the server's load during the whole diagnostic.
	Ping   *diagnosticPing `json:"ping,omitempty"`
	System *hostLoad       `json:"system,omitempty"`
}

type pathTraceStat struct {
	sent     int
	received int
	rtts     []float64
	last     float64
	ips      map[string]int
	probes   []*pathTraceSample
}

type pathTraceProbe struct {
	ttl    int
	round  int
	sentAt time.Time
}

// parsePathReply extracts the kind and sequence of an ICMP message answering
// one of our probes (echo reply, or time-exceeded / unreachable quoting it).
func parsePathReply(msg []byte, id uint16) (kind int, seq uint16, ok bool) {
	if len(msg) < icmpHeaderLength {
		return 0, 0, false
	}
	kind = int(msg[0])
	switch kind {
	case icmpEchoReply:
		if binary.BigEndian.Uint16(msg[4:]) != id {
			return 0, 0, false
		}
		return kind, binary.BigEndian.Uint16(msg[6:]), true
	case icmpTimeExceeded, icmpUnreachable:
		quoted := msg[icmpHeaderLength:]
		if len(quoted) < ipv4MinHeaderBytes {
			return 0, 0, false
		}
		headerLen := int(quoted[0]&0x0f) * 4
		if headerLen < ipv4MinHeaderBytes || len(quoted) < headerLen+icmpHeaderLength {
			return 0, 0, false
		}
		inner := quoted[headerLen:]
		if inner[0] != icmpEchoRequest || binary.BigEndian.Uint16(inner[4:]) != id {
			return 0, 0, false
		}
		return kind, binary.BigEndian.Uint16(inner[6:]), true
	}
	return 0, 0, false
}

func runPathTrace(payload map[string]interface{}) (pathTraceData, error) {
	targetIP := strings.TrimSpace(readString(payload, "targetIp"))
	target := net.ParseIP(targetIP).To4()
	if target == nil {
		return pathTraceData{}, errors.New("targetIp is required (IPv4)")
	}
	rounds := readInt(payload, "rounds", pathTraceDefaultRounds)
	if rounds < 1 {
		rounds = 1
	}
	if rounds > pathTraceMaxRounds {
		rounds = pathTraceMaxRounds
	}
	pingCount := readInt(payload, "pingCount", 0)
	if pingCount > pathTraceMaxPings {
		pingCount = pathTraceMaxPings
	}
	withLoad, _ := payload["withLoad"].(bool)

	conn, err := net.ListenPacket("ip4:icmp", "0.0.0.0")
	if err != nil {
		return pathTraceData{}, err
	}
	defer conn.Close()
	ipConn, ok := conn.(*net.IPConn)
	if !ok {
		return pathTraceData{}, errors.New("raw ICMP socket unavailable")
	}
	rawConn, err := ipConn.SyscallConn()
	if err != nil {
		return pathTraceData{}, err
	}
	// Not the plain traceroute's id: both may run at the same time.
	id := uint16(os.Getpid()&0xffff) ^ 0x5a5a

	// The ping and the load measurement cover the same time as the trace.
	started := time.Now()
	cpuBefore, _, cpuOK := readCPUTimes()
	var pingDone chan *diagnosticPing
	if pingCount > 0 {
		pingDone = make(chan *diagnosticPing, 1)
		go func() { pingDone <- runDiagnosticPing(targetIP, pingCount) }()
	}

	stats := map[int]*pathTraceStat{}
	pending := map[uint16]pathTraceProbe{}
	limit, destTTL := pathTraceMaxHops, 0

	// A dedicated reader stamps every answer the moment it arrives: reading
	// only between sends would charge the first hops for the time the rest
	// of the round took to go out.
	type arrival struct {
		kind int
		seq  uint16
		from string
		at   time.Time
	}
	arrivals := make(chan arrival, 4096)
	go func() {
		defer close(arrivals)
		buf := make([]byte, 1500)
		for {
			n, from, err := ipConn.ReadFrom(buf)
			if err != nil {
				return // socket closed when the trace is over
			}
			at := time.Now()
			kind, seq, matched := parsePathReply(buf[:n], id)
			if !matched {
				continue
			}
			select {
			case arrivals <- arrival{kind: kind, seq: seq, from: from.(*net.IPAddr).IP.String(), at: at}:
			default:
			}
		}
	}()
	record := func(answer arrival) {
		probe, known := pending[answer.seq]
		if !known {
			return
		}
		delete(pending, answer.seq)
		stat := stats[probe.ttl]
		rtt := float64(answer.at.Sub(probe.sentAt).Microseconds()) / 1000
		stat.received++
		stat.rtts = append(stat.rtts, rtt)
		stat.last = rtt
		stat.ips[answer.from]++
		if probe.round < len(stat.probes) {
			stat.probes[probe.round] = &pathTraceSample{IP: answer.from, Ms: round2(rtt)}
		}
		if answer.kind == icmpEchoReply && (destTTL == 0 || probe.ttl < destTTL) {
			destTTL = probe.ttl
		}
	}
	drain := func() {
		for {
			select {
			case answer := <-arrivals:
				record(answer)
			default:
				return
			}
		}
	}
	collect := func(until time.Time) {
		timer := time.NewTimer(time.Until(until))
		defer timer.Stop()
		for {
			select {
			case answer, open := <-arrivals:
				if !open {
					return
				}
				record(answer)
			case <-timer.C:
				return
			}
		}
	}

	for round := 0; round < rounds; round++ {
		for ttl := 1; ttl <= limit; ttl++ {
			var sockErr error
			if err := rawConn.Control(func(fd uintptr) {
				sockErr = syscall.SetsockoptInt(int(fd), syscall.IPPROTO_IP, syscall.IP_TTL, ttl)
			}); err != nil {
				return pathTraceData{}, err
			}
			if sockErr != nil {
				return pathTraceData{}, sockErr
			}
			seq := uint16(round*pathTraceMaxHops + ttl)
			if stats[ttl] == nil {
				listed := rounds
				if listed > pathTraceListedProbes {
					listed = pathTraceListedProbes
				}
				stats[ttl] = &pathTraceStat{ips: map[string]int{}, probes: make([]*pathTraceSample, listed)}
			}
			// Registered before the send: an answer can't beat its probe.
			pending[seq] = pathTraceProbe{ttl: ttl, round: round, sentAt: time.Now()}
			if _, err := ipConn.WriteTo(icmpEchoPacket(id, seq), &net.IPAddr{IP: target}); err != nil {
				return pathTraceData{}, describeTraceError(targetIP, err)
			}
			stats[ttl].sent++
			time.Sleep(pathTraceSendGap)
			drain()
		}
		collect(time.Now().Add(pathTraceRoundWait))

		switch {
		case destTTL > 0:
			limit = destTTL
		case round == 0:
			highest := 0
			for ttl, stat := range stats {
				if stat.received > 0 && ttl > highest {
					highest = ttl
				}
			}
			limit = highest + pathTraceSilentTail
			if limit > pathTraceMaxHops {
				limit = pathTraceMaxHops
			}
		}
	}

	last := limit
	if destTTL > 0 {
		last = destTTL
	}
	data := pathTraceData{TargetIP: targetIP, Rounds: rounds, Reached: destTTL > 0, Hops: []pathTraceHop{}}
	for ttl := 1; ttl <= last; ttl++ {
		stat := stats[ttl]
		if stat == nil || stat.sent == 0 {
			continue
		}
		data.Hops = append(data.Hops, summarizePathHop(ttl, stat))
	}
	if pingDone != nil {
		data.Ping = <-pingDone
	}
	if withLoad {
		data.System = hostLoadSince(cpuBefore, cpuOK, started)
	}
	return data, nil
}

func summarizePathHop(ttl int, stat *pathTraceStat) pathTraceHop {
	hop := pathTraceHop{Hop: ttl, Sent: stat.sent, Received: stat.received}
	hop.LossPct = round2(float64(stat.sent-stat.received) * 100 / float64(stat.sent))
	// Most frequent responder first; others are equal-cost paths.
	type seen struct {
		ip    string
		count int
	}
	responders := make([]seen, 0, len(stat.ips))
	for ip, count := range stat.ips {
		responders = append(responders, seen{ip, count})
	}
	sort.Slice(responders, func(i, j int) bool {
		if responders[i].count != responders[j].count {
			return responders[i].count > responders[j].count
		}
		return responders[i].ip < responders[j].ip
	})
	for index, responder := range responders {
		if index == 0 {
			ip := responder.ip
			hop.IP = &ip
		} else {
			hop.OtherIPs = append(hop.OtherIPs, responder.ip)
		}
	}
	if len(stat.rtts) > 0 {
		sum, best, worst := 0.0, stat.rtts[0], stat.rtts[0]
		for _, rtt := range stat.rtts {
			sum += rtt
			if rtt < best {
				best = rtt
			}
			if rtt > worst {
				worst = rtt
			}
		}
		avg, lastMs := round2(sum/float64(len(stat.rtts))), round2(stat.last)
		best, worst = round2(best), round2(worst)
		hop.AvgMs, hop.BestMs, hop.WorstMs, hop.LastMs = &avg, &best, &worst, &lastMs
		// Sample standard deviation, as mtr reports it.
		stdev := 0.0
		if len(stat.rtts) > 1 {
			mean, squares := sum/float64(len(stat.rtts)), 0.0
			for _, rtt := range stat.rtts {
				squares += (rtt - mean) * (rtt - mean)
			}
			stdev = math.Sqrt(squares / float64(len(stat.rtts)-1))
		}
		stdev = round2(stdev)
		hop.StdevMs = &stdev
	}
	hop.Probes = stat.probes
	if hop.Probes == nil {
		hop.Probes = []*pathTraceSample{}
	}
	return hop
}
