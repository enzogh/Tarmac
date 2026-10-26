import { AlertSeverity } from '@prisma/client';
import type { RenderedMail } from '../mail.service';
import {
  actions,
  escapeHtml,
  eyebrow,
  formatDay,
  greeting,
  kpiStrip,
  lede,
  meter,
  panel,
  pill,
  renderLayout,
  sectionTitle,
  textLines,
  tokens,
  type Tone,
  tones,
} from './layout';

export interface WeeklyReportInput {
  recipient: string;
  recipientName?: string | null;
  workspaceName: string;
  workspaceSlug: string;
  frontendUrl: string;
  periodStart: Date;
  periodEnd: Date;
  // First day with availability data when it is later than periodStart
  // (a node added mid-week, or the measure itself is new).
  coverageSince?: Date | null;
  nodes: { name: string; availability: number | null; online: boolean }[];
  alerts: {
    total: number;
    bySeverity: Record<AlertSeverity, number>;
    open: number;
    top: { message: string; nodeName: string | null; severity: AlertSeverity; count: number }[];
  };
  storage: { nodeName: string; usedGb: number; capacityGb: number; growthGb: number | null; daysToFull: number | null }[];
  backups: { jobName: string; succeeded: number; failed: number; lastStatus: 'success' | 'failed' | null }[];
}

const SEVERITY: Record<AlertSeverity, { label: string; tone: Tone }> = {
  critical: { label: 'Critique', tone: 'danger' },
  high: { label: 'Élevée', tone: 'danger' },
  medium: { label: 'Moyenne', tone: 'warn' },
  low: { label: 'Faible', tone: 'info' },
};

const percent = (ratio: number) => `${(ratio * 100).toFixed(ratio >= 0.9995 ? 0 : ratio >= 0.99 ? 2 : 1).replace('.', ',')} %`;
const gb = (value: number) => (value >= 1024 ? `${(value / 1024).toFixed(1).replace('.', ',')} To` : `${value} Go`);
const plural = (count: number, one: string, many: string) => `${count} ${count > 1 ? many : one}`;

function availabilityTone(ratio: number | null): Tone {
  if (ratio === null) return 'info';
  return ratio >= 0.995 ? 'ok' : ratio >= 0.97 ? 'warn' : 'danger';
}

function usageTone(ratio: number): Tone {
  return ratio >= 0.9 ? 'danger' : ratio >= 0.8 ? 'warn' : 'ok';
}

// `span` stretches a single cell across a table that has more columns.
function tableRow(cells: string[], first: boolean, span = 1): string {
  const border = first ? '' : `border-top:1px solid ${tokens.border};`;
  return `<tr>${cells
    .map((cell, index) => {
      // The meter column (always the middle of three) folds away on phones.
      const meterCell = cells.length === 3 && index === 1;
      return `<td valign="middle"${span > 1 ? ` colspan="${span}"` : ''}${meterCell ? ' class="hide-sm" width="126"' : ''} style="${border}padding:12px 16px;font-size:13px;line-height:19px;color:${tokens.foreground};">${cell}</td>`;
    })
    .join('')}</tr>`;
}

const mono = (value: string) => `<span style="font-family:${tokens.fontMono};font-size:12px;">${escapeHtml(value)}</span>`;
const muted = (value: string) => `<span style="color:${tokens.muted};">${value}</span>`;

export function weeklyAttentionPoints(input: WeeklyReportInput): string[] {
  const points: string[] = [];
  const offline = input.nodes.filter((node) => !node.online);
  if (offline.length > 0) points.push(`${plural(offline.length, 'nœud est hors ligne', 'nœuds sont hors ligne')} en ce moment : ${offline.map((node) => node.name).join(', ')}.`);
  const unstable = input.nodes.filter((node) => node.online && node.availability !== null && node.availability < 0.99);
  if (unstable.length > 0) points.push(`Disponibilité sous 99 % pour ${unstable.map((node) => node.name).join(', ')}.`);
  const full = input.storage.filter((disk) => disk.capacityGb > 0 && (disk.usedGb / disk.capacityGb >= 0.85 || (disk.daysToFull !== null && disk.daysToFull <= 30)));
  for (const disk of full) {
    points.push(
      disk.daysToFull !== null && disk.daysToFull <= 30
        ? `Le stockage de ${disk.nodeName} pourrait être plein dans environ ${plural(Math.max(1, Math.round(disk.daysToFull)), 'jour', 'jours')}.`
        : `Le stockage de ${disk.nodeName} est rempli à ${Math.round((disk.usedGb / disk.capacityGb) * 100)} %.`,
    );
  }
  const failedJobs = input.backups.filter((job) => job.lastStatus === 'failed');
  if (failedJobs.length > 0) points.push(`Dernière exécution en échec pour ${failedJobs.map((job) => `« ${job.jobName} »`).join(', ')}.`);
  if (input.alerts.open > 0) points.push(`${plural(input.alerts.open, 'alerte reste ouverte', 'alertes restent ouvertes')}.`);
  return points;
}

export function renderWeeklyReport(input: WeeklyReportInput): RenderedMail {
  const { recipient, recipientName, workspaceName, workspaceSlug, frontendUrl, periodStart, periodEnd, coverageSince, nodes, alerts, storage, backups } = input;
  const dashboardUrl = `${frontendUrl}/${encodeURIComponent(workspaceSlug)}/dashboard`;
  const settingsUrl = `${dashboardUrl}/settings`;
  const period = `du ${formatDay(periodStart)} au ${formatDay(periodEnd)}`;

  const measured = nodes.filter((node) => node.availability !== null);
  const fleetAvailability = measured.length > 0 ? measured.reduce((sum, node) => sum + (node.availability as number), 0) / measured.length : null;
  const runs = backups.reduce((sum, job) => sum + job.succeeded + job.failed, 0);
  const failedRuns = backups.reduce((sum, job) => sum + job.failed, 0);
  const fullest = storage.reduce<number | null>((max, disk) => (disk.capacityGb > 0 ? Math.max(max ?? 0, disk.usedGb / disk.capacityGb) : max), null);
  const points = weeklyAttentionPoints(input);

  const title = `Votre semaine sur « ${workspaceName} »`;
  const verdict =
    points.length === 0
      ? `Tout s'est bien passé : rien ne demande votre attention.`
      : `${plural(points.length, 'point demande', 'points demandent')} votre attention, détaillés ci-dessous.`;

  const kpis = kpiStrip([
    { value: fleetAvailability === null ? '—' : percent(fleetAvailability), label: 'Disponibilité', tone: fleetAvailability === null ? 'muted' : availabilityTone(fleetAvailability) },
    { value: String(alerts.total), label: 'Alertes', tone: alerts.total === 0 ? 'ok' : alerts.bySeverity.critical + alerts.bySeverity.high > 0 ? 'danger' : 'warn' },
    { value: runs === 0 ? '—' : `${runs - failedRuns}/${runs}`, label: 'Sauvegardes', tone: runs === 0 ? 'muted' : failedRuns > 0 ? 'warn' : 'ok' },
    { value: fullest === null ? '—' : `${Math.round(fullest * 100)} %`, label: 'Stockage max', tone: fullest === null ? 'muted' : usageTone(fullest) },
  ]);

  const attention =
    points.length > 0
      ? `${sectionTitle('À surveiller')}${panel(
          points
            .map((point, index) =>
              tableRow([`<span style="color:${tones.warn.color};font-size:9px;vertical-align:1px;">&#9679;</span>&nbsp;&nbsp;${escapeHtml(point)}`], index === 0),
            )
            .join(''),
        )}`
      : '';

  const nodesSection =
    nodes.length === 0
      ? ''
      : `${sectionTitle('Disponibilité des nœuds', coverageSince ? `mesurée depuis le ${escapeHtml(formatDay(coverageSince))}` : 'sur 7 jours')}${panel(
          [...nodes]
            .sort((a, b) => (a.availability ?? 2) - (b.availability ?? 2) || a.name.localeCompare(b.name))
            .map((node, index) =>
              tableRow(
                [
                  `${mono(node.name)}${node.online ? '' : `&nbsp;&nbsp;${pill('Hors ligne', 'danger')}`}`,
                  node.availability === null ? '' : meter(node.availability, availabilityTone(node.availability), 110),
                  `<div style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;color:${node.availability === null ? tokens.muted : tones[availabilityTone(node.availability)].color};">${node.availability === null ? 'pas encore mesurée' : percent(node.availability)}</div>`,
                ],
                index === 0,
              ),
            )
            .join(''),
        )}`;

  const alertsSection = `${sectionTitle('Alertes', alerts.total > 0 ? `${plural(alerts.total, 'déclenchée', 'déclenchées')} · ${plural(alerts.open, 'ouverte', 'ouvertes')}` : '')}${
    alerts.total === 0
      ? panel(tableRow([`<span style="color:${tones.ok.color};">&#10003;</span>&nbsp;&nbsp;Aucune alerte cette semaine.`], true))
      : panel(
          alerts.top
            .map((row, index) =>
              tableRow(
                [
                  `${pill(SEVERITY[row.severity].label, SEVERITY[row.severity].tone, row.severity === 'critical')}&nbsp;&nbsp;${row.nodeName ? mono(row.nodeName) : muted('Plateforme')}<div style="padding-top:5px;">${escapeHtml(row.message)}</div>`,
                  `<div style="text-align:right;white-space:nowrap;color:${tokens.muted};font-variant-numeric:tabular-nums;">&times;${row.count}</div>`,
                ],
                index === 0,
              ),
            )
            .join('') +
            (alerts.total > alerts.top.reduce((sum, row) => sum + row.count, 0)
              ? tableRow([muted(`… et ${plural(alerts.total - alerts.top.reduce((sum, row) => sum + row.count, 0), 'autre', 'autres')}, à retrouver dans la page Alertes.`)], false, 2)
              : ''),
        )
  }`;

  const storageSection =
    storage.length === 0
      ? ''
      : `${sectionTitle('Stockage')}${panel(
          [...storage]
            .sort((a, b) => b.usedGb / (b.capacityGb || 1) - a.usedGb / (a.capacityGb || 1))
            .slice(0, 8)
            .map((disk, index) => {
              const ratio = disk.capacityGb > 0 ? disk.usedGb / disk.capacityGb : 0;
              const growth =
                disk.growthGb === null
                  ? ''
                  : disk.growthGb === 0
                    ? 'stable'
                    : `${disk.growthGb > 0 ? '+' : '−'}${gb(Math.abs(disk.growthGb))} cette semaine`;
              const forecast = disk.daysToFull !== null && disk.daysToFull <= 90 ? ` · plein dans ~${Math.max(1, Math.round(disk.daysToFull))} j` : '';
              return tableRow(
                [
                  `${mono(disk.nodeName)}<div style="padding-top:3px;font-size:12px;color:${tokens.muted};">${gb(disk.usedGb)} sur ${gb(disk.capacityGb)}${growth ? ` · ${growth}` : ''}${forecast}</div>`,
                  meter(ratio, usageTone(ratio), 110),
                  `<div style="text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums;color:${tones[usageTone(ratio)].color};">${Math.round(ratio * 100)} %</div>`,
                ],
                index === 0,
              );
            })
            .join(''),
        )}`;

  const backupsSection =
    backups.length === 0
      ? ''
      : `${sectionTitle('Sauvegardes et réplications')}${panel(
          backups
            .map((job, index) =>
              tableRow(
                [
                  escapeHtml(job.jobName),
                  `<div style="text-align:right;white-space:nowrap;">${
                    job.succeeded + job.failed === 0
                      ? muted('aucune exécution')
                      : `${job.succeeded > 0 ? pill(`${job.succeeded} réussie${job.succeeded > 1 ? 's' : ''}`, 'ok') : ''}${job.failed > 0 ? `&nbsp;${pill(`${job.failed} en échec`, 'danger')}` : ''}`
                  }</div>`,
                ],
                index === 0,
              ),
            )
            .join(''),
        )}`;

  const body = `
    ${kpis}
    ${attention}
    ${nodesSection}
    ${alertsSection}
    ${storageSection}
    ${backupsSection}
    ${actions({ label: 'Ouvrir le tableau de bord', href: dashboardUrl }, { label: 'Voir les alertes', href: `${dashboardUrl}/alerts` }, 34)}`;

  const html = renderLayout({
    title,
    preheader: `${fleetAvailability === null ? '' : `Disponibilité ${percent(fleetAvailability)} · `}${plural(alerts.total, 'alerte', 'alertes')} · ${verdict}`,
    context: workspaceName,
    hero: {
      icon: points.length === 0 ? '&#10003;' : '&#9650;',
      tone: points.length === 0 ? 'ok' : 'warn',
      eyebrow: `Rapport hebdomadaire · ${period}`,
      title,
      lede: `${greeting(recipientName)} voici le résumé de la semaine écoulée. ${escapeHtml(verdict)}`,
    },
    body,
    footer: `Envoyé chaque lundi à <span style="color:${tokens.muted};">${escapeHtml(recipient)}</span>, propriétaire de «&nbsp;${escapeHtml(workspaceName)}&nbsp;».`,
    links: [{ label: 'Ne plus recevoir ce rapport', href: settingsUrl }],
    frontendUrl,
  });

  const text = textLines([
    `${title} — ${period}`,
    '',
    verdict,
    ...points.map((point) => `• ${point}`),
    '',
    fleetAvailability === null ? '' : `Disponibilité moyenne : ${percent(fleetAvailability)}`,
    ...nodes.map((node) => `  - ${node.name} : ${node.availability === null ? 'pas encore mesurée' : percent(node.availability)}${node.online ? '' : ' (hors ligne)'}`),
    `Alertes : ${alerts.total} déclenchée(s), ${alerts.open} ouverte(s)`,
    ...storage.map((disk) => `  - ${disk.nodeName} : ${gb(disk.usedGb)} / ${gb(disk.capacityGb)}`),
    runs > 0 ? `Sauvegardes : ${runs - failedRuns}/${runs} réussies` : '',
    '',
    `Tableau de bord : ${dashboardUrl}`,
  ]);

  return { subject: `[Tarmac] Rapport hebdomadaire · ${workspaceName} · ${points.length === 0 ? 'tout est au vert' : plural(points.length, 'point à surveiller', 'points à surveiller')}`, html, text };
}
