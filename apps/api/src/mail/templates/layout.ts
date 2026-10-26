import { TARMAC_MARK_CID } from './tarmac-mark';

// The web app's design tokens (apps/web/app/globals.css) written out as hex,
// since mail clients can't read CSS variables. Keep the two in step.
export const tokens = {
  background: '#0a0a0b',
  surface1: '#111113',
  surface2: '#18181b',
  surface3: '#222225',
  border: '#29292e',
  foreground: '#fafafa',
  muted: '#acacb4',
  faint: '#6e6e78',
  primary: '#8455f1',
  primarySoft: '#b9a1ff',
  fontSans:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, 'Helvetica Neue', Arial, sans-serif",
  fontMono: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
};

// One hue per meaning, as in the app: `color` is the status token, `tint`
// and `line` are that hue mixed into surface-2 at 14% and 35%, which is how
// the app's StatusPill reads on a dark card (no rgba, Outlook ignores it).
export type Tone = 'danger' | 'warn' | 'info' | 'ok' | 'primary';
export const tones: Record<Tone, { color: string; tint: string; line: string }> = {
  danger: { color: '#f05151', tint: '#362023', line: '#642c2e' },
  warn: { color: '#f6a823', tint: '#372c1c', line: '#664a1e' },
  info: { color: '#35b7f3', tint: '#1c2e39', line: '#225067' },
  ok: { color: '#2ac089', tint: '#1b2f2a', line: '#1e5341' },
  primary: { color: '#8455f1', tint: '#272039', line: '#3e2d66' },
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function pill(label: string, tone: Tone, solid = false): string {
  const t = tones[tone];
  const style = solid
    ? `background-color:${t.color};border:1px solid ${t.color};color:${tokens.background};`
    : `background-color:${t.tint};border:1px solid ${t.line};color:${t.color};`;
  return `<span style="${style}display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;line-height:16px;font-weight:600;letter-spacing:0.02em;white-space:nowrap;">${escapeHtml(label)}</span>`;
}

export function button(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
  <td bgcolor="${tokens.primary}" style="border-radius:8px;">
    <a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:11px 20px;font-family:${tokens.fontSans};font-size:14px;line-height:18px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${escapeHtml(label)}&nbsp;&rarr;</a>
  </td>
</tr></table>`;
}

export function eyebrow(label: string, tone: Tone): string {
  return `<p style="margin:0 0 10px;font-size:11px;line-height:16px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:${tones[tone].color};"><span style="font-size:9px;vertical-align:1px;">&#9679;</span>&nbsp;&nbsp;${escapeHtml(label)}</p>`;
}

// Display title of every email, under the eyebrow.
export function heading(text: string): string {
  return `<h1 class="h1" style="margin:0 0 10px;font-size:26px;line-height:32px;font-weight:600;letter-spacing:-0.02em;color:${tokens.foreground};">${escapeHtml(text)}</h1>`;
}

// Intro paragraph under the title. Takes HTML: callers escape what they insert.
export function lede(html: string, marginBottom = 26): string {
  return `<p style="margin:0 0 ${marginBottom}px;font-size:14px;line-height:22px;color:${tokens.muted};">${html}</p>`;
}

// Small section title inside the card, e.g. "Disponibilité".
export function sectionTitle(text: string, aside = ''): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:30px 0 10px;"><tr>
    <td style="font-size:13px;line-height:18px;font-weight:600;color:${tokens.foreground};">${escapeHtml(text)}</td>
    ${aside ? `<td align="right" style="font-size:12px;line-height:18px;color:${tokens.muted};">${aside}</td>` : ''}
  </tr></table>`;
}

// Rounded tile with a glyph, at the top of transactional emails.
export function iconTile(glyph: string, tone: Tone): string {
  const t = tones[tone];
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;"><tr>
    <td width="44" height="44" align="center" valign="middle" bgcolor="${t.tint}" style="width:44px;height:44px;border-radius:12px;background-color:${t.tint};border:1px solid ${t.line};font-size:20px;line-height:20px;font-weight:700;color:${t.color};">${glyph}</td>
  </tr></table>`;
}

// Surface-2 box every list or table sits in.
export function panel(rows: string, marginBottom = 0): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${tokens.surface2}" style="background-color:${tokens.surface2};border:1px solid ${tokens.border};border-radius:10px;${marginBottom ? `margin-bottom:${marginBottom}px;` : ''}">${rows}</table>`;
}

// Label / value line of a panel. Both sides are HTML.
export function detailRow(label: string, value: string, first: boolean): string {
  const border = first ? '' : `border-top:1px solid ${tokens.border};`;
  return `<tr>
    <td class="stack detail-label" valign="top" style="${border}padding:13px 18px;width:38%;font-size:12px;line-height:20px;font-weight:500;letter-spacing:0.04em;text-transform:uppercase;color:${tokens.muted};">${label}</td>
    <td class="stack detail-value" valign="top" style="${border}padding:13px 18px;font-size:14px;line-height:20px;color:${tokens.foreground};word-break:break-word;">${value}</td>
  </tr>`;
}

// Numbered "what happens next" list, so nobody wonders what to do.
export function steps(items: string[]): string {
  const rows = items
    .map(
      (item, index) => `<tr>
      <td valign="top" width="34" style="padding:${index === 0 ? 0 : 12}px 0 0;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="22" height="22" align="center" valign="middle" bgcolor="${tones.primary.tint}" style="width:22px;height:22px;border-radius:999px;background-color:${tones.primary.tint};border:1px solid ${tones.primary.line};font-size:11px;line-height:11px;font-weight:700;color:${tokens.primarySoft};">${index + 1}</td></tr></table>
      </td>
      <td valign="top" style="padding:${index === 0 ? 1 : 13}px 0 0;font-size:14px;line-height:21px;color:${tokens.foreground};">${item}</td>
    </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`;
}

// Quiet aside under the main content (a tip, a "not expected?" note).
export function note(html: string, tone: Tone = 'info'): string {
  const t = tones[tone];
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;"><tr>
    <td style="border-left:3px solid ${t.color};background-color:${tokens.surface2};padding:12px 16px;border-radius:0 8px 8px 0;font-size:13px;line-height:20px;color:${tokens.muted};">${html}</td>
  </tr></table>`;
}

// Horizontal bar for a ratio (0..1), e.g. availability or disk usage.
export function meter(ratio: number, tone: Tone, width = 120): string {
  const filled = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return `<table role="presentation" width="${width}" cellpadding="0" cellspacing="0" border="0" style="width:${width}px;"><tr>
    ${filled > 0 ? `<td width="${filled}" height="6" bgcolor="${tones[tone].color}" style="width:${filled}px;height:6px;line-height:6px;font-size:0;background-color:${tones[tone].color};border-radius:3px;">&nbsp;</td>` : ''}
    ${filled < width ? `<td width="${width - filled}" height="6" bgcolor="${tokens.surface3}" style="width:${width - filled}px;height:6px;line-height:6px;font-size:0;background-color:${tokens.surface3};border-radius:3px;">&nbsp;</td>` : ''}
  </tr></table>`;
}

// Row of big numbers, each with a label (and an optional tone).
export function kpiStrip(cells: { value: string; label: string; tone?: Tone | 'muted' }[]): string {
  const width = Math.floor(100 / cells.length);
  const tds = cells
    .map((cell, index) => {
      const color = cell.tone === 'muted' ? tokens.faint : cell.tone ? tones[cell.tone].color : tokens.foreground;
      const divider = index > 0 ? `border-left:1px solid ${tokens.border};` : '';
      return `<td class="kpi" width="${width}%" align="left" valign="top" style="${divider}padding:14px 16px;">
      <div style="font-size:22px;line-height:28px;font-weight:600;color:${color};font-variant-numeric:tabular-nums;white-space:nowrap;">${escapeHtml(cell.value)}</div>
      <div style="padding-top:2px;font-size:11px;line-height:16px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;color:${tokens.muted};">${escapeHtml(cell.label)}</div>
    </td>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${tokens.surface2}" style="background-color:${tokens.surface2};border:1px solid ${tokens.border};border-radius:10px;margin:0 0 8px;"><tr>${tds}</tr></table>`;
}

export function firstName(name?: string | null): string | null {
  return name?.trim().split(/\s+/)[0] || null;
}

export function greeting(name?: string | null): string {
  const first = firstName(name);
  return first ? `Bonjour ${escapeHtml(first)},` : 'Bonjour,';
}

// Plain-text part: drops runs of blank lines left by optional lines.
export function textLines(lines: string[]): string {
  return lines.filter((line, index, all) => line !== '' || (index > 0 && all[index - 1] !== '')).join('\n').trim();
}

const timeZone = () => process.env.ALERT_EMAIL_TIMEZONE || 'Europe/Paris';

export function formatTime(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: timeZone(), hour: '2-digit', minute: '2-digit' }).format(date);
}

export function formatDay(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: timeZone(), day: 'numeric', month: 'long' }).format(date);
}

export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: timeZone(),
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

interface LayoutOptions {
  title: string;
  // Inbox preview line - hidden in the body, shown next to the subject.
  preheader: string;
  // Label at the top right of the header, e.g. the workspace name.
  context?: string;
  // Colour of the thin bar across the top of the card.
  accent: Tone;
  body: string;
  footer: string;
}

// The frame every Tarmac email shares: page wash, header with the mark, one
// flat card (depth from surface steps and a border, never a shadow - same
// rule as the app) and a quiet footer. Table-based and inline-styled because
// that is the only layout every mail client agrees on.
export function renderLayout(options: LayoutOptions): string {
  const { title, preheader, context, accent, body, footer } = options;
  return `<!doctype html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; supported-color-schemes: dark; }
  body { margin: 0; padding: 0; width: 100% !important; background-color: ${tokens.background}; }
  a { color: ${tokens.primarySoft}; }
  @media (max-width: 620px) {
    .px { padding-left: 20px !important; padding-right: 20px !important; }
    .stack { display: block !important; width: 100% !important; box-sizing: border-box !important; text-align: left !important; }
    .hide-sm { display: none !important; }
    .h1 { font-size: 22px !important; line-height: 28px !important; }
    .detail-label { padding-bottom: 4px !important; }
    .detail-value { padding-top: 0 !important; border-top: 0 !important; }
    .kpi { display: inline-block !important; width: 50% !important; box-sizing: border-box !important; border-left: 0 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${tokens.background};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}${'&nbsp;&zwnj;'.repeat(60)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${tokens.background}" style="background-color:${tokens.background};">
<tr><td align="center" style="padding:32px 12px 40px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;font-family:${tokens.fontSans};color:${tokens.foreground};">
    <tr><td style="padding:0 4px 18px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="middle" style="width:32px;"><img src="cid:${TARMAC_MARK_CID}" width="28" height="28" alt="" style="display:block;width:28px;height:28px;border:0;border-radius:7px;"></td>
        <td valign="middle" style="padding-left:10px;font-size:16px;line-height:20px;font-weight:600;letter-spacing:-0.01em;color:${tokens.foreground};">Tarmac</td>
        ${context ? `<td valign="middle" align="right" style="font-size:12px;line-height:16px;color:${tokens.muted};">${escapeHtml(context)}</td>` : ''}
      </tr></table>
    </td></tr>
    <tr><td bgcolor="${tokens.surface1}" style="background-color:${tokens.surface1};border:1px solid ${tokens.border};border-radius:14px;overflow:hidden;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr><td height="3" bgcolor="${tones[accent].color}" style="height:3px;line-height:3px;font-size:0;background-color:${tones[accent].color};border-radius:14px 14px 0 0;">&nbsp;</td></tr>
        <tr><td class="px" style="padding:32px 36px 36px;">${body}</td></tr>
      </table>
    </td></tr>
    <tr><td class="px" style="padding:22px 8px 0;font-size:12px;line-height:19px;color:${tokens.faint};">${footer}</td></tr>
    <tr><td class="px" style="padding:18px 8px 0;font-size:11px;line-height:16px;color:${tokens.faint};">Tarmac &middot; supervision et orchestration de votre flotte de serveurs</td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}
