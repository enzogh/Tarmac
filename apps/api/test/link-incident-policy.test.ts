import assert from 'node:assert/strict';
import test from 'node:test';
import {
  captureVerdict,
  isLinkIncident,
  linkDegradedNodes,
  unhealthyDurationMs,
  INCIDENT_MIN_UNHEALTHY_MS,
} from '../src/vlan/link-incident-policy';
import type { TraceOutcome } from '../src/vlan/link-report';

const T0 = new Date('2026-11-18T12:00:00Z').getTime();
const at = (sec: number) => new Date(T0 + sec * 1000);
const from = at(0);
const to = at(600);

test('unhealthy time: a ~100 s blip stays under the bar', () => {
  const ms = unhealthyDurationMs(
    [
      { sourceNodeId: 'a', status: 'healthy', at: at(-30) },
      { sourceNodeId: 'a', status: 'degraded', at: at(20) },
      { sourceNodeId: 'a', status: 'healthy', at: at(125) },
      { sourceNodeId: 'b', status: 'healthy', at: at(-10) },
    ],
    from,
    to,
  );
  assert.equal(ms, 105_000);
  assert.ok(ms < INCIDENT_MIN_UNHEALTHY_MS);
});

test('unhealthy time: both directions degraded together count once, status carried into the window', () => {
  const ms = unhealthyDurationMs(
    [
      // Already degraded when the window opens.
      { sourceNodeId: 'a', status: 'degraded', at: at(-40) },
      { sourceNodeId: 'a', status: 'healthy', at: at(200) },
      { sourceNodeId: 'b', status: 'degraded', at: at(100) },
      { sourceNodeId: 'b', status: 'healthy', at: at(300) },
      { sourceNodeId: 'a', status: 'offline', at: at(500) },
    ],
    from,
    to,
  );
  // [0, 300) merged + [500, 600) still down at the end.
  assert.equal(ms, 400_000);
});

function outcome(pingLossPct: number | null, mtrDestLossPct: number | null = 0, reached = true): TraceOutcome {
  return {
    ok: true,
    ranAt: from,
    trace: {
      ping: pingLossPct === null ? undefined : { output: `100 packets transmitted, ${100 - pingLossPct} received, ${pingLossPct}% packet loss` },
      hops: mtrDestLossPct === null ? [] : [{ lossPct: 0 }, { lossPct: mtrDestLossPct }],
      reached,
    } as never,
  };
}

test('capture verdict: background loss is clean, 3 lost packets confirm', () => {
  assert.equal(captureVerdict([outcome(1, 3.33), outcome(2, 0)], false), 'clean');
  assert.equal(captureVerdict([outcome(1, 0), outcome(3, 0)], false), 'confirmed');
  assert.equal(captureVerdict([outcome(0, 10), outcome(0, 0)], false), 'confirmed');
});

test('capture verdict: pings dropped by the firewall measure nothing', () => {
  assert.equal(captureVerdict([outcome(100, null, false), outcome(100, null, false)], true), 'unmeasured');
  assert.equal(captureVerdict([outcome(100, null, false)], false), 'confirmed');
  assert.equal(captureVerdict([{ ok: false, reason: 'hors ligne' }], false), 'unmeasured');
});

test('incident: needs both persistence and confirmed loss', () => {
  assert.equal(isLinkIncident(110_000, 'confirmed'), false);
  assert.equal(isLinkIncident(400_000, 'clean'), false);
  assert.equal(isLinkIncident(400_000, 'confirmed'), true);
  // Nothing measurable: how long it lasted decides.
  assert.equal(isLinkIncident(400_000, 'unmeasured'), true);
});

test('link-degraded key: the two servers', () => {
  assert.deepEqual(linkDegradedNodes('link-degraded:vlan1:n1:n2'), ['n1', 'n2']);
  assert.equal(linkDegradedNodes('vlan-link:vlan1:n1:n2'), null);
});
