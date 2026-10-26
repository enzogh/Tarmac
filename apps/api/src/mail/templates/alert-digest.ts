import { AlertSeverity } from '@prisma/client';
import type { RenderedMail } from '../mail.service';
import {
  actions,
  detailRow,
  escapeHtml,
  formatDateTime,
  formatDay,
  formatTime,
  kpiStrip,
  note,
  panel,
  pill,
  renderLayout,
  sectionTitle,
  tokens,
  tones,
  type Tone,
} from './layout';

export interface DigestAlert {
  message: string;
  severity: AlertSeverity;
  triggeredAt: Date;
  nodeName?: string | null;
}

export interface AlertDigestInput {
  workspaceName: string;
  workspaceSlug: string;
  recipient: string;
  frontendUrl: string;
  alerts: DigestAlert[];
}

// Same labels and hues as SEVERITY in apps/web/components/ui/status.tsx;
// critical additionally gets a filled pill so it still stands apart from
// "élevée" without inventing a fifth colour.
const SEVERITIES: Record<AlertSeverity, { label: string; plural: string; tone: Tone; rank: number }> = {
  critical: { label: 'Critique', plural: 'critiques', tone: 'danger', rank: 0 },
  high: { label: 'Élevée', plural: 'élevées', tone: 'danger', rank: 1 },
  medium: { label: 'Moyenne', plural: 'moyennes', tone: 'warn', rank: 2 },
  low: { label: 'Faible', plural: 'faibles', tone: 'info', rank: 3 },
};
const ORDER: AlertSeverity[] = ['critical', 'high', 'medium', 'low'];

// Past this many rows the email stops being readable and the app is the
// better place - the rest is summarised as a count under the list.
const MAX_ROWS = 25;

interface Row {
  message: string;
  severity: AlertSeverity;
  nodeName: string | null;
  count: number;
  latest: Date;
}

// A flapping check fires the same alert again and again; one row with a
// count says the same thing as ten identical rows.
function collapse(alerts: DigestAlert[]): Row[] {
  const rows = new Map<string, Row>();
  for (const alert of alerts) {
    const key = `${alert.severity}\u0000${alert.nodeName ?? ''}\u0000${alert.message}`;
    const row = rows.get(key);
    if (row) {
      row.count += 1;
      if (alert.triggeredAt > row.latest) row.latest = alert.triggeredAt;
    } else {
      rows.set(key, {
        message: alert.message,
        severity: alert.severity,
        nodeName: alert.nodeName ?? null,
        count: 1,
        latest: alert.triggeredAt,
      });
    }
  }
  return [...rows.values()].sort(
    (a, b) => SEVERITIES[a.severity].rank - SEVERITIES[b.severity].rank || b.latest.getTime() - a.latest.getTime(),
  );
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count > 1 ? many : one}`;
}

// "Lien VLAN hors ligne : A ↔ B" -> a short title over its specifics, as
// the Alertes page shows it (splitMessage in alerts/page.tsx).
function splitMessage(message: string): { title: string; detail: string | null } {
  const index = message.indexOf(' : ');
  if (index > 0 && index <= 48) return { title: message.slice(0, index), detail: message.slice(index + 3) };
  return { title: message, detail: null };
}

function nodeChip(nodeName: string | null): string {
  if (!nodeName) return `<span style="font-size:12px;color:${tokens.muted};">Plateforme</span>`;
  return `<span style="display:inline-block;padding:1px 8px;border-radius:6px;background-color:${tokens.surface3};border:1px solid ${tokens.border};font-family:${tokens.fontMono};font-size:12px;line-height:18px;color:${tokens.foreground};white-space:nowrap;">${escapeHtml(nodeName)}</span>`;
}

function repeatChip(count: number): string {
  return count > 1
    ? `&nbsp;&nbsp;<span style="display:inline-block;padding:1px 7px;border-radius:999px;background-color:${tokens.surface3};border:1px solid ${tokens.border};font-size:11px;line-height:16px;font-weight:600;color:${tokens.muted};">&times;${count}</span>`
    : '';
}

// One alert of a digest: a bar in its severity's colour down the left edge,
// severity + node + time on top, the message (title / specifics) below.
function alertRow(row: Row, first: boolean): string {
  const meta = SEVERITIES[row.severity];
  const border = first ? '' : `border-top:1px solid ${tokens.border};`;
  const { title, detail } = splitMessage(row.message);
  return `<tr>
    <td width="3" style="${border}width:3px;padding:0;background-color:${tones[meta.tone].color};font-size:0;line-height:0;">&nbsp;</td>
    <td style="${border}padding:16px 20px 17px 17px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="middle" style="font-size:12px;line-height:20px;">${pill(meta.label, meta.tone, row.severity === 'critical')}&nbsp;&nbsp;${nodeChip(row.nodeName)}${repeatChip(row.count)}</td>
        <td valign="middle" align="right" style="font-size:12px;line-height:20px;color:${tokens.muted};font-variant-numeric:tabular-nums;white-space:nowrap;">${formatTime(row.latest)}</td>
      </tr></table>
      <p style="margin:9px 0 0;font-size:14px;line-height:21px;font-weight:600;color:${tokens.foreground};word-break:break-word;">${escapeHtml(title)}</p>
      ${detail ? `<p style="margin:2px 0 0;font-size:13px;line-height:20px;color:${tokens.muted};word-break:break-word;">${escapeHtml(detail)}</p>` : ''}
    </td>
  </tr>`;
}

// A lone alert gets the whole card: the hero already carries its title, so
// the card answers what an on-call person asks next - what exactly, where,
// how bad, since when.
function singleAlert(row: Row, workspaceName: string): string {
  const meta = SEVERITIES[row.severity];
  const { detail } = splitMessage(row.message);
  const rows = [
    detail ? detailRow('Détail', escapeHtml(detail), true) : '',
    detailRow('Sévérité', pill(meta.label, meta.tone, row.severity === 'critical'), !detail),
    detailRow('Nœud', row.nodeName ? nodeChip(row.nodeName) : `<span style="color:${tokens.muted};">Plateforme (aucun nœud précis)</span>`, false),
    detailRow('Déclenchée', `${escapeHtml(formatDateTime(row.latest))}${row.count > 1 ? `<span style="color:${tokens.muted};"> &middot; ${row.count} fois</span>` : ''}`, false),
    detailRow('Workspace', escapeHtml(workspaceName), false),
  ];
  return panel(rows.join(''));
}

export function renderAlertDigest(input: AlertDigestInput): RenderedMail {
  const { workspaceName, workspaceSlug, recipient, frontendUrl, alerts } = input;
  const rows = collapse(alerts);
  const counts = { critical: 0, high: 0, medium: 0, low: 0 } as Record<AlertSeverity, number>;
  for (const row of rows) counts[row.severity] += 1;

  const worst = ORDER.find((severity) => counts[severity] > 0) ?? 'low';
  const worstMeta = SEVERITIES[worst];
  const times = alerts.map((alert) => alert.triggeredAt.getTime());
  const first = new Date(Math.min(...times));
  const last = new Date(Math.max(...times));
  // Repeats of one alert are still one problem: the email says "an alert",
  // with its count, not "3 new alerts".
  const single = rows.length === 1;

  const alertsUrl = `${frontendUrl}/${encodeURIComponent(workspaceSlug)}/dashboard/alerts`;
  const settingsUrl = `${frontendUrl}/${encodeURIComponent(workspaceSlug)}/dashboard/settings`;

  const breakdown = ORDER.filter((severity) => counts[severity] > 0)
    .map((severity) => plural(counts[severity], SEVERITIES[severity].label.toLowerCase(), SEVERITIES[severity].plural))
    .join(', ');

  const singleTitle = single ? splitMessage(rows[0].message).title : '';
  const title = single ? singleTitle : `${rows.length} nouvelles alertes`;
  const subject = single
    ? `[Tarmac] ${worstMeta.label} · ${rows[0].message.slice(0, 90)}${rows[0].message.length > 90 ? '…' : ''}`
    : `[Tarmac] ${rows.length} alertes sur ${workspaceName} · ${breakdown}`;
  const when =
    single || last.getTime() - first.getTime() < 60_000
      ? `Le ${formatDateTime(last)}`
      : `Entre ${formatTime(first)} et ${formatTime(last)}, le ${formatDay(last)}`;
  const intro = single
    ? `${when}${rows[0].nodeName ? ` sur <strong style="color:${tokens.foreground};font-weight:600;">${escapeHtml(rows[0].nodeName)}</strong>` : ''}, dans le workspace «&nbsp;${escapeHtml(workspaceName)}&nbsp;». Voici ce qui s'est passé.`
    : `${when}, dans le workspace «&nbsp;${escapeHtml(workspaceName)}&nbsp;». Elles sont arrivées ensemble : les voici réunies dans un seul message, les plus graves en premier.`;

  const shown = rows.slice(0, MAX_ROWS);
  const hidden = rows.length - shown.length;

  const body = single
    ? `${singleAlert(rows[0], workspaceName)}
    ${note('Prenez-la en compte depuis la page Alertes pour que vos collègues sachent que quelqu’un s’en occupe. Elle se résout d’elle-même quand le problème disparaît.')}
    ${actions({ label: "Voir l'alerte", href: alertsUrl })}`
    : `${kpiStrip(
        ORDER.map((severity) => ({
          value: String(counts[severity]),
          label: SEVERITIES[severity].label,
          tone: counts[severity] > 0 ? SEVERITIES[severity].tone : ('muted' as const),
        })),
        0,
      )}
    ${sectionTitle('Détail', escapeHtml(breakdown))}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${tokens.surface2}" style="background-color:${tokens.surface2};border:1px solid ${tokens.border};border-radius:12px;border-collapse:separate;overflow:hidden;">
      ${shown.map((row, index) => alertRow(row, index === 0)).join('')}
      ${
        hidden > 0
          ? `<tr><td colspan="2" style="border-top:1px solid ${tokens.border};padding:14px 20px;font-size:13px;line-height:20px;color:${tokens.muted};">… et ${plural(hidden, 'autre alerte', 'autres alertes')}, à retrouver dans Tarmac.</td></tr>`
          : ''
      }
    </table>
    ${actions({ label: 'Ouvrir les alertes', href: alertsUrl })}`;

  const footer = `Envoyé à <span style="color:${tokens.muted};">${escapeHtml(recipient)}</span> parce que vous suivez les alertes de «&nbsp;${escapeHtml(workspaceName)}&nbsp;». Les alertes simultanées sont réunies dans un seul email, et une alerte qui se répète n'est pas renvoyée tant qu'elle n'est pas résolue.`;

  const html = renderLayout({
    title,
    preheader: single ? rows[0].message : `${breakdown} — ${rows[0]?.message ?? ''}`,
    context: workspaceName,
    hero: {
      icon: '&#9888;',
      tone: worstMeta.tone,
      eyebrow: single ? `Alerte ${worstMeta.label.toLowerCase()}` : 'Alertes groupées',
      title,
      lede: intro,
    },
    body,
    footer,
    links: [{ label: 'Gérer mes notifications', href: settingsUrl }],
    frontendUrl,
  });

  const text = [
    `${single ? `Alerte ${worstMeta.label.toLowerCase()}` : title} — ${workspaceName}`,
    `${when}.`,
    single ? '' : `Résumé : ${breakdown}.`,
    '',
    ...shown.map(
      (row) =>
        `• [${SEVERITIES[row.severity].label}] ${row.nodeName ?? 'Plateforme'} — ${row.message}${row.count > 1 ? ` (×${row.count})` : ''} — ${formatTime(row.latest)}`,
    ),
    hidden > 0 ? `… et ${plural(hidden, 'autre alerte', 'autres alertes')}.` : '',
    '',
    `Ouvrir les alertes : ${alertsUrl}`,
    `Gérer mes notifications : ${settingsUrl}`,
  ]
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n');

  return { subject, html, text };
}
