import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLinkReport, directionStats, LinkReportInput, lossEpisodes, ReportSample } from '../src/vlan/link-report';

const NOW = new Date('2026-11-17T12:30:00Z');
const SINCE = new Date('2026-11-16T12:30:00Z');

// Every 30 s: clean until 09:30 UTC, then ~6 % loss.
function samples(offset = 0): ReportSample[] {
  const out: ReportSample[] = [];
  for (let at = SINCE.getTime() + offset; at <= NOW.getTime(); at += 30_000) {
    const lossy = at >= Date.parse('2026-11-17T09:30:00Z');
    const loss = lossy ? (Math.floor(at / 30_000) % 3 === 0 ? 10 : 5) : 0;
    out.push({ at: new Date(at), status: loss >= 8 ? 'degraded' : 'healthy', latencyMs: lossy ? 26 : 22, packetLoss: loss });
  }
  return out;
}

function input(overrides: Partial<LinkReportInput> = {}): LinkReportInput {
  return {
    lang: 'fr',
    generatedAt: NOW,
    since: SINCE,
    a: { name: '2-es-vpn', publicIp: '191.101.236.219', tunnelPort: 51820, location: 'Madrid, Espagne' },
    b: { name: 'ns3121979.ip-51-68-36.eu', publicIp: '51.68.36.61', tunnelPort: 51820, location: 'Roubaix, France' },
    aToB: samples(),
    bToA: samples(15_000),
    aOthers: { peers: 5, avgLoss: 0.1 },
    bOthers: { peers: 7, avgLoss: 0 },
    traceAToB: {
      ok: true,
      ranAt: NOW,
      trace: {
        targetIp: '51.68.36.61',
        rounds: 10,
        reached: true,
        hops: [
          { hop: 1, ip: '191.101.236.1', sent: 10, received: 10, lossPct: 0, lastMs: 0.4, avgMs: 0.5, bestMs: 0.3, worstMs: 1.1 },
          { hop: 2, ip: null, sent: 10, received: 0, lossPct: 100, lastMs: null, avgMs: null, bestMs: null, worstMs: null },
          { hop: 3, ip: '51.68.36.61', otherIps: ['51.68.36.62'], sent: 10, received: 9, lossPct: 10, lastMs: 26, avgMs: 26.4, bestMs: 25, worstMs: 31 },
        ],
      },
    },
    traceBToA: { ok: false, reason: 'ce serveur est hors ligne' },
    publicPingFiltered: false,
    ...overrides,
  };
}

test('stats per direction', () => {
  const stats = directionStats(samples());
  assert.ok(stats.avgLoss! > 0.5 && stats.avgLoss! < 2, String(stats.avgLoss));
  assert.equal(stats.peakLoss, 10);
  assert.equal(stats.minLatency, 22);
  assert.equal(stats.maxLatency, 26);
  assert.equal(directionStats([]).avgLoss, null);
});

test('ongoing loss is dated from its onset', () => {
  const episodes = lossEpisodes([...samples(), ...samples(15_000)], SINCE, NOW);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].ongoing, true);
  assert.equal(episodes[0].start.toISOString(), '2026-11-17T09:30:00.000Z');
  assert.ok(episodes[0].avgLoss > 5 && episodes[0].avgLoss < 8);
});

test('a finished episode and isolated losses', () => {
  const list: ReportSample[] = [];
  for (let at = SINCE.getTime(); at <= NOW.getTime(); at += 30_000) {
    const inEpisode = at >= Date.parse('2026-11-17T01:00:00Z') && at < Date.parse('2026-11-17T01:45:00Z');
    const isolated = at === Date.parse('2026-11-17T05:00:00Z');
    list.push({ at: new Date(at), status: 'healthy', latencyMs: 20, packetLoss: inEpisode ? 20 : isolated ? 5 : 0 });
  }
  const episodes = lossEpisodes(list, SINCE, NOW);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].ongoing, false);
  assert.equal(episodes[0].start.toISOString(), '2026-11-17T01:00:00.000Z');
  assert.equal(episodes[0].end.toISOString(), '2026-11-17T01:45:00.000Z');
});

test('french report carries public IPs, onset, comparison, traces and events', () => {
  const { text, filename } = buildLinkReport(input());
  assert.match(text, /A {2}2-es-vpn +IP publique 191\.101\.236\.219 +Madrid, Espagne/);
  assert.match(text, /B {2}ns3121979\.ip-51-68-36\.eu +IP publique 51\.68\.36\.61 +Roubaix, France/);
  assert.match(text, /Perte de paquets en cours depuis le 2026-11-17 09:30 UTC \(3 h\)/);
  assert.match(text, /la perte est propre à la route internet entre ces deux adresses/);
  assert.match(text, /port UDP 51820/);
  assert.match(text, /2-es-vpn \(191\.101\.236\.219\) → ns3121979\.ip-51-68-36\.eu \(51\.68\.36\.61\) — 10 sondes par saut/);
  assert.match(text, /\n +3 {2}51\.68\.36\.61 +10%/);
  assert.match(text, /\n +51\.68\.36\.62\n/);
  assert.match(text, /\n +2 {2}\?\?\? +100%/);
  assert.match(text, /Trace impossible : ce serveur est hors ligne/);
  assert.match(text, /Depuis le début de l’incident :\n +A → B : perte moyenne 6\.7%/);
  assert.match(text, /changements d’état au total, les 40 derniers ci-dessous/);
  assert.match(text, /2026-11-17 12:\d\d:\d\d {2}A→B {2}dégradé/);
  assert.match(text, /HISTORIQUE HORAIRE \(UTC\)\n-+\n.*A→B perte/);
  assert.doesNotMatch(text, /undefined|NaN|\[object/);
  assert.equal(filename, 'rapport-reseau_2-es-vpn_ns3121979-ip-51-68-36-eu_20261117-1230Z.txt');
});

test('english report, filtered ping note, no path-specific claim when others lose too', () => {
  const { text, filename } = buildLinkReport(
    input({ lang: 'en', publicPingFiltered: true, aOthers: { peers: 5, avgLoss: 4 }, bOthers: { peers: 7, avgLoss: 0 } }),
  );
  assert.match(text, /NETWORK INCIDENT REPORT/);
  assert.match(text, /Ongoing packet loss since 2026-11-17 09:30 UTC \(3 h\)/);
  assert.match(text, /Since the incident started:\n +A -> B: average loss/);
  assert.match(text, /our servers do not answer ping on their public IP/);
  assert.doesNotMatch(text, /specific to the internet route/);
  assert.match(text, /Trace not available/);
  assert.ok(filename.startsWith('network-report_'));
});

test('a clean link says so', () => {
  const clean = samples().map((s) => ({ ...s, packetLoss: 0, status: 'healthy' }));
  const { text } = buildLinkReport(input({ aToB: clean, bToA: clean }));
  assert.match(text, /Aucune période de perte soutenue/);
  assert.match(text, /Aucun changement d’état sur la période/);
  assert.doesNotMatch(text, /propre à la route/);
});
