import type { PathTraceResult } from '../agents/agents.service';

// Plain-text incident report about one link, written to be pasted as-is into
// a ticket with the hosting provider: both public addresses up front, what
// was measured and how, since when, the hourly history, the comparison with
// the two servers' other links (which is what shows the problem is the
// route between them), and an MTR-style trace from each end.

export type LinkReportLang = 'fr' | 'en';

export type ReportNode = {
  name: string;
  publicIp: string | null;
  tunnelPort: number | null;
  location: string | null;
};

export type ReportSample = { at: Date; status: string; latencyMs: number | null; packetLoss: number | null };

export type PeerComparison = { peers: number; avgLoss: number | null };

export type TraceOutcome = { ok: true; trace: PathTraceResult; ranAt: Date } | { ok: false; reason: string };

export type LinkReportInput = {
  lang: LinkReportLang;
  generatedAt: Date;
  since: Date;
  a: ReportNode;
  b: ReportNode;
  aToB: ReportSample[];
  bToA: ReportSample[];
  aOthers: PeerComparison;
  bOthers: PeerComparison;
  traceAToB: TraceOutcome;
  traceBToA: TraceOutcome;
  // The workspace firewall doesn't answer pings on public addresses: the
  // last hop of a trace towards one of our servers stays silent.
  publicPingFiltered: boolean;
};

export type DirectionStats = {
  samples: number;
  avgLoss: number | null;
  peakLoss: number | null;
  lossyShare: number | null;
  avgLatency: number | null;
  minLatency: number | null;
  maxLatency: number | null;
};

export type LossEpisode = { start: Date; end: Date; ongoing: boolean; avgLoss: number };

const BUCKET_MS = 15 * 60_000;
// A 15-minute slice counts as lossy from this average loss on.
const LOSSY_BUCKET_PCT = 2;

const round1 = (value: number) => Math.round(value * 10) / 10;
const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);

export function directionStats(samples: ReportSample[]): DirectionStats {
  const losses = samples.map((s) => s.packetLoss).filter((v): v is number => typeof v === 'number');
  const latencies = samples.map((s) => s.latencyMs).filter((v): v is number => typeof v === 'number' && v > 0);
  const avgLoss = mean(losses);
  const avgLatency = mean(latencies);
  return {
    samples: samples.length,
    avgLoss: avgLoss === null ? null : round1(avgLoss),
    peakLoss: losses.length ? round1(Math.max(...losses)) : null,
    lossyShare: losses.length ? round1((losses.filter((v) => v > 0).length * 100) / losses.length) : null,
    avgLatency: avgLatency === null ? null : round1(avgLatency),
    minLatency: latencies.length ? round1(Math.min(...latencies)) : null,
    maxLatency: latencies.length ? round1(Math.max(...latencies)) : null,
  };
}

/**
 * Periods of sustained loss, from 15-minute slices of both directions: a
 * slice is lossy when its average loss reaches LOSSY_BUCKET_PCT, and a
 * single clean slice inside a lossy period doesn't split it.
 */
export function lossEpisodes(samples: ReportSample[], since: Date, now: Date): LossEpisode[] {
  const buckets = new Map<number, number[]>();
  for (const sample of samples) {
    if (typeof sample.packetLoss !== 'number' || sample.at < since) continue;
    const key = Math.floor(sample.at.getTime() / BUCKET_MS) * BUCKET_MS;
    const list = buckets.get(key) ?? [];
    list.push(sample.packetLoss);
    buckets.set(key, list);
  }
  const keys = [...buckets.keys()].sort((x, y) => x - y);
  if (keys.length === 0) return [];
  const lastKey = keys[keys.length - 1];
  const lossy = (key: number) => {
    const values = buckets.get(key);
    return Boolean(values && (mean(values) ?? 0) >= LOSSY_BUCKET_PCT);
  };

  const episodes: LossEpisode[] = [];
  let current: { start: number; end: number; values: number[] } | null = null;
  for (let key = keys[0]; key <= lastKey; key += BUCKET_MS) {
    if (lossy(key)) {
      if (current && key - current.end <= 2 * BUCKET_MS) {
        current.end = key;
      } else {
        if (current) episodes.push(closeEpisode(current, false));
        current = { start: key, end: key, values: [] };
      }
      current.values.push(...(buckets.get(key) ?? []));
    }
  }
  if (current) {
    const ongoing = lastKey - current.end <= BUCKET_MS;
    episodes.push(closeEpisode(current, ongoing, ongoing ? now : undefined));
  }
  return episodes;
}

function closeEpisode(run: { start: number; end: number; values: number[] }, ongoing: boolean, end?: Date): LossEpisode {
  return {
    start: new Date(run.start),
    end: end ?? new Date(run.end + BUCKET_MS),
    ongoing,
    avgLoss: round1(mean(run.values) ?? 0),
  };
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const TEXT = {
  fr: {
    title: 'RAPPORT D’INCIDENT RÉSEAU : perte de paquets entre deux serveurs',
    generated: 'Généré le',
    period: 'Période analysée',
    endpoints: 'SERVEURS CONCERNÉS',
    publicIp: 'IP publique',
    unknownIp: 'inconnue',
    summary: 'RÉSUMÉ',
    ongoingSince: (start: string, duration: string, loss: number) =>
      `Perte de paquets en cours depuis le ${start} (${duration}), ${fmtPct(loss)} en moyenne depuis.`,
    episodes: (count: number) => `${count} période${count > 1 ? 's' : ''} de perte sur la période analysée :`,
    episodeLine: (start: string, end: string, loss: number) => `du ${start} au ${end}, ${fmtPct(loss)} de perte en moyenne`,
    noEpisode: 'Aucune période de perte soutenue sur la période analysée (pertes isolées seulement).',
    direction: (from: string, to: string) => `${from} → ${to}`,
    sinceOnset: 'Depuis le début de l’incident :',
    wholePeriod: 'Sur toute la période analysée :',
    dirStats: (s: DirectionStats) =>
      `perte moyenne ${fmtPct(s.avgLoss)}, pic ${fmtPct(s.peakLoss)}, ${fmtPct(s.lossyShare)} des mesures avec perte ; latence moyenne ${fmtMs(s.avgLatency)} (min ${fmtMs(s.minLatency)}, max ${fmtMs(s.maxLatency)})`,
    comparison: 'Comparaison sur la même période :',
    others: (name: string, c: PeerComparison) =>
      c.peers === 0
        ? `${name} n’a pas d’autre lien mesuré.`
        : `${name} : ${fmtPct(c.avgLoss)} de perte moyenne vers ${c.peers > 1 ? `ses ${c.peers} autres serveurs` : 'son autre serveur'}.`,
    pathSpecific:
      'Les deux serveurs fonctionnent normalement avec le reste du réseau : la perte est propre à la route internet entre ces deux adresses.',
    method: 'MÉTHODE DE MESURE',
    methodText: (port: string) => [
      'Les deux serveurs sont reliés par un tunnel WireGuard, c’est-à-dire des paquets UDP échangés directement',
      `entre les deux IP publiques ci-dessus (port UDP ${port}). Chaque serveur envoie 5 pings ICMP à l’autre`,
      'toutes les 25 secondes à travers ce tunnel, dans les deux sens. Le tunnel ne fait qu’encapsuler : un ping',
      'perdu est un paquet UDP perdu sur la route internet entre ces deux adresses. Mesures horodatées en UTC.',
    ],
    hourly: 'HISTORIQUE HORAIRE (UTC)',
    hourlyHead: ['Heure', 'perte', 'latence', 'perte', 'latence'],
    traces: 'TRAJETS INTERNET ACTUELS (type MTR, entre les IP publiques)',
    traceTitle: (from: string, fromIp: string, to: string, toIp: string, rounds: number, at: string) =>
      `${from} (${fromIp}) → ${to} (${toIp}) — ${rounds} sondes par saut, le ${at}`,
    traceHead: ['Saut', 'Adresse', 'Perte', 'Env.', 'Dern.', 'Moy.', 'Min', 'Max'],
    traceFailed: (reason: string) => `Trace impossible : ${reason}`,
    traceUnreached: 'La destination n’a pas répondu aux sondes.',
    pingFiltered:
      'Note : nos serveurs ne répondent pas au ping sur leur IP publique (pare-feu) ; le dernier saut silencieux est donc normal.',
    hopCaveat:
      'Note : une perte sur un saut intermédiaire qui ne se retrouve pas sur les sauts suivants vient en général de la limitation ICMP de ce routeur, pas d’une vraie perte.',
    events: 'CHANGEMENTS D’ÉTAT ENREGISTRÉS (UTC)',
    noEvents: 'Aucun changement d’état sur la période.',
    eventsTruncated: (total: number, shown: number) => `${total} changements d’état au total, les ${shown} derniers ci-dessous.`,
    eventLine: (at: string, dir: string, status: string, loss: string, latency: string) =>
      `${at}  ${dir}  ${status}  perte ${loss}  latence ${latency}`,
    status: { healthy: 'sain    ', degraded: 'dégradé ', offline: 'coupé   ', unknown: 'inconnu ' } as Record<string, string>,
    footer: 'Rapport généré par Tarmac à partir des mesures continues des agents installés sur les deux serveurs.',
    noIp: 'IP publique inconnue',
    tooOld: 'l’agent de ce serveur est trop ancien (mettez-le à jour depuis la page Nœuds)',
    offline: 'ce serveur est hors ligne',
    timeout: 'l’agent n’a pas répondu à temps',
    duration: (minutes: number) =>
      minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${String(minutes % 60).padStart(2, '0')}` : ''}`,
  },
  en: {
    title: 'NETWORK INCIDENT REPORT: packet loss between two servers',
    generated: 'Generated',
    period: 'Period analysed',
    endpoints: 'SERVERS INVOLVED',
    publicIp: 'Public IP',
    unknownIp: 'unknown',
    summary: 'SUMMARY',
    ongoingSince: (start: string, duration: string, loss: number) =>
      `Ongoing packet loss since ${start} (${duration}), ${fmtPct(loss)} on average since then.`,
    episodes: (count: number) => `${count} period${count > 1 ? 's' : ''} of packet loss in the analysed window:`,
    episodeLine: (start: string, end: string, loss: number) => `from ${start} to ${end}, ${fmtPct(loss)} average loss`,
    noEpisode: 'No sustained packet loss in the analysed window (isolated losses only).',
    direction: (from: string, to: string) => `${from} -> ${to}`,
    sinceOnset: 'Since the incident started:',
    wholePeriod: 'Over the whole analysed window:',
    dirStats: (s: DirectionStats) =>
      `average loss ${fmtPct(s.avgLoss)}, peak ${fmtPct(s.peakLoss)}, ${fmtPct(s.lossyShare)} of measurements with loss; average latency ${fmtMs(s.avgLatency)} (min ${fmtMs(s.minLatency)}, max ${fmtMs(s.maxLatency)})`,
    comparison: 'Comparison over the same period:',
    others: (name: string, c: PeerComparison) =>
      c.peers === 0
        ? `${name} has no other measured link.`
        : `${name}: ${fmtPct(c.avgLoss)} average loss towards ${c.peers > 1 ? `its ${c.peers} other servers` : 'its other server'}.`,
    pathSpecific:
      'Both servers work normally with the rest of the network: the loss is specific to the internet route between these two addresses.',
    method: 'HOW IT WAS MEASURED',
    methodText: (port: string) => [
      'The two servers are connected by a WireGuard tunnel, i.e. UDP packets exchanged directly between the two',
      `public IPs above (UDP port ${port}). Each server sends 5 ICMP pings to the other every 25 seconds through`,
      'this tunnel, in both directions. The tunnel only encapsulates: a lost ping is a UDP packet lost on the',
      'internet route between these two addresses. All timestamps are UTC.',
    ],
    hourly: 'HOURLY HISTORY (UTC)',
    hourlyHead: ['Hour', 'loss', 'latency', 'loss', 'latency'],
    traces: 'CURRENT INTERNET PATHS (MTR-style, between the public IPs)',
    traceTitle: (from: string, fromIp: string, to: string, toIp: string, rounds: number, at: string) =>
      `${from} (${fromIp}) -> ${to} (${toIp}) — ${rounds} probes per hop, at ${at}`,
    traceHead: ['Hop', 'Address', 'Loss', 'Sent', 'Last', 'Avg', 'Best', 'Worst'],
    traceFailed: (reason: string) => `Trace not available: ${reason}`,
    traceUnreached: 'The destination did not answer the probes.',
    pingFiltered:
      'Note: our servers do not answer ping on their public IP (firewall), so a silent last hop is expected.',
    hopCaveat:
      'Note: loss on an intermediate hop that does not carry on to the following hops is usually ICMP rate limiting by that router, not actual loss.',
    events: 'RECORDED STATUS CHANGES (UTC)',
    noEvents: 'No status change in the period.',
    eventsTruncated: (total: number, shown: number) => `${total} status changes in total, the last ${shown} below.`,
    eventLine: (at: string, dir: string, status: string, loss: string, latency: string) =>
      `${at}  ${dir}  ${status}  loss ${loss}  latency ${latency}`,
    status: { healthy: 'healthy ', degraded: 'degraded', offline: 'down    ', unknown: 'unknown ' } as Record<string, string>,
    footer: 'Report generated by Tarmac from the continuous measurements of the agents running on both servers.',
    noIp: 'unknown public IP',
    tooOld: 'the agent on this server is too old',
    offline: 'this server is offline',
    timeout: 'the agent did not answer in time',
    duration: (minutes: number) =>
      minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${String(minutes % 60).padStart(2, '0')} min` : ''}`,
  },
} as const;

function fmtPct(value: number | null) {
  return value === null ? '—' : `${round1(value)}%`;
}

function fmtMs(value: number | null) {
  return value === null ? '—' : `${round1(value)} ms`;
}

function fmtUtc(date: Date, withSeconds = false) {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, withSeconds ? 19 : 16)} UTC`;
}

function pad(value: string, width: number, right = false) {
  if (value.length >= width) return value;
  return right ? value.padStart(width) : value.padEnd(width);
}

/** Readable reason for a trace that couldn't run. */
export function traceFailureReason(error: unknown, lang: LinkReportLang): string {
  const text = TEXT[lang];
  const message = error instanceof Error ? error.message : String(error);
  if (/too old/.test(message)) return text.tooOld;
  if (/offline|disconnected/.test(message)) return text.offline;
  if (/timeout|à temps/.test(message)) return text.timeout;
  return message;
}

export function buildLinkReport(input: LinkReportInput): { text: string; filename: string } {
  const t = TEXT[input.lang];
  const { a, b } = input;
  const lines: string[] = [];
  const rule = '='.repeat(96);
  const sub = '-'.repeat(96);
  const section = (title: string) => lines.push('', title, sub);
  // French puts a space before the colon, English doesn't.
  const colon = input.lang === 'fr' ? ' :' : ':';

  lines.push(rule, t.title, rule);
  lines.push(`${t.generated}${colon} ${fmtUtc(input.generatedAt)}`);
  lines.push(`${t.period}${colon} ${fmtUtc(input.since)} → ${fmtUtc(input.generatedAt)}`);

  section(t.endpoints);
  const nameWidth = Math.max(a.name.length, b.name.length) + 2;
  for (const [label, node] of [
    ['A', a],
    ['B', b],
  ] as const) {
    lines.push(
      `  ${label}  ${pad(node.name, nameWidth)}${t.publicIp} ${pad(node.publicIp ?? t.unknownIp, 17)}${node.location ?? ''}`.trimEnd(),
    );
  }

  // Summary
  section(t.summary);
  const all = [...input.aToB, ...input.bToA];
  const episodes = lossEpisodes(all, input.since, input.generatedAt);
  const ongoing = episodes.find((episode) => episode.ongoing);
  if (ongoing) {
    const minutes = Math.max(1, Math.round((input.generatedAt.getTime() - ongoing.start.getTime()) / 60_000));
    lines.push(`  ${t.ongoingSince(fmtUtc(ongoing.start), t.duration(minutes), ongoing.avgLoss)}`);
  }
  const past = episodes.filter((episode) => !episode.ongoing);
  if (past.length > 0) {
    lines.push(`  ${t.episodes(past.length)}`);
    for (const episode of past.slice(-10)) {
      lines.push(`    - ${t.episodeLine(fmtUtc(episode.start), fmtUtc(episode.end), episode.avgLoss)}`);
    }
  }
  if (episodes.length === 0) lines.push(`  ${t.noEpisode}`);
  const directionLines = (filter: (sample: ReportSample) => boolean) => {
    lines.push(`    ${t.direction('A', 'B')}${colon} ${t.dirStats(directionStats(input.aToB.filter(filter)))}`);
    lines.push(`    ${t.direction('B', 'A')}${colon} ${t.dirStats(directionStats(input.bToA.filter(filter)))}`);
  };
  if (ongoing) {
    lines.push('', `  ${t.sinceOnset}`);
    directionLines((sample) => sample.at >= ongoing.start);
  }
  lines.push('', `  ${t.wholePeriod}`);
  directionLines(() => true);
  lines.push('', `  ${t.comparison}`);
  lines.push(`    - ${t.others(`A (${a.name})`, input.aOthers)}`);
  lines.push(`    - ${t.others(`B (${b.name})`, input.bOthers)}`);
  // The link's own loss while it was failing, against what both servers
  // see with everyone else over the window.
  const incidentLoss = Math.max(0, ...episodes.map((episode) => episode.avgLoss));
  const othersClean =
    input.aOthers.peers + input.bOthers.peers > 0 &&
    [input.aOthers, input.bOthers].every((c) => c.peers === 0 || (c.avgLoss ?? 0) < Math.min(1, incidentLoss / 3));
  if (incidentLoss > 0 && othersClean) lines.push(`  ${t.pathSpecific}`);

  section(t.method);
  const port = String(a.tunnelPort ?? b.tunnelPort ?? 51820);
  for (const line of t.methodText(port)) lines.push(`  ${line}`);

  // Hourly history
  section(t.hourly);
  const hourly = new Map<number, { ab: ReportSample[]; ba: ReportSample[] }>();
  const addHour = (sample: ReportSample, key: 'ab' | 'ba') => {
    const hour = Math.floor(sample.at.getTime() / 3_600_000) * 3_600_000;
    const entry = hourly.get(hour) ?? { ab: [], ba: [] };
    entry[key].push(sample);
    hourly.set(hour, entry);
  };
  input.aToB.forEach((sample) => addHour(sample, 'ab'));
  input.bToA.forEach((sample) => addHour(sample, 'ba'));
  const [hHour, hLoss, hLat, hLoss2, hLat2] = t.hourlyHead;
  lines.push(`  ${pad(hHour, 18)}${pad(`A→B ${hLoss}`, 12, true)}${pad(hLat, 11, true)}   ${pad(`B→A ${hLoss2}`, 12, true)}${pad(hLat2, 11, true)}`);
  for (const hour of [...hourly.keys()].sort((x, y) => x - y)) {
    const entry = hourly.get(hour)!;
    const ab = directionStats(entry.ab);
    const ba = directionStats(entry.ba);
    const at = new Date(hour).toISOString();
    lines.push(
      `  ${pad(`${at.slice(0, 10)} ${at.slice(11, 16)}`, 18)}${pad(fmtPct(ab.avgLoss), 12, true)}${pad(fmtMs(ab.avgLatency), 11, true)}   ${pad(fmtPct(ba.avgLoss), 12, true)}${pad(fmtMs(ba.avgLatency), 11, true)}`,
    );
  }

  // Traces
  section(t.traces);
  const renderTrace = (from: ReportNode, to: ReportNode, outcome: TraceOutcome) => {
    if (!outcome.ok) {
      lines.push(`  ${from.name} → ${to.name}${colon} ${t.traceFailed(outcome.reason)}`);
      return;
    }
    const { trace } = outcome;
    lines.push(`  ${t.traceTitle(from.name, from.publicIp ?? '?', to.name, to.publicIp ?? '?', trace.rounds, fmtUtc(outcome.ranAt, true))}`);
    const [hHop, hAddr, hLossT, hSent, hLast, hAvg, hBest, hWorst] = t.traceHead;
    lines.push(
      `  ${pad(hHop, 5, true)}  ${pad(hAddr, 18)}${pad(hLossT, 8, true)}${pad(hSent, 6, true)}${pad(hLast, 9, true)}${pad(hAvg, 9, true)}${pad(hBest, 9, true)}${pad(hWorst, 9, true)}`,
    );
    const ms = (value: number | null) => (value === null ? '—' : value.toFixed(1));
    for (const hop of trace.hops) {
      lines.push(
        `  ${pad(String(hop.hop), 5, true)}  ${pad(hop.ip ?? '???', 18)}${pad(`${round1(hop.lossPct)}%`, 8, true)}${pad(String(hop.sent), 6, true)}${pad(ms(hop.lastMs), 9, true)}${pad(ms(hop.avgMs), 9, true)}${pad(ms(hop.bestMs), 9, true)}${pad(ms(hop.worstMs), 9, true)}`,
      );
      for (const other of hop.otherIps ?? []) lines.push(`         ${other}`);
    }
    if (!trace.reached) lines.push(`  ${t.traceUnreached}`);
  };
  renderTrace(a, b, input.traceAToB);
  lines.push('');
  renderTrace(b, a, input.traceBToA);
  lines.push('');
  if (input.publicPingFiltered) lines.push(`  ${t.pingFiltered}`);
  lines.push(`  ${t.hopCaveat}`);

  // Status changes
  section(t.events);
  const transitions: Array<{ at: Date; dir: string; sample: ReportSample }> = [];
  for (const [dir, samples] of [
    ['A→B', input.aToB],
    ['B→A', input.bToA],
  ] as const) {
    let previous: string | null = null;
    for (const sample of [...samples].sort((x, y) => x.at.getTime() - y.at.getTime())) {
      if (previous !== null && sample.status !== previous) transitions.push({ at: sample.at, dir, sample });
      previous = sample.status;
    }
  }
  transitions.sort((x, y) => x.at.getTime() - y.at.getTime());
  const MAX_EVENTS = 40;
  if (transitions.length === 0) lines.push(`  ${t.noEvents}`);
  if (transitions.length > MAX_EVENTS) lines.push(`  ${t.eventsTruncated(transitions.length, MAX_EVENTS)}`);
  for (const { at, dir, sample } of transitions.slice(-MAX_EVENTS)) {
    lines.push(
      `  ${t.eventLine(fmtUtc(at, true).replace(' UTC', ''), dir, t.status[sample.status] ?? sample.status, fmtPct(sample.packetLoss), fmtMs(sample.latencyMs))}`,
    );
  }

  lines.push('', rule, t.footer, rule, '');

  const slug = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'node';
  const stamp = input.generatedAt.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  return {
    text: lines.join('\n'),
    filename: `${input.lang === 'fr' ? 'rapport-reseau' : 'network-report'}_${slug(a.name)}_${slug(b.name)}_${stamp}Z.txt`,
  };
}
