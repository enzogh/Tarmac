import assert from 'node:assert/strict';
import { test } from 'node:test';
import { activeGateways, GATEWAY_FAILBACK_STABLE_MS, OverlayMember, planOverlayPeers, shouldUseBackup } from '../src/vlan/overlay-topology';
import { Region } from '../src/vlan/region';

const member = (nodeId: string, region: Region | null, ip: number): OverlayMember => ({
  nodeId,
  region,
  vlanIp: `10.255.0.${ip}`,
  overlayPublicKey: `key-${nodeId}`,
  overlayEndpoint: `${nodeId}.example:51820`,
});
const fleet = [
  member('fr-gw', 'europe', 1),
  member('fr-backup', 'europe', 2),
  member('fr-1', 'europe', 3),
  member('ca-gw', 'north-america', 4),
];
const plan = (gateways: Array<[Region, string]>) => {
  const plans = planOverlayPeers(fleet, new Map(gateways));
  return Object.fromEntries(plans.map((p) => [p.nodeId, p]));
};
const peersOf = (p: ReturnType<typeof plan>[string]) =>
  Object.fromEntries(p.peers.map((peer) => [peer.nodeId, peer.allowedIps.join(',')]));

test('without gateways every node peers directly with every other', () => {
  const plans = plan([]);
  assert.deepEqual(Object.keys(peersOf(plans['fr-1'])).sort(), ['ca-gw', 'fr-backup', 'fr-gw']);
  assert.equal(plans['fr-gw'].ipForward, false);
});

test('with a gateway on both sides, cross-region traffic only goes gateway to gateway', () => {
  const plans = plan([
    ['europe', 'fr-gw'],
    ['north-america', 'ca-gw'],
  ]);
  assert.deepEqual(peersOf(plans['fr-1']), {
    'fr-gw': '10.255.0.1/32,10.255.0.4/32',
    'fr-backup': '10.255.0.2/32',
  });
  assert.deepEqual(peersOf(plans['ca-gw']), { 'fr-gw': '10.255.0.1/32,10.255.0.2/32,10.255.0.3/32' });
  assert.equal(plans['fr-gw'].ipForward, true);
  assert.equal(plans['fr-1'].ipForward, false);
});

test('a failed-over region is carried by its backup', () => {
  const plans = plan([
    ['europe', 'fr-backup'],
    ['north-america', 'ca-gw'],
  ]);
  assert.deepEqual(peersOf(plans['ca-gw']), { 'fr-backup': '10.255.0.1/32,10.255.0.2/32,10.255.0.3/32' });
  assert.equal(peersOf(plans['fr-1'])['fr-backup'], '10.255.0.2/32,10.255.0.4/32');
  assert.equal(plans['fr-backup'].ipForward, true);
  assert.equal(plans['fr-gw'].ipForward, false);
});

test('active gateway is the primary unless the region failed over', () => {
  const candidates = [
    { nodeId: 'fr-gw', region: 'europe' as Region, isPrimary: true, isBackup: false },
    { nodeId: 'fr-backup', region: 'europe' as Region, isPrimary: false, isBackup: true },
  ];
  assert.equal(activeGateways(candidates, new Set()).get('europe'), 'fr-gw');
  assert.equal(activeGateways(candidates, new Set<Region>(['europe'])).get('europe'), 'fr-backup');
});

test('failover waits for a dead primary and a live backup, failback for a stable primary', () => {
  assert.equal(shouldUseBackup(false, true, true, 0), false);
  assert.equal(shouldUseBackup(false, false, false, 0), false);
  assert.equal(shouldUseBackup(false, false, true, 0), true);
  assert.equal(shouldUseBackup(true, false, true, 0), true);
  assert.equal(shouldUseBackup(true, true, true, 30_000), true);
  assert.equal(shouldUseBackup(true, true, true, GATEWAY_FAILBACK_STABLE_MS), false);
  assert.equal(shouldUseBackup(true, true, false, 0), false);
});
