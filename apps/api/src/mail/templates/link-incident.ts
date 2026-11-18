import type { RenderedMail } from '../mail.service';
import {
  actions,
  detailRow,
  escapeHtml,
  formatDateTime,
  kpiStrip,
  note,
  panel,
  pill,
  renderLayout,
  sectionTitle,
  textLines,
  tokens,
  type Tone,
} from './layout';

// Sent once per incident, when a direct link starts losing packets and the
// tests captured from both servers confirm it (LinkCaptureService): what
// happened, what the tests found, and the report to forward to the hosting
// provider, attached in French and English.

export type IncidentServer = { name: string; publicIp: string | null; location: string | null };

export type IncidentDirection = {
  // Null when that side couldn't run its tests (agent offline, too old...).
  pingLoss: number | null;
  pingAvgMs: number | null;
  mtrHops: number | null;
  reached: boolean | null;
  // Loss at the MTR's last hop, when the destination answered.
  mtrDestLoss: number | null;
  // From top: share of CPU in use and stolen by the hypervisor.
  cpuUsed: number | null;
  cpuSteal: number | null;
  failure: string | null;
};

export interface LinkIncidentInput {
  workspaceName: string;
  workspaceSlug: string;
  recipient: string;
  frontendUrl: string;
  // A is the side that noticed the loss.
  a: IncidentServer;
  b: IncidentServer;
  status: 'degraded' | 'offline';
  triggerLoss: number | null;
  triggerLatencyMs: number | null;
  capturedAt: Date;
  // How long the link stayed degraded while it was watched after the
  // capture (what made it an incident rather than a blip).
  degradedForMs?: number;
  observedForMs?: number;
  aToB: IncidentDirection;
  bToA: IncidentDirection;
  attachments: Array<{ filename: string; content: string }>;
}

const pct = (value: number | null) => (value === null ? '—' : `${Math.round(value * 10) / 10} %`);

function lossTone(value: number | null): Tone | 'muted' {
  if (value === null) return 'muted';
  if (value === 0) return 'ok';
  return value >= 5 ? 'danger' : 'warn';
}

function serverLine(server: IncidentServer): string {
  const ip = server.publicIp
    ? `<span style="font-family:${tokens.fontMono};font-size:13px;">${escapeHtml(server.publicIp)}</span>`
    : `<span style="color:${tokens.muted};">IP publique inconnue</span>`;
  return `${escapeHtml(server.name)}<br><span style="color:${tokens.muted};font-weight:400;">${ip}${server.location ? ` &middot; ${escapeHtml(server.location)}` : ''}</span>`;
}

function directionSummary(direction: IncidentDirection): string {
  if (direction.failure) return `<span style="color:${tokens.muted};">Tests impossibles : ${escapeHtml(direction.failure)}</span>`;
  const parts = [
    direction.pingLoss === null
      ? 'ping non disponible'
      : `ping ${pill(`${pct(direction.pingLoss)} de perte`, direction.pingLoss === 0 ? 'ok' : direction.pingLoss >= 5 ? 'danger' : 'warn')}${direction.pingAvgMs !== null ? ` &middot; ${Math.round(direction.pingAvgMs * 10) / 10} ms en moyenne` : ''}`,
    direction.mtrHops === null
      ? ''
      : `MTR : ${direction.mtrHops} sauts, ${direction.reached === false ? 'destination muette' : `${pct(direction.mtrDestLoss)} de perte à destination`}`,
    direction.cpuUsed === null ? '' : `CPU ${pct(direction.cpuUsed)} utilisé${direction.cpuSteal ? `, ${pct(direction.cpuSteal)} volé (steal)` : ''}`,
  ].filter(Boolean);
  return parts.join('<br>');
}

function directionText(direction: IncidentDirection): string {
  if (direction.failure) return `tests impossibles (${direction.failure})`;
  return [
    direction.pingLoss === null ? 'ping non disponible' : `ping ${pct(direction.pingLoss)} de perte`,
    direction.mtrHops === null ? '' : `MTR ${direction.mtrHops} sauts${direction.reached === false ? '' : ` (${pct(direction.mtrDestLoss)} à destination)`}`,
    direction.cpuUsed === null ? '' : `CPU ${pct(direction.cpuUsed)} (steal ${pct(direction.cpuSteal)})`,
  ]
    .filter(Boolean)
    .join(', ');
}

function durationText(input: LinkIncidentInput): string | null {
  if (input.degradedForMs === undefined || !input.observedForMs) return null;
  const degraded = Math.max(1, Math.round(input.degradedForMs / 60_000));
  const observed = Math.round(input.observedForMs / 60_000);
  return `${degraded} min sur les ${observed} minutes suivantes`;
}

export function renderLinkIncident(input: LinkIncidentInput): RenderedMail {
  const { a, b, workspaceName, workspaceSlug, recipient, frontendUrl } = input;
  const offline = input.status === 'offline';
  const tone: Tone = offline ? 'danger' : 'warn';
  const title = offline ? `Lien coupé entre ${a.name} et ${b.name}` : `Lien dégradé entre ${a.name} et ${b.name}`;
  const lossText = input.triggerLoss === null ? '' : ` · ${pct(input.triggerLoss)} de perte`;
  const subject = `[Tarmac] ${offline ? 'Lien coupé' : 'Lien dégradé'} · ${a.name} ↔ ${b.name}${lossText}`;
  const base = `${frontendUrl}/${encodeURIComponent(workspaceSlug)}/dashboard`;
  const duration = durationText(input);
  const strong = (text: string) => `<strong style="color:${tokens.foreground};font-weight:600;">${escapeHtml(text)}</strong>`;

  const intro = `Le ${escapeHtml(formatDateTime(input.capturedAt))}, le lien ${strong(a.name)} &rarr; ${strong(b.name)} ${
    offline
      ? 'ne passait plus'
      : `a perdu ${input.triggerLoss === null ? 'des paquets' : `${escapeHtml(pct(input.triggerLoss))} des paquets`}`
  }. Tarmac a aussitôt lancé depuis les deux serveurs les tests qu’exigent les hébergeurs (top, ping, traceroute et MTR) : les voici, avec le rapport à leur transmettre.`;

  const body = `${kpiStrip([
    { value: pct(input.triggerLoss), label: 'Perte détectée', tone },
    { value: pct(input.aToB.pingLoss), label: 'Ping depuis A', tone: lossTone(input.aToB.pingLoss) },
    { value: pct(input.bToA.pingLoss), label: 'Ping depuis B', tone: lossTone(input.bToA.pingLoss) },
  ])}
  ${sectionTitle('Serveurs')}
  ${panel(
    [
      detailRow('Serveur A', serverLine(a), true),
      detailRow('Serveur B', serverLine(b), false),
      detailRow('Tests capturés', escapeHtml(formatDateTime(input.capturedAt)), false),
      ...(duration ? [detailRow(offline ? 'Coupé pendant' : 'Dégradé pendant', escapeHtml(duration), false)] : []),
    ].join(''),
  )}
  ${sectionTitle('Ce que les tests ont relevé')}
  ${panel(
    [
      detailRow(`Depuis A<br><span style="color:${tokens.faint};">${escapeHtml(a.name)}</span>`, directionSummary(input.aToB), true),
      detailRow(`Depuis B<br><span style="color:${tokens.faint};">${escapeHtml(b.name)}</span>`, directionSummary(input.bToA), false),
    ].join(''),
  )}
  ${note(
    `<strong style="font-weight:600;">Deux pièces jointes</strong> : le rapport complet en français, et sa version anglaise à transférer telle quelle au support de l’hébergeur de chaque serveur. Tant que le lien reste dégradé, Tarmac refait ces tests toutes les 30 minutes ; le rapport généré depuis la page Réseau privé les inclut. L’alerte se résout d’elle-même après 15 minutes sans dégradation.`,
  )}
  ${actions({ label: 'Voir le réseau', href: `${base}/network` }, { label: 'Voir l’alerte', href: `${base}/alerts` })}`;

  const html = renderLayout({
    title,
    preheader: `${a.name} → ${b.name}${lossText}. Tests et rapport pour l’hébergeur en pièce jointe.`,
    context: workspaceName,
    hero: { icon: '&#8646;', tone, eyebrow: 'Incident réseau', title, lede: intro },
    body,
    footer: `Envoyé à <span style="color:${tokens.muted};">${escapeHtml(recipient)}</span> parce que vous suivez les alertes de «&nbsp;${escapeHtml(workspaceName)}&nbsp;». Un seul email par incident, même si le lien reste dégradé plusieurs heures ou qu’un même serveur perd des paquets vers plusieurs autres. Les pertes passagères ne font pas l’objet d’un email.`,
    links: [{ label: 'Gérer mes notifications', href: `${base}/settings` }],
    frontendUrl,
  });

  const text = textLines([
    `${title} — ${workspaceName}`,
    '',
    `Le ${formatDateTime(input.capturedAt)}, le lien ${a.name} -> ${b.name} ${offline ? 'ne passait plus' : `a perdu ${pct(input.triggerLoss)} des paquets`}.`,
    ...(duration ? [`${offline ? 'Coupé' : 'Dégradé'} pendant ${duration}.`] : []),
    'Tarmac a lancé depuis les deux serveurs les tests qu’exigent les hébergeurs (top, ping, traceroute, MTR).',
    '',
    `A : ${a.name} (${a.publicIp ?? 'IP inconnue'})${a.location ? `, ${a.location}` : ''}`,
    `B : ${b.name} (${b.publicIp ?? 'IP inconnue'})${b.location ? `, ${b.location}` : ''}`,
    '',
    `Depuis ${a.name} : ${directionText(input.aToB)}`,
    `Depuis ${b.name} : ${directionText(input.bToA)}`,
    '',
    'En pièce jointe : le rapport en français et sa version anglaise, à transférer au support de l’hébergeur.',
    '',
    `Voir le réseau : ${base}/network`,
    `Voir l’alerte : ${base}/alerts`,
  ]);

  return {
    subject,
    html,
    text,
    attachments: input.attachments.map((file) => ({ ...file, contentType: 'text/plain; charset=utf-8' })),
  };
}
