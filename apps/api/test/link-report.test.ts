import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildLinkReport,
  condensePing,
  directionStats,
  LinkReportInput,
  lossEpisodes,
  pickCaptures,
  ReportCapture,
  ReportSample,
  TraceOutcome,
} from '../src/vlan/link-report';

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
        rounds: 30,
        reached: true,
        hops: [
          {
            hop: 1,
            ip: '191.101.236.1',
            sent: 30,
            received: 30,
            lossPct: 0,
            lastMs: 0.4,
            avgMs: 0.5,
            bestMs: 0.3,
            worstMs: 1.1,
            stdevMs: 0.12,
            probes: [
              { ip: '191.101.236.1', ms: 0.412 },
              { ip: '191.101.236.1', ms: 0.5 },
              { ip: '191.101.236.1', ms: 0.31 },
            ],
          },
          { hop: 2, ip: null, sent: 30, received: 0, lossPct: 100, lastMs: null, avgMs: null, bestMs: null, worstMs: null, stdevMs: null, probes: [null, null, null] },
          {
            hop: 3,
            ip: '51.68.36.61',
            otherIps: ['51.68.36.62'],
            sent: 30,
            received: 27,
            lossPct: 10,
            lastMs: 26,
            avgMs: 26.4,
            bestMs: 25,
            worstMs: 31,
            stdevMs: 1.6,
            probes: [{ ip: '51.68.36.61', ms: 26 }, null, { ip: '51.68.36.62', ms: 25.5 }],
          },
        ],
        ping: {
          command: 'ping -n -c 100 -i 0.2 -W 2 -O 51.68.36.61',
          output:
            'PING 51.68.36.61 (51.68.36.61) 56(84) bytes of data.\n64 bytes from 51.68.36.61: icmp_seq=1 ttl=51 time=26.1 ms\nno answer yet for icmp_seq=2\n\n--- 51.68.36.61 ping statistics ---\n100 packets transmitted, 94 received, 6% packet loss, time 19830ms\nrtt min/avg/max/mdev = 25.0/26.4/31.0/1.2 ms',
          error: null,
        },
        system: {
          at: '2026-11-17T12:30:32Z',
          windowSec: 31.6,
          cpus: 4,
          cpu: { us: 0.2, sy: 0.3, ni: 0, id: 98.5, wa: 0, hi: 0, si: 0, st: 1 },
          load: [0.08, 0.12, 0.1],
          uptimeSec: 12 * 86400 + 3 * 3600 + 4 * 60,
          mem: { totalMiB: 15890.4, freeMiB: 1203.5, usedMiB: 4021.2, buffCacheMiB: 10665.7, availMiB: 11869.2, swapTotalMiB: 0, swapFreeMiB: 0, swapUsedMiB: 0 },
        },
      },
    },
    traceBToA: { ok: false, reason: 'ce serveur est hors ligne' },
    captures: [],
    publicPingFiltered: false,
    ...overrides,
  };
}

test('stats per direction', () => {
  const stats = directionStats(samples());
  assert.ok(stats.avgLoss! > 0.5 && stats.avgLoss! < 2, String(stats.avgLoss));
  // The last slice holds one sample only (12:30:00).
  assert.ok(stats.worstWindowLoss! >= 6.5 && stats.worstWindowLoss! <= 10, String(stats.worstWindowLoss));
  const flaky = [0, 50, 0, 0, 0, 0].map((loss, i) => ({ at: new Date(NOW.getTime() + i * 60_000), status: 'healthy', latencyMs: 20, packetLoss: loss }));
  assert.ok(directionStats(flaky).worstWindowLoss! < 50, 'one bad probe is not the worst 15 minutes');
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
  assert.match(text, /TESTS LANCÉS DEPUIS A — 2-es-vpn \(191\.101\.236\.219\) VERS B — ns3121979\.ip-51-68-36\.eu \(51\.68\.36\.61\)/);
  assert.match(text, /CPU moyenné sur les 32 s des tests, 4 cœurs/);
  assert.match(text, /\n {4}top - 12:30:32 up 12 days, {2}3:04, {2}load average: 0\.08, 0\.12, 0\.10\n/);
  assert.match(text, /\n {4}%Cpu\(s\): {2}0\.2 us, {2}0\.3 sy, {2}0\.0 ni, 98\.5 id, {2}0\.0 wa, {2}0\.0 hi, {2}0\.0 si, {2}1\.0 st\n/);
  assert.match(text, /MiB Mem : {2}15890\.4 total/);
  assert.match(text, /\$ ping -n -c 100 -i 0\.2 -W 2 -O 51\.68\.36\.61\n {4}PING 51\.68\.36\.61/);
  assert.match(text, /100 packets transmitted, 94 received, 6% packet loss/);
  assert.match(text, /Au moment des tests \(2026-11-17 12:30 UTC\) : perte au ping A → B 6%, B → A —\./);
  assert.match(text, /Aucun test n’a été capturé pendant une dégradation/);
  assert.doesNotMatch(text, /TESTS CAPTURÉS/);
  assert.match(text, /\n {4}traceroute to 51\.68\.36\.61 \(51\.68\.36\.61\), 30 hops max, ICMP\n {4} 1 {2}191\.101\.236\.1 {2}0\.412 ms {2}0\.500 ms {2}0\.310 ms\n {4} 2 {2}\* \* \*\n {4} 3 {2}51\.68\.36\.61 {2}26\.000 ms {2}\* {2}51\.68\.36\.62 {2}25\.500 ms\n/);
  assert.match(text, /MTR vers 51\.68\.36\.61 \(30 cycles, ICMP\)/);
  assert.match(text, /\n {4}HOST: 2-es-vpn +Loss% +Snt +Last +Avg +Best +Wrst +StDev\n/);
  assert.match(text, /\n {6}3\.\|-- 51\.68\.36\.61 +10\.0% +30 +26\.0 +26\.4 +25\.0 +31\.0 +1\.6\n {4} {4}\| {2}`-- 51\.68\.36\.62\n/);
  assert.match(text, /\n {6}2\.\|-- \?\?\? +100\.0% +30/);
  assert.match(text, /Tests impossibles : ce serveur est hors ligne/);
  assert.match(text, /Depuis le début de l’incident :\n +A → B : perte moyenne 6\.7%/);
  assert.match(text, /\d+ changements d’état \(A → B : \d+, B → A : \d+\) entre le 2026-11-17 09:3\d UTC et le 2026-11-17 12:\d\d UTC : le lien a oscillé/);
  assert.match(text, /pire quart d’heure/);
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
  assert.match(text, /Tests not available/);
  assert.match(text, /\[1\] Server load \(top\): CPU averaged over the 32 s/);
  assert.ok(filename.startsWith('network-report_'));
});

test('an agent without the extra tests says which ones are missing', () => {
  const base = input();
  if (!base.traceAToB.ok) throw new Error('fixture');
  const old = { ...base.traceAToB.trace, ping: null, system: null, hops: base.traceAToB.trace.hops.map((hop) => ({ ...hop, probes: [] })) };
  const { text } = buildLinkReport(input({ traceAToB: { ok: true, ranAt: NOW, trace: old } }));
  assert.match(text, /\[1\] Charge du serveur \(top\)\n {4}Non disponible : l’agent de ce serveur est trop ancien/);
  assert.match(text, /\[2\] Ping vers 51\.68\.36\.61\n {4}Non disponible/);
  assert.match(text, /\[3\] Traceroute vers 51\.68\.36\.61 \(ICMP, 3 sondes par saut\)\n {4}Non disponible/);
  assert.match(text, /HOST: 2-es-vpn/);
});

test('a clean link says so', () => {
  const clean = samples().map((s) => ({ ...s, packetLoss: 0, status: 'healthy' }));
  const { text } = buildLinkReport(input({ aToB: clean, bToA: clean }));
  assert.match(text, /Aucune période de perte soutenue/);
  assert.match(text, /Aucun changement d’état sur la période/);
  assert.doesNotMatch(text, /propre à la route/);
});

function cleanTrace(lossPct: number, at: Date): TraceOutcome {
  const base = input().traceAToB;
  if (!base.ok) throw new Error('fixture');
  const output = `PING x\n64 bytes from x: icmp_seq=1 ttl=50 time=20.1 ms\n\n--- x ping statistics ---\n100 packets transmitted, ${100 - lossPct} received, ${lossPct}% packet loss, time 19858ms`;
  return { ok: true, ranAt: at, trace: { ...base.trace, ping: { command: 'ping x', output, error: null } } };
}

test('captures: the most telling ones, in order, and the resolved state', () => {
  const at = (iso: string) => new Date(iso);
  const capture = (iso: string, loss: number, direction: 'AB' | 'BA' = 'AB'): ReportCapture => ({
    at: at(iso),
    trigger: { direction, status: 'degraded', loss: 10, latencyMs: 25 },
    aToB: cleanTrace(loss, at(iso)),
    bToA: { ok: false, reason: 'ce serveur est hors ligne' },
  });
  const captures = [capture('2026-11-17T09:40:00Z', 4), capture('2026-11-17T10:20:00Z', 12, 'BA'), capture('2026-11-17T11:00:00Z', 0)];
  // The MTR fixture's destination shows 10 % on every capture: 12 % wins, then the latest 10 %.
  assert.deepEqual(
    pickCaptures(captures).map((c) => c.at.toISOString()),
    ['2026-11-17T10:20:00.000Z', '2026-11-17T11:00:00.000Z'],
  );

  const clean = samples().map((s) => ({ ...s, packetLoss: s.at < at('2026-11-17T11:00:00Z') ? s.packetLoss : 0 }));
  const now = { ok: true as const, ranAt: NOW, trace: { ...(cleanTrace(0, NOW) as any).trace, hops: [] , reached: false } };
  const { text } = buildLinkReport(input({ aToB: clean, bToA: clean, captures, traceAToB: now, traceBToA: now }));
  assert.match(text, /Au moment des tests \(2026-11-17 12:30 UTC\), aucune perte dans un sens comme dans l’autre/);
  assert.match(text, /La dernière période de perte s’est terminée le 2026-11-17 11:00 UTC \(il y a 1 h 30\)\./);
  assert.match(text, /3 captures de ces tests faites automatiquement .* les 2 qui ont relevé le plus de perte sont incluses/);
  assert.match(text, /TESTS CAPTURÉS AUTOMATIQUEMENT PENDANT L’INCIDENT/);
  assert.match(text, /Capture du 2026-11-17 10:20:00 UTC, déclenchée par le passage du lien B → A à l’état « dégradé » \(perte mesurée 10%\)/);
  assert.match(text, /TESTS LANCÉS À LA GÉNÉRATION DU RAPPORT/);
  assert.ok(text.indexOf('Capture du 2026-11-17 10:20') < text.indexOf('Capture du 2026-11-17 11:00'));
  assert.ok(text.indexOf('TESTS LANCÉS À LA GÉNÉRATION') > text.indexOf('Capture du 2026-11-17 11:00'));
  assert.doesNotMatch(text, /09:40:00 UTC, déclenchée/);

  const mailed = buildLinkReport(input({ testsAreCapture: true })).text;
  assert.match(mailed, /Ils ont été lancés automatiquement au moment où le lien s’est dégradé\./);
  assert.doesNotMatch(mailed, /Aucun test n’a été capturé/);
});

test('ping listing keeps the losses and folds the normal replies', () => {
  const replies = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => `64 bytes from 1.2.3.4: icmp_seq=${from + i} ttl=50 time=20.${i} ms`);
  const output = ['PING 1.2.3.4 (1.2.3.4) 56(84) bytes of data.', ...replies(1, 30), 'no answer yet for icmp_seq=31', ...replies(32, 100), '', '--- 1.2.3.4 ping statistics ---', '100 packets transmitted, 99 received, 1% packet loss'].join('\n');
  const lines = condensePing(output, (n) => `[${n} omitted]`);
  assert.deepEqual(lines.slice(0, 6), ['PING 1.2.3.4 (1.2.3.4) 56(84) bytes of data.', ...replies(1, 5)]);
  assert.equal(lines[6], '[25 omitted]');
  assert.equal(lines[7], 'no answer yet for icmp_seq=31');
  assert.equal(lines[8], '[69 omitted]');
  assert.ok(lines.includes('100 packets transmitted, 99 received, 1% packet loss'));
  // BSD-style ping (no -O) folds the same way.
  assert.equal(condensePing('64 bytes from 1.2.3.4: icmp_seq=0 ttl=51 time=20.182 ms\n'.repeat(8).trim(), (n) => `[${n}]`).at(-1), '[3]');
});
