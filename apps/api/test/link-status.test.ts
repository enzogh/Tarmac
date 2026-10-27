import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyLink } from '../src/vlan/link-status';

const sameRegion = { peerOnline: true, crossRegion: false };

test('a link answering its probes is healthy', () => {
  assert.equal(classifyLink({ handshakeAgeSec: 30, latencyMs: 2, packetLoss: 0 }, sameRegion), 'healthy');
});

test('outgoing traffic alone no longer proves a dead link healthy', () => {
  // tx is not even part of the telemetry considered: only rx counts.
  assert.equal(classifyLink({ handshakeAgeSec: 700, packetLoss: 100 }, sameRegion), 'offline');
  assert.equal(classifyLink({ handshakeAgeSec: 300, packetLoss: 100 }, sameRegion), 'offline');
});

test('lost pings over a fresh handshake read as filtered ICMP, not down', () => {
  assert.equal(classifyLink({ handshakeAgeSec: 20, packetLoss: 100 }, sameRegion), 'degraded');
});

test('received traffic keeps a link out of offline', () => {
  assert.equal(classifyLink({ handshakeAgeSec: 700, rxMbps: 0.4, packetLoss: 100 }, sameRegion), 'degraded');
  assert.equal(classifyLink({ handshakeAgeSec: 700, rxMbps: 0.4 }, sameRegion), 'healthy');
});

test('a stale handshake with nothing else is offline', () => {
  assert.equal(classifyLink({ handshakeAgeSec: 900 }, sameRegion), 'offline');
  assert.equal(classifyLink({ handshakeAgeSec: 300 }, sameRegion), 'degraded');
  assert.equal(classifyLink({}, sameRegion), 'degraded');
});

test('latency thresholds depend on crossing regions', () => {
  assert.equal(classifyLink({ handshakeAgeSec: 10, latencyMs: 200 }, sameRegion), 'degraded');
  assert.equal(classifyLink({ handshakeAgeSec: 10, latencyMs: 200 }, { peerOnline: true, crossRegion: true }), 'healthy');
});

test('partial loss and an offline peer degrade the link', () => {
  assert.equal(classifyLink({ handshakeAgeSec: 10, latencyMs: 3, packetLoss: 50 }, sameRegion), 'degraded');
  assert.equal(classifyLink({ handshakeAgeSec: 10, latencyMs: 3 }, { peerOnline: false, crossRegion: false }), 'degraded');
});
