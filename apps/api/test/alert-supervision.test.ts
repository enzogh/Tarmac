import assert from 'node:assert/strict';
import { test } from 'node:test';
import { alertKey, nodesCoveredBy, parseAlertKey } from '../src/alerts/alert-keys';
import {
  isNodeFresh,
  NODE_OFFLINE_ALERT_AFTER_MS,
  NodeSignal,
  planNodeOutageReports,
  RecoveryGate,
  Streak,
} from '../src/alerts/node-availability';

const NOW = Date.parse('2026-11-05T17:20:00Z');
const secondsAgo = (seconds: number) => new Date(NOW - seconds * 1000);

function node(id: string, silentSeconds: number, extra: Partial<NodeSignal> = {}): NodeSignal {
  return {
    id,
    name: id.toUpperCase(),
    workspaceId: 'ws-a',
    status: silentSeconds > 60 ? 'offline' : 'online',
    lastSeenAt: secondsAgo(silentSeconds),
    mutedUntil: null,
    ...extra,
  };
}

test('a node heartbeating every few seconds is fresh, one silent for a minute is not', () => {
  assert.equal(isNodeFresh(node('a', 5), NOW), true);
  assert.equal(isNodeFresh(node('a', 45), NOW), false);
  assert.equal(isNodeFresh({ status: 'offline', lastSeenAt: secondsAgo(1) }, NOW), false);
});

test('an agent restart or a reboot (under 3 minutes of silence) raises nothing', () => {
  assert.deepEqual(planNodeOutageReports([node('a', 150), node('b', 2)], new Set(), NOW), []);
});

test('a node silent past the delay is reported on its own', () => {
  const reports = planNodeOutageReports([node('ovh', NODE_OFFLINE_ALERT_AFTER_MS / 1000 + 5), node('b', 2)], new Set(), NOW);
  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0].nodes.map((n) => n.id), ['ovh']);
});

test('nodes of a workspace going down together make a single report', () => {
  const reports = planNodeOutageReports([node('a', 200), node('b', 120), node('c', 95), node('d', 3)], new Set(), NOW);
  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0].nodes.map((n) => n.id), ['a', 'b', 'c']);
});

test('each workspace gets its own report', () => {
  const reports = planNodeOutageReports([node('a', 200), node('b', 200, { workspaceId: 'ws-b' })], new Set(), NOW);
  assert.deepEqual(reports.map((r) => r.workspaceId).sort(), ['ws-a', 'ws-b']);
});

test('muted, already reported and long-dead nodes are left out', () => {
  const muted = node('m', 600, { mutedUntil: new Date(NOW + 3600_000) });
  const reported = node('r', 600);
  const dead = node('old', 3 * 24 * 3600);
  assert.deepEqual(planNodeOutageReports([muted, reported, dead], new Set(['r']), NOW), []);
});

test('a link that comes back briefly between two drops is not closed', () => {
  const gate = new RecoveryGate();
  const key = 'vlan-link:v:a:b';
  assert.equal(gate.observe(key, true, 120_000, NOW), false);
  assert.equal(gate.observe(key, true, 120_000, NOW + 60_000), false);
  assert.equal(gate.observe(key, false, 120_000, NOW + 90_000), false); // dropped again
  assert.equal(gate.observe(key, true, 120_000, NOW + 100_000), false);
  assert.equal(gate.observe(key, true, 120_000, NOW + 230_000), true);
});

test('an event-type condition closes on the first clean check', () => {
  const gate = new RecoveryGate();
  assert.equal(gate.observe('sync-job:j', true, 0, NOW), true);
});

test('a threshold rule needs consecutive breaches, a single spike resets', () => {
  const streak = new Streak();
  assert.equal(streak.observe('r:n', true), 1);
  assert.equal(streak.observe('r:n', false), 1);
  assert.equal(streak.observe('r:n', true), 1);
  assert.equal(streak.observe('r:n', true), 2);
});

test('keys: a VLAN pair has one key whichever side reports it', () => {
  assert.equal(alertKey.vlanLink('v', 'b', 'a'), alertKey.vlanLink('v', 'a', 'b'));
  assert.deepEqual(parseAlertKey(alertKey.vlanLink('v', 'b', 'a')), { kind: 'vlan-link', parts: ['v', 'a', 'b'] });
});

test('keys: outage alerts tell which nodes they cover', () => {
  assert.deepEqual(nodesCoveredBy(alertKey.nodeOffline('n1')), ['n1']);
  assert.deepEqual(nodesCoveredBy(alertKey.nodesOffline('ws', ['n2', 'n1'])), ['n1', 'n2']);
  assert.deepEqual(nodesCoveredBy(alertKey.syncJob('j')), []);
});
