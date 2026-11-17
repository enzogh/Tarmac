import assert from 'node:assert/strict';
import test from 'node:test';
import { renderClientConfig } from '../src/vpn/vpn-config';
import {
  hostnameCandidate,
  hostnameFromName,
  isValidHostname,
  normalizeHostname,
  normalizeZone,
  zoneProblem,
  zoneWarning,
} from '../src/vpn/vpn-dns';

test('hostnames are derived from the profile name, deterministically', () => {
  assert.equal(hostnameFromName('PC Alice'), 'pc-alice');
  assert.equal(hostnameFromName('  Équipe Paris — Poste n°2 '), 'equipe-paris-poste-n-2');
  assert.equal(hostnameFromName('Zoë_Müller.MacBook'), 'zoe-muller-macbook');
  assert.equal(hostnameFromName('東京'), 'appareil');
  assert.equal(hostnameFromName('---'), 'appareil');
  const long = hostnameFromName('a'.repeat(62) + ' b c');
  assert.ok(long.length <= 63 && isValidHostname(long), long);
  for (const name of ['PC Alice', 'Équipe Paris', 'x'.repeat(200), '-a-', '東京']) {
    assert.ok(isValidHostname(hostnameFromName(name)), name);
  }
});

test('collisions get a numeric suffix that stays a valid label', () => {
  assert.equal(hostnameCandidate('pc-alice', 1), 'pc-alice');
  assert.equal(hostnameCandidate('pc-alice', 2), 'pc-alice-2');
  const base = 'a'.repeat(63);
  const second = hostnameCandidate(base, 12);
  assert.equal(second.length, 63);
  assert.ok(second.endsWith('-12') && isValidHostname(second));
  // Truncation must not leave a double dash before the suffix.
  assert.equal(hostnameCandidate('a'.repeat(60) + '-bc', 2), 'a'.repeat(60) + '-2');
});

test('hostname input is normalized and validated', () => {
  assert.equal(normalizeHostname(' PC-Alice. '), 'pc-alice');
  assert.ok(isValidHostname('pc-alice'));
  assert.ok(isValidHostname('a'));
  assert.ok(!isValidHostname('-pc'));
  assert.ok(!isValidHostname('pc-'));
  assert.ok(!isValidHostname('pc.alice'));
  assert.ok(!isValidHostname('pc_alice'));
  assert.ok(!isValidHostname('a'.repeat(64)));
});

test('zones', () => {
  assert.equal(normalizeZone(' Intranet.Internal. '), 'intranet.internal');
  assert.equal(zoneProblem('intranet.internal'), null);
  assert.equal(zoneProblem('lan'), null);
  assert.equal(zoneProblem('corp.example.com'), null);
  assert.ok(zoneProblem(''));
  assert.ok(zoneProblem('intra net.internal'));
  assert.ok(zoneProblem('intranet..internal'));
  assert.ok(zoneProblem('10.in-addr.arpa'));
  assert.ok(zoneWarning('intranet.local'));
  assert.equal(zoneWarning('intranet.internal'), null);
  assert.equal(zoneWarning('localnet.internal'), null);
});

test('client config carries the resolver and the search domain', () => {
  const config = renderClientConfig({
    profileName: 'PC Alice',
    workspaceName: 'Acme',
    entryNodeName: 'paris-1',
    mode: 'private',
    clientIp: '10.16.101.2',
    clientPrivateKey: null,
    presharedKey: 'psk',
    dns: ['10.16.101.1', 'intranet.internal'],
    serverPublicKey: 'pub',
    endpoint: '1.2.3.4:51821',
    meshCidr: '10.16.0.0/16',
  });
  assert.match(config, /^DNS = 10\.16\.101\.1, intranet\.internal$/m);
  assert.match(config, /^AllowedIPs = 10\.16\.0\.0\/16$/m);
});
