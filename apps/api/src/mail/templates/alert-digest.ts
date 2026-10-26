import { AlertSeverity } from '@prisma/client';
import type { RenderedMail } from '../mail.service';
import {
  button,
  escapeHtml,
  eyebrow,
  formatDateTime,
  formatDay,
  formatTime,
  pill,
  renderLayout,
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

function summaryStrip(counts: Record<AlertSeverity, number>): string {
  const cells = ORDER.map((severity, index) => {
    const count = counts[severity];
    const meta = SEVERITIES[severity];
    const color = count > 0 ? tones[meta.tone].color : tokens.faint;
    const divider = index > 0 ? `border-left:1px solid ${tokens.border};` : '';
    return `<td width="25%" align="left" valign="top" style="${divider}padding:14px 16px;">
      <div style="font-size:24px;line-height:28px;font-weight:600;color:${color};font-variant-numeric:tabular-nums;">${count}</div>
      <div style="padding-top:2px;font-size:11px;line-height:16px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:${tokens.muted};">${meta.label}</div>
    </td>`;
  }).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${tokens.surface2}" style="background-color:${tokens.surface2};border:1px solid ${tokens.border};border-radius:10px;margin:0 0 24px;"><tr>${cells}</tr></table>`;
}

function alertRow(row: Row, first: boolean): string {
  const meta = SEVERITIES[row.severity];
  const border = first ? '' : `border-top:1px solid ${tokens.border};`;
  const node = row.nodeName
    ? `<span style="font-family:${tokens.fontMono};font-size:12px;color:${tokens.foreground};">${escapeHtml(row.nodeName)}</span>`
    : `<span style="color:${tokens.muted};">Plateforme</span>`;
  const repeat =
    row.count > 1
      ? `&nbsp;&nbsp;<span style="display:inline-block;padding:1px 7px;border-radius:999px;background-color:${tokens.surface3};border:1px solid ${tokens.border};font-size:11px;line-height:16px;font-weight:600;color:${tokens.muted};">&times;${row.count}</span>`
      : '';
  return `<tr><td style="${border}padding:16px 18px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td valign="top">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
          <td valign="middle" style="font-size:12px;line-height:18px;">${pill(meta.label, meta.tone, row.severity === 'critical')}&nbsp;&nbsp;${node}${repeat}</td>
          <td valign="middle" align="right" style="font-size:12px;line-height:18px;color:${tokens.muted};font-variant-numeric:tabular-nums;white-space:nowrap;">${formatTime(row.latest)}</td>
        </tr></table>
        <p style="margin:8px 0 0;font-size:14px;line-height:21px;color:${tokens.foreground};word-break:break-word;">${escapeHtml(row.message)}</p>
      </td>
    </tr></table>
  </td></tr>`;
}

export function renderAlertDigest(input: AlertDigestInput): RenderedMail {
  const { workspaceName, workspaceSlug, recipient, frontendUrl, alerts } = input;
  const rows = collapse(alerts);
  const counts = { critical: 0, high: 0, medium: 0, low: 0 } as Record<AlertSeverity, number>;
  for (const alert of alerts) counts[alert.severity] += 1;

  const worst = ORDER.find((severity) => counts[severity] > 0) ?? 'low';
  const worstMeta = SEVERITIES[worst];
  const times = alerts.map((alert) => alert.triggeredAt.getTime());
  const first = new Date(Math.min(...times));
  const last = new Date(Math.max(...times));
  const single = alerts.length === 1;

  const alertsUrl = `${frontendUrl}/${encodeURIComponent(workspaceSlug)}/dashboard/alerts`;
  const settingsUrl = `${frontendUrl}/${encodeURIComponent(workspaceSlug)}/dashboard/settings`;

  const breakdown = ORDER.filter((severity) => counts[severity] > 0)
    .map((severity) => plural(counts[severity], SEVERITIES[severity].label.toLowerCase(), SEVERITIES[severity].plural))
    .join(', ');

  const title = single ? `Nouvelle alerte ${worstMeta.label.toLowerCase()}` : `${alerts.length} nouvelles alertes`;
  const subject = single
    ? `[Tarmac] ${worstMeta.label} · ${alerts[0].message.slice(0, 90)}${alerts[0].message.length > 90 ? '…' : ''}`
    : `[Tarmac] ${alerts.length} alertes sur ${workspaceName} · ${breakdown}`;
  const when =
    single || last.getTime() - first.getTime() < 60_000
      ? `Le ${formatDateTime(last)}`
      : `Entre ${formatTime(first)} et ${formatTime(last)}, le ${formatDay(last)}`;
  const lede = single
    ? `${when}, sur le workspace «&nbsp;${escapeHtml(workspaceName)}&nbsp;».`
    : `${when}, sur le workspace «&nbsp;${escapeHtml(workspaceName)}&nbsp;». Elles sont arrivées ensemble et sont regroupées ici en un seul message.`;

  const shown = rows.slice(0, MAX_ROWS);
  const hiddenRows = rows.slice(MAX_ROWS);
  const hidden = hiddenRows.reduce((sum, row) => sum + row.count, 0);

  const body = `
    ${eyebrow(single ? 'Alerte' : 'Alertes groupées', worstMeta.tone)}
    <h1 class="h1" style="margin:0 0 10px;font-size:26px;line-height:32px;font-weight:600;letter-spacing:-0.02em;color:${tokens.foreground};">${escapeHtml(title)}</h1>
    <p style="margin:0 0 26px;font-size:14px;line-height:22px;color:${tokens.muted};">${lede}</p>
    ${single ? '' : summaryStrip(counts)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${tokens.surface2}" style="background-color:${tokens.surface2};border:1px solid ${tokens.border};border-radius:10px;">
      ${shown.map((row, index) => alertRow(row, index === 0)).join('')}
      ${
        hidden > 0
          ? `<tr><td style="border-top:1px solid ${tokens.border};padding:14px 18px;font-size:13px;line-height:20px;color:${tokens.muted};">… et ${plural(hidden, 'autre alerte', 'autres alertes')}, à retrouver dans Tarmac.</td></tr>`
          : ''
      }
    </table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;"><tr>
      <td class="stack" valign="middle">${button(single ? "Voir l'alerte" : 'Ouvrir les alertes', alertsUrl)}</td>
      <td class="stack hide-sm" valign="middle" align="right" style="font-size:12px;line-height:18px;color:${tokens.faint};">Prenez-les en compte ou résolvez-les<br>depuis la page Alertes.</td>
    </tr></table>`;

  const footer = `Envoyé à <span style="color:${tokens.muted};">${escapeHtml(recipient)}</span> parce que vous suivez les alertes de «&nbsp;${escapeHtml(workspaceName)}&nbsp;». Les alertes qui arrivent à quelques secondes d'intervalle sont réunies dans un seul email.<br><a href="${escapeHtml(settingsUrl)}" style="color:${tokens.muted};text-decoration:underline;">Gérer mes notifications</a>`;

  const html = renderLayout({
    title,
    preheader: single ? alerts[0].message : `${breakdown} — ${rows[0]?.message ?? ''}`,
    context: workspaceName,
    accent: worstMeta.tone,
    body,
    footer,
  });

  const text = [
    `${title} — ${workspaceName}`,
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
