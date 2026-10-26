package main

import (
	"encoding/binary"
	"errors"
	"fmt"
	"net"
	"os"
	"syscall"
	"time"
)

const (
	tracerouteMaxHops     = 15
	traceroutePerHopWait  = time.Second
	tracerouteMaxSilences = 4

	icmpEchoReply      = 0
	icmpUnreachable    = 3
	icmpEchoRequest    = 8
	icmpTimeExceeded   = 11
	icmpHeaderLength   = 8
	ipv4MinHeaderBytes = 20
)

// Built in rather than shelling out to traceroute/tracepath: neither ships
// with minimal cloud images, and their UDP probes are dropped by firewalls
// that let ping through. ICMP echo with a growing TTL follows exactly the
// path a ping takes, so a pair that answers the ping tab traces too.
func nativeTraceroute(target net.IP) ([]tracerouteHop, error) {
	conn, err := net.ListenPacket("ip4:icmp", "0.0.0.0")
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	ipConn, ok := conn.(*net.IPConn)
	if !ok {
		return nil, errors.New("raw ICMP socket unavailable")
	}
	rawConn, err := ipConn.SyscallConn()
	if err != nil {
		return nil, err
	}

	id := uint16(os.Getpid() & 0xffff)
	hops := make([]tracerouteHop, 0, tracerouteMaxHops)
	silences := 0
	buf := make([]byte, 1500)

	for ttl := 1; ttl <= tracerouteMaxHops; ttl++ {
		var sockErr error
		if err := rawConn.Control(func(fd uintptr) {
			sockErr = syscall.SetsockoptInt(int(fd), syscall.IPPROTO_IP, syscall.IP_TTL, ttl)
		}); err != nil {
			return nil, err
		}
		if sockErr != nil {
			return nil, sockErr
		}

		seq := uint16(ttl)
		sentAt := time.Now()
		if _, err := ipConn.WriteTo(icmpEchoPacket(id, seq), &net.IPAddr{IP: target}); err != nil {
			return nil, tracerouteProbeError{err}
		}

		hop := tracerouteHop{Hop: ttl}
		reached, unreachable := false, false
		deadline := sentAt.Add(traceroutePerHopWait)
		for {
			_ = ipConn.SetReadDeadline(deadline)
			n, from, err := ipConn.ReadFrom(buf)
			if err != nil {
				break // per-hop timeout: no answer at this TTL
			}
			kind, matched := matchTraceReply(buf[:n], id, seq)
			if !matched {
				continue // someone else's ICMP (a concurrent ping, another probe)
			}
			ip := from.(*net.IPAddr).IP.String()
			latency := float64(time.Since(sentAt).Microseconds()) / 1000
			hop.IP, hop.LatencyMs = &ip, &latency
			reached = kind == icmpEchoReply
			unreachable = kind == icmpUnreachable
			break
		}
		hops = append(hops, hop)

		if reached || unreachable {
			break
		}
		if hop.IP == nil {
			silences++
			if silences >= tracerouteMaxSilences {
				break
			}
		} else {
			silences = 0
		}
	}
	return hops, nil
}

func icmpEchoPacket(id, seq uint16) []byte {
	packet := make([]byte, icmpHeaderLength+16)
	packet[0] = icmpEchoRequest
	binary.BigEndian.PutUint16(packet[4:], id)
	binary.BigEndian.PutUint16(packet[6:], seq)
	copy(packet[icmpHeaderLength:], "tarmac-traceroute")
	binary.BigEndian.PutUint16(packet[2:], icmpChecksum(packet))
	return packet
}

func icmpChecksum(data []byte) uint16 {
	var sum uint32
	for i := 0; i+1 < len(data); i += 2 {
		sum += uint32(binary.BigEndian.Uint16(data[i:]))
	}
	if len(data)%2 == 1 {
		sum += uint32(data[len(data)-1]) << 8
	}
	for sum>>16 != 0 {
		sum = (sum & 0xffff) + (sum >> 16)
	}
	return ^uint16(sum)
}

// Tells whether an ICMP message (IPv4 header already stripped by the
// socket) answers our probe: an echo reply carries id/seq directly, a
// time-exceeded or unreachable quotes our original IP header + the first
// 8 bytes of the echo request.
func matchTraceReply(msg []byte, id, seq uint16) (int, bool) {
	if len(msg) < icmpHeaderLength {
		return 0, false
	}
	kind := int(msg[0])
	switch kind {
	case icmpEchoReply:
		return kind, binary.BigEndian.Uint16(msg[4:]) == id && binary.BigEndian.Uint16(msg[6:]) == seq
	case icmpTimeExceeded, icmpUnreachable:
		quoted := msg[icmpHeaderLength:]
		if len(quoted) < ipv4MinHeaderBytes {
			return 0, false
		}
		headerLen := int(quoted[0]&0x0f) * 4
		if headerLen < ipv4MinHeaderBytes || len(quoted) < headerLen+icmpHeaderLength {
			return 0, false
		}
		inner := quoted[headerLen:]
		return kind, inner[0] == icmpEchoRequest && binary.BigEndian.Uint16(inner[4:]) == id && binary.BigEndian.Uint16(inner[6:]) == seq
	}
	return 0, false
}

// The probe left the socket but the kernel refused to send it: no system
// tool would do better, so this is the answer rather than a reason to fall
// back.
type tracerouteProbeError struct{ err error }

func (e tracerouteProbeError) Error() string { return e.err.Error() }

func describeTraceError(targetIP string, err error) error {
	if errors.Is(err, syscall.ENOKEY) {
		return fmt.Errorf("aucun pair WireGuard ne mène à %s depuis ce nœud : son maillage n'est pas encore à jour", targetIP)
	}
	if errors.Is(err, syscall.ENETUNREACH) || errors.Is(err, syscall.EHOSTUNREACH) {
		return fmt.Errorf("aucune route vers %s depuis ce nœud", targetIP)
	}
	return fmt.Errorf("traceroute vers %s impossible : %v", targetIP, err)
}
