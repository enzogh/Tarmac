package main

import (
	"encoding/binary"
	"testing"
)

func TestMatchTraceReply(t *testing.T) {
	probe := icmpEchoPacket(0x1234, 3)

	reply := append([]byte(nil), probe...)
	reply[0] = icmpEchoReply
	if kind, ok := matchTraceReply(reply, 0x1234, 3); !ok || kind != icmpEchoReply {
		t.Fatalf("echo reply not matched: kind=%d ok=%v", kind, ok)
	}
	if _, ok := matchTraceReply(reply, 0x1234, 4); ok {
		t.Fatal("echo reply for another seq matched")
	}

	// Time exceeded quoting a 20-byte IP header + our echo request.
	quotedIP := make([]byte, 20)
	quotedIP[0] = 0x45
	exceeded := append([]byte{icmpTimeExceeded, 0, 0, 0, 0, 0, 0, 0}, quotedIP...)
	exceeded = append(exceeded, probe[:8]...)
	if kind, ok := matchTraceReply(exceeded, 0x1234, 3); !ok || kind != icmpTimeExceeded {
		t.Fatalf("time exceeded not matched: kind=%d ok=%v", kind, ok)
	}
	binary.BigEndian.PutUint16(exceeded[8+20+4:], 0x9999)
	if _, ok := matchTraceReply(exceeded, 0x1234, 3); ok {
		t.Fatal("time exceeded for another process matched")
	}
	if _, ok := matchTraceReply(exceeded[:20], 0x1234, 3); ok {
		t.Fatal("truncated message matched")
	}
}

func TestIcmpChecksumVerifies(t *testing.T) {
	if icmpChecksum(icmpEchoPacket(1, 1)) != 0 {
		t.Fatal("checksum of a checksummed packet must fold to zero")
	}
}
