import assert from 'node:assert/strict';
import test from 'node:test';
import { renderLinkIncident, LinkIncidentInput } from '../src/mail/templates/link-incident';

function input(overrides: Partial<LinkIncidentInput> = {}): LinkIncidentInput {
  return {
    workspaceName: 'Casterot',
    workspaceSlug: 'casterot',
    recipient: 'ops@example.com',
    frontendUrl: 'https://tarmac.example.com',
    a: { name: '2-es-vpn', publicIp: '191.101.236.219', location: 'Madrid, Espagne' },
    b: { name: 'ns3121979', publicIp: '51.68.36.61', location: 'Roubaix, France' },
    status: 'degraded',
    triggerLoss: 20,
    triggerLatencyMs: 27.4,
    capturedAt: new Date('2026-11-17T09:47:10Z'),
    aToB: { pingLoss: 6, pingAvgMs: 21.93, mtrHops: 15, reached: true, mtrDestLoss: 3.3, cpuUsed: 12.2, cpuSteal: 6.2, failure: null },
    bToA: { pingLoss: null, pingAvgMs: null, mtrHops: null, reached: null, mtrDestLoss: null, cpuUsed: null, cpuSteal: null, failure: 'ce serveur est hors ligne' },
    attachments: [
      { filename: 'rapport-reseau_x.txt', content: 'FR' },
      { filename: 'network-report_x.txt', content: 'EN' },
    ],
    ...overrides,
  };
}

test('incident email: subject, figures, both directions, attachments', () => {
  const mail = renderLinkIncident(input());
  assert.equal(mail.subject, '[Tarmac] Lien dégradé · 2-es-vpn ↔ ns3121979 · 20 % de perte');
  assert.match(mail.html, /Lien dégradé entre 2-es-vpn et ns3121979/);
  assert.match(mail.html, /a perdu 20 % des paquets/);
  assert.match(mail.html, /191\.101\.236\.219/);
  assert.match(mail.html, /6 % de perte/);
  assert.match(mail.html, /6\.2 % volé \(steal\)/);
  assert.match(mail.html, /Tests impossibles : ce serveur est hors ligne/);
  assert.match(mail.html, /https:\/\/tarmac\.example\.com\/casterot\/dashboard\/network/);
  assert.match(mail.text, /Depuis 2-es-vpn : ping 6 % de perte, MTR 15 sauts \(3\.3 % à destination\), CPU 12\.2 % \(steal 6\.2 %\)/);
  assert.match(mail.html, /MTR : 15 sauts, 3\.3 % de perte à destination/);
  assert.match(mail.html, /Ping depuis A/);
  assert.match(mail.text, /Depuis ns3121979 : tests impossibles \(ce serveur est hors ligne\)/);
  assert.deepEqual(
    mail.attachments?.map((file) => [file.filename, file.contentType]),
    [
      ['rapport-reseau_x.txt', 'text/plain; charset=utf-8'],
      ['network-report_x.txt', 'text/plain; charset=utf-8'],
    ],
  );
  assert.doesNotMatch(mail.html + mail.text, /undefined|NaN|null/);
});

test('incident email: a cut link and names are escaped', () => {
  const mail = renderLinkIncident(input({ status: 'offline', triggerLoss: 100, a: { name: '<b>x</b>', publicIp: null, location: null } }));
  assert.match(mail.subject, /^\[Tarmac\] Lien coupé · <b>x<\/b> ↔ ns3121979/);
  assert.match(mail.html, /ne passait plus/);
  assert.doesNotMatch(mail.html, /<b>x<\/b>/);
  assert.match(mail.html, /IP publique inconnue/);
});
