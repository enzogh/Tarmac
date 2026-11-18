package main

import (
	"encoding/binary"
	"testing"
)

func pathTestQuoted(kind byte, id, seq uint16) []byte {
	msg := make([]byte, icmpHeaderLength+ipv4MinHeaderBytes+icmpHeaderLength)
	msg[0] = kind
	quoted := msg[icmpHeaderLength:]
	quoted[0] = 0x45 // IPv4, 20-byte header
	inner := quoted[ipv4MinHeaderBytes:]
	inner[0] = icmpEchoRequest
	binary.BigEndian.PutUint16(inner[4:], id)
	binary.BigEndian.PutUint16(inner[6:], seq)
	return msg
}

func TestParsePathReply(t *testing.T) {
	echo := icmpEchoPacket(0x1234, 42)
	echo[0] = icmpEchoReply
	if kind, seq, ok := parsePathReply(echo, 0x1234); !ok || kind != icmpEchoReply || seq != 42 {
		t.Fatalf("echo reply: kind=%d seq=%d ok=%v", kind, seq, ok)
	}
	if _, _, ok := parsePathReply(echo, 0x9999); ok {
		t.Fatalf("someone else's echo reply must not match")
	}
	if kind, seq, ok := parsePathReply(pathTestQuoted(icmpTimeExceeded, 0x1234, 7), 0x1234); !ok || kind != icmpTimeExceeded || seq != 7 {
		t.Fatalf("time exceeded: kind=%d seq=%d ok=%v", kind, seq, ok)
	}
	if _, _, ok := parsePathReply(pathTestQuoted(icmpUnreachable, 0x4321, 7), 0x1234); ok {
		t.Fatalf("quoted probe of another id must not match")
	}
	if _, _, ok := parsePathReply([]byte{11, 0, 0}, 0x1234); ok {
		t.Fatalf("truncated message must not match")
	}
}

func TestSummarizePathHop(t *testing.T) {
	stat := &pathTraceStat{sent: 10, received: 8, rtts: []float64{2, 4, 3, 3, 3, 3, 3, 3}, last: 3, ips: map[string]int{"10.0.0.1": 6, "10.0.0.2": 2}}
	hop := summarizePathHop(5, stat)
	if hop.Hop != 5 || hop.LossPct != 20 || hop.Sent != 10 || hop.Received != 8 {
		t.Fatalf("counts: %+v", hop)
	}
	if *hop.IP != "10.0.0.1" || len(hop.OtherIPs) != 1 || hop.OtherIPs[0] != "10.0.0.2" {
		t.Fatalf("responders: %v %v", *hop.IP, hop.OtherIPs)
	}
	if *hop.AvgMs != 3 || *hop.BestMs != 2 || *hop.WorstMs != 4 || *hop.LastMs != 3 {
		t.Fatalf("latency: %v %v %v %v", *hop.AvgMs, *hop.BestMs, *hop.WorstMs, *hop.LastMs)
	}
	if *hop.StdevMs != 0.53 || len(hop.Probes) != 0 {
		t.Fatalf("stdev/probes: %v %v", *hop.StdevMs, hop.Probes)
	}
	listed := summarizePathHop(2, &pathTraceStat{sent: 3, received: 1, rtts: []float64{1}, last: 1, ips: map[string]int{"10.0.0.9": 1}, probes: []*pathTraceSample{nil, {IP: "10.0.0.9", Ms: 1}, nil}})
	if len(listed.Probes) != 3 || listed.Probes[0] != nil || listed.Probes[1].IP != "10.0.0.9" || *listed.StdevMs != 0 {
		t.Fatalf("listed probes: %+v", listed)
	}
	silent := summarizePathHop(6, &pathTraceStat{sent: 10, ips: map[string]int{}})
	if silent.IP != nil || silent.LossPct != 100 || silent.AvgMs != nil {
		t.Fatalf("silent hop: %+v", silent)
	}
}
