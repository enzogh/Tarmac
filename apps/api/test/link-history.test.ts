import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chainSegments, LinkHistoryPoint, relayGateways, uptimePercent } from '../src/vlan/link-history';

const at = (minute: number) => new Date(Date.UTC(2026, 9, 27, 10, minute, 0));
const point = (minute: number, extra: Partial<LinkHistoryPoint> = {}): LinkHistoryPoint => ({
  createdAt: at(minute),
  status: 'healthy',
  latencyMs: null,
  packetLoss: null,
  bandwidth: null,
  total: 1,
  healthy: 1,
  ...extra,
});

test('uptime is weighted by the samples each point stands for', () => {
  assert.equal(uptimePercent([]), null);
  assert.equal(uptimePercent([point(0, { total: 3, healthy: 3 }), point(1, { total: 1, healthy: 0, status: 'offline' })]), 75);
});

test('chained hops add latency, compound loss and keep the worst status', () => {
  const [chained] = chainSegments(
    [
      [point(0, { latencyMs: 79, packetLoss: 10 })],
      [point(0, { latencyMs: 0.6, packetLoss: 10, status: 'degraded', healthy: 0 })],
    ],
    60_000,
  );
  assert.equal(chained.latencyMs, 79.6);
  assert.equal(chained.packetLoss, 19);
  assert.equal(chained.status, 'degraded');
  assert.equal(chained.healthy, 0);
});

test('a hop measurement is carried over a few buckets, then dropped', () => {
  const chained = chainSegments(
    [
      [point(0, { latencyMs: 80 }), point(3), point(9)],
      [point(0, { latencyMs: 1 }), point(3), point(9)],
    ],
    60_000,
  );
  assert.deepEqual(
    chained.map((p) => p.latencyMs),
    [81, 81, null],
  );
});

test('buckets missing a hop are skipped', () => {
  const chained = chainSegments([[point(0), point(1)], [point(1)]], 60_000);
  assert.deepEqual(chained.map((p) => p.createdAt), [at(1)]);
});

test('relay path goes through the active gateways of both regions', () => {
  const nodes = [
    { id: 'ca-gw', name: 'ca-gw', locationCountryCode: 'CA' },
    { id: 'fr-gw', name: 'fr-gw', locationCountryCode: 'FR' },
    { id: 'fr-1', name: 'fr-1', locationCountryCode: 'FR' },
    { id: 'fr-2', name: 'fr-2', locationCountryCode: 'FR' },
  ];
  const gateways = new Map([
    ['north-america', 'ca-gw'],
    ['europe', 'fr-gw'],
  ] as const);
  assert.deepEqual(relayGateways(nodes, new Map(gateways), 'ca-gw', 'fr-1').map((n) => n.id), ['fr-gw']);
  assert.deepEqual(relayGateways(nodes, new Map(gateways), 'fr-1', 'fr-2'), []);
  assert.deepEqual(relayGateways(nodes, new Map([['europe', 'fr-gw']] as const), 'ca-gw', 'fr-1'), []);
});
