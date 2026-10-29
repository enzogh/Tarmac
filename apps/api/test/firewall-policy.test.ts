import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAgentPayload,
  cidrContains,
  evaluate,
  isPrivateAddress,
  meshMatrix,
  payloadIsEmpty,
  PolicyContext,
  PolicyRule,
  publicExposure,
} from '../src/firewall/firewall-policy';

const nodes = [
  { id: 'dev', name: 'dev-server', vlanIp: '10.16.0.220', labels: ['dev'], publicMode: 'open' as const, sshPorts: [22] },
  { id: 'web', name: 'web-1', vlanIp: '10.16.0.5', labels: ['prod'], publicMode: 'open' as const, sshPorts: [2222] },
  { id: 'd2', name: 'd2-2', vlanIp: '10.16.0.9', labels: [], publicMode: 'enforce' as const, sshPorts: [22] },
  { id: 'off', name: 'not-in-mesh', vlanIp: null, labels: [], publicMode: 'open' as const, sshPorts: [22] },
];

function rule(partial: Partial<PolicyRule>): PolicyRule {
  return {
    id: 'r',
    scope: 'mesh',
    action: 'allow',
    name: 'règle',
    enabled: true,
    sourceKind: 'any',
    sourceNodeIds: [],
    sourceLabels: [],
    sourceCidrs: [],
    targetKind: 'any',
    targetNodeIds: [],
    targetLabels: [],
    protocol: 'tcp',
    ports: [],
    expiresAt: null,
    ...partial,
  };
}

function ctx(partial: Partial<PolicyContext>): PolicyContext {
  return { meshMode: 'open', publicPing: true, sshGuard: true, nodes, rules: [], system: [], now: new Date('2026-10-29T12:00:00Z'), ...partial };
}

test('open mesh with no rule sends nothing', () => {
  const payload = buildAgentPayload(ctx({}), 'dev', 'rev');
  assert.equal(payloadIsEmpty(payload), true);
});

test('a deny rule resolves source nodes to their mesh IPs on the targets only', () => {
  const deny = rule({ id: 'no-ssh', action: 'deny', sourceKind: 'nodes', sourceNodeIds: ['d2'], targetKind: 'labels', targetLabels: ['DEV'], ports: ['22'] });
  const c = ctx({ rules: [deny] });
  const dev = buildAgentPayload(c, 'dev', 'rev');
  assert.deepEqual(dev.mesh.denies, [{ id: 'no-ssh', sources: ['10.16.0.9/32'], protocol: 'tcp', ports: ['22'] }]);
  assert.equal(buildAgentPayload(c, 'web', 'rev').mesh.denies.length, 0);
  assert.equal(evaluate(c, { scope: 'mesh', sourceNodeId: 'd2', targetNodeId: 'dev', protocol: 'tcp', port: 22 }).verdict, 'blocked');
  assert.equal(evaluate(c, { scope: 'mesh', sourceNodeId: 'web', targetNodeId: 'dev', protocol: 'tcp', port: 22 }).verdict, 'allowed');
  assert.equal(evaluate(c, { scope: 'mesh', sourceNodeId: 'd2', targetNodeId: 'dev', protocol: 'tcp', port: 443 }).verdict, 'allowed');
});

test('a rule whose source nodes are all gone is skipped, never widened to any source', () => {
  const allow = rule({ id: 'ghost', sourceKind: 'nodes', sourceNodeIds: ['deleted'] });
  const deny = rule({ id: 'ghost-deny', action: 'deny', sourceKind: 'labels', sourceLabels: ['nobody'] });
  const payload = buildAgentPayload(ctx({ meshMode: 'enforce', rules: [allow, deny] }), 'dev', 'rev');
  assert.equal(payload.mesh.allows.length, 0);
  assert.equal(payload.mesh.denies.length, 0);
});

test('disabled and expired rules are ignored', () => {
  const rules = [
    rule({ id: 'off', action: 'deny', enabled: false }),
    rule({ id: 'old', action: 'deny', expiresAt: new Date('2026-10-29T11:00:00Z') }),
    rule({ id: 'soon', action: 'deny', expiresAt: new Date('2026-10-29T13:00:00Z') }),
  ];
  const payload = buildAgentPayload(ctx({ rules }), 'dev', 'rev');
  assert.deepEqual(payload.mesh.denies.map((r) => r.id), ['soon']);
});

test('enforce mode: system flows and allows, then the default verdict', () => {
  const c = ctx({
    meshMode: 'enforce',
    rules: [rule({ id: 'web-https', sourceKind: 'labels', sourceLabels: ['prod'], targetKind: 'nodes', targetNodeIds: ['dev'], ports: ['443'] })],
    system: [
      { id: 'idns', scope: 'mesh', kind: 'dns', label: 'DNS interne', detail: 'x', sourceNodeIds: 'all', targetNodeId: 'dev', protocol: 'tcpudp', ports: ['5300'] },
    ],
  });
  const at = (sourceNodeId: string, port: number) => evaluate(c, { scope: 'mesh', sourceNodeId, targetNodeId: 'dev', protocol: 'tcp', port });
  assert.equal(at('web', 443).verdict, 'allowed');
  assert.equal(at('d2', 443).verdict, 'blocked');
  assert.equal(at('d2', 5300).match.type, 'system');
  assert.equal(at('d2', 22).verdict, 'blocked');
  assert.equal(evaluate(c, { scope: 'mesh', sourceNodeId: 'd2', targetNodeId: 'dev', protocol: 'icmp' }).verdict, 'allowed');
  assert.equal(evaluate({ ...c, meshMode: 'observe' }, { scope: 'mesh', sourceNodeId: 'd2', targetNodeId: 'dev', protocol: 'tcp', port: 22 }).verdict, 'observed');

  const payload = buildAgentPayload(c, 'dev', 'rev');
  assert.deepEqual(payload.mesh.allows.map((r) => r.id), ['sys:idns', 'web-https']);
  assert.deepEqual(payload.mesh.allows[1].sources, ['10.16.0.5/32']);
});

test('nodes outside the mesh never get mesh rules', () => {
  const payload = buildAgentPayload(ctx({ meshMode: 'enforce', rules: [rule({ action: 'deny' })] }), 'off', 'rev');
  assert.equal(payload.mesh.mode, 'open');
  assert.equal(payload.mesh.denies.length, 0);
});

test('matrix summarises who reaches whom', () => {
  const c = ctx({
    meshMode: 'enforce',
    rules: [
      rule({ id: 'all-from-web', protocol: 'any', sourceKind: 'nodes', sourceNodeIds: ['web'], targetKind: 'nodes', targetNodeIds: ['dev'] }),
      rule({ id: 'ssh', sourceKind: 'nodes', sourceNodeIds: ['dev'], targetKind: 'nodes', targetNodeIds: ['web'], ports: ['22'] }),
    ],
  });
  const cell = (from: string, to: string) => meshMatrix(c).find((item) => item.sourceNodeId === from && item.targetNodeId === to)!;
  assert.equal(cell('web', 'dev').status, 'open');
  assert.equal(cell('dev', 'web').status, 'partial');
  assert.deepEqual(cell('dev', 'web').allowed, ['SSH (22)']);
  assert.equal(cell('d2', 'dev').status, 'blocked');
  assert.equal(meshMatrix({ ...c, meshMode: 'open' }).every((item) => item.status === 'open'), true);
  assert.equal(meshMatrix(c).some((item) => item.sourceNodeId === 'off' || item.targetNodeId === 'off'), false);
});

test('public rules match CIDR sources and exposure reflects the mode', () => {
  const office = rule({ id: 'office', scope: 'public', sourceKind: 'cidrs', sourceCidrs: ['198.51.100.0/24'], ports: ['5432'] });
  const c = ctx({
    rules: [office],
    system: [{ id: 'ssh', scope: 'public', kind: 'ssh-guard', label: 'Anti-verrouillage', detail: 'x', sourceNodeIds: 'all', targetNodeId: 'd2', protocol: 'tcp', ports: ['22'] }],
  });
  assert.equal(evaluate(c, { scope: 'public', sourceIp: '198.51.100.7', targetNodeId: 'd2', protocol: 'tcp', port: 5432 }).verdict, 'allowed');
  assert.equal(evaluate(c, { scope: 'public', sourceIp: '203.0.113.1', targetNodeId: 'd2', protocol: 'tcp', port: 5432 }).verdict, 'blocked');
  assert.equal(publicExposure(c, 'd2', { protocol: 'tcp', port: 22, addresses: ['*'] }), 'public');
  const banned = ctx({ ...c, rules: [rule({ id: 'ban', scope: 'public', action: 'deny', sourceKind: 'cidrs', sourceCidrs: ['45.148.10.0/24'], protocol: 'any' })] });
  assert.equal(publicExposure(banned, 'dev', { protocol: 'tcp', port: 80, addresses: ['*'] }), 'public');
  assert.equal(publicExposure(c, 'd2', { protocol: 'tcp', port: 5432, addresses: ['*'] }), 'restricted');
  assert.equal(publicExposure(c, 'd2', { protocol: 'tcp', port: 6379, addresses: ['*'] }), 'closed');
  assert.equal(publicExposure(c, 'd2', { protocol: 'tcp', port: 2049, addresses: ['10.16.0.9'] }), 'local');
  assert.equal(publicExposure(c, 'dev', { protocol: 'tcp', port: 6379, addresses: ['*'] }), 'public');
  assert.equal(publicExposure(c, 'dev', { protocol: 'tcp', port: 6379, addresses: ['*'] }, 'enforce'), 'closed');
});

test('cidrContains', () => {
  assert.equal(cidrContains('10.16.0.0/16', '10.16.4.2'), true);
  assert.equal(cidrContains('10.16.0.0/16', '10.17.0.1'), false);
  assert.equal(cidrContains('0.0.0.0/0', '8.8.8.8'), true);
  assert.equal(cidrContains('198.51.100.7/32', '198.51.100.7'), true);
  assert.equal(cidrContains('198.51.100.7', '198.51.100.8'), false);
});

test('cidrContains handles IPv6 ranges', () => {
  assert.equal(cidrContains('2001:db8::/32', '2001:db8:1234::5'), true);
  assert.equal(cidrContains('2001:db8::/32', '2001:db9::1'), false);
  assert.equal(cidrContains('2001:DB8::/32', '2001:db8::1'), true);
  assert.equal(cidrContains('2001:db8::5', '2001:0db8:0:0:0:0:0:5'), true);
  assert.equal(cidrContains('2001:db8::5', '2001:db8::6'), false);
  assert.equal(cidrContains('::/0', '2a01:4f8::1'), true);
  assert.equal(cidrContains('2001:db8:abcd:12::/63', '2001:db8:abcd:13:ffff::1'), true);
  assert.equal(cidrContains('2001:db8:abcd:12::/63', '2001:db8:abcd:14::1'), false);
  assert.equal(cidrContains('::ffff:0:0/96', '::ffff:192.0.2.1'), true);
  assert.equal(cidrContains('fe80::/10', 'fe80::1%eth0'), true);
  // An IPv4 address never matches an IPv6 range, and garbage never matches.
  assert.equal(cidrContains('::/0', '8.8.8.8'), false);
  assert.equal(cidrContains('2001:db8::/32', '2001:db8:::1'), false);
  assert.equal(cidrContains('2001:db8::/129', '2001:db8::1'), false);
});

test('isPrivateAddress', () => {
  assert.equal(isPrivateAddress('10.16.0.5'), true);
  assert.equal(isPrivateAddress('8.8.8.8'), false);
  assert.equal(isPrivateAddress('fd12:3456::1'), true);
  assert.equal(isPrivateAddress('fe80::1%eth0'), true);
  assert.equal(isPrivateAddress('2a01:4f8::1'), false);
  assert.equal(isPrivateAddress('::'), false);
  assert.equal(isPrivateAddress('*'), false);
});
