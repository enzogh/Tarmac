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
  </table>
</td></tr>
</table>
</body>
</html>`;
}
