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
    "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
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
  return `<span style="${style}display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;line-height:16px;font-weight:600;letter-spacing:0.02em;white-space:nowrap;">${escapeHtml(label)}</span>`;
}

// Violet call to action. The gradient is the app's primary button; clients
// that drop background-image (Outlook) keep the flat bgcolor.
export function button(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
  <td bgcolor="${tokens.primary}" style="border-radius:10px;background-color:${tokens.primary};background-image:linear-gradient(180deg,#9a72ff 0%,${tokens.primary} 100%);border:1px solid #9a72ff;">
    <a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:13px 24px;font-family:${tokens.fontSans};font-size:14px;line-height:18px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px;">${escapeHtml(label)}&nbsp;&nbsp;&rarr;</a>
  </td>
</tr></table>`;
}

// Main action of an email, an optional quieter second link next to it, and
// the raw URL underneath for clients (or people) that won't click buttons.
export function actions(primary: { label: string; href: string }, secondary?: { label: string; href: string }, marginTop = 30): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:${marginTop}px;"><tr>
    <td class="stack" valign="middle" style="padding:0 16px 0 0;">${button(primary.label, primary.href)}</td>
    ${
      secondary
        ? `<td class="stack stack-gap" valign="middle" align="right" style="font-size:13px;line-height:18px;"><a href="${escapeHtml(secondary.href)}" target="_blank" style="color:${tokens.primarySoft};text-decoration:none;font-weight:500;">${escapeHtml(secondary.label)}&nbsp;&rsaquo;</a></td>`
        : ''
    }
  </tr></table>
  <p style="margin:14px 0 0;font-size:11px;line-height:16px;color:${tokens.faint};word-break:break-all;">Le bouton ne fonctionne pas ? Copiez ce lien&nbsp;: <a href="${escapeHtml(primary.href)}" style="color:${tokens.muted};text-decoration:underline;">${escapeHtml(primary.href)}</a></p>`;
}

// Small tinted badge above the title ("● INVITATION").
export function eyebrow(label: string, tone: Tone): string {
  const t = tones[tone];
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;"><tr>
    <td style="background-color:${t.tint};border:1px solid ${t.line};border-radius:999px;padding:3px 11px 3px 9px;font-size:11px;line-height:16px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:${t.color};white-space:nowrap;"><span style="font-size:8px;vertical-align:1px;">&#9679;</span>&nbsp;&nbsp;${escapeHtml(label)}</td>
  </tr></table>`;
}

// Display title of every email, under the eyebrow.
export function heading(text: string): string {
  return `<h1 class="h1" style="margin:0 0 12px;font-size:28px;line-height:34px;font-weight:700;letter-spacing:-0.025em;color:${tokens.foreground};">${escapeHtml(text)}</h1>`;
}

// Intro paragraph under the title. Takes HTML: callers escape what they insert.
export function lede(html: string, marginBottom = 0): string {
  return `<p style="margin:0 0 ${marginBottom}px;font-size:15px;line-height:24px;color:${tokens.muted};">${html}</p>`;
}

// Small section title inside the card, e.g. "Disponibilité".
export function sectionTitle(text: string, aside = ''): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:32px 0 12px;"><tr>
    <td style="font-size:12px;line-height:18px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${tokens.muted};">${escapeHtml(text)}</td>
    ${aside ? `<td align="right" style="font-size:12px;line-height:18px;color:${tokens.faint};">${aside}</td>` : ''}
  </tr></table>`;
}

// Rounded tile with a glyph, at the top of the hero. U+FE0E asks for the
// text rendering of the glyph, so iOS doesn't swap in a colour emoji.
export function iconTile(glyph: string, tone: Tone): string {
  const t = tones[tone];
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;"><tr>
    <td width="52" height="52" align="center" valign="middle" bgcolor="${t.tint}" style="width:52px;height:52px;border-radius:14px;background-color:${t.tint};border:1px solid ${t.line};font-size:24px;line-height:24px;font-weight:700;color:${t.color};">${glyph}&#xFE0E;</td>
  </tr></table>`;
}

// Surface-2 box every list or table sits in.
export function panel(rows: string, marginBottom = 0): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${tokens.surface2}" style="background-color:${tokens.surface2};border:1px solid ${tokens.border};border-radius:12px;border-collapse:separate;${marginBottom ? `margin-bottom:${marginBottom}px;` : ''}">${rows}</table>`;
}

// Label / value line of a panel. Both sides are HTML.
export function detailRow(label: string, value: string, first: boolean): string {
  const border = first ? '' : `border-top:1px solid ${tokens.border};`;
  return `<tr>
    <td class="stack detail-label" valign="top" style="${border}padding:14px 20px;width:36%;font-size:13px;line-height:20px;color:${tokens.muted};">${label}</td>
    <td class="stack detail-value" valign="top" style="${border}padding:14px 20px;font-size:14px;line-height:20px;font-weight:500;color:${tokens.foreground};word-break:break-word;">${value}</td>
  </tr>`;
}

// Numbered "what happens next" list, so nobody wonders what to do. Drawn as
// a timeline: each number sits on a faint rail down to the next.
export function steps(items: string[]): string {
  const rows = items
    .map((item, index) => {
      const last = index === items.length - 1;
      return `<tr>
      <td valign="top" width="40" style="width:40px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="26" height="26" align="center" valign="middle" bgcolor="${tones.primary.tint}" style="width:26px;height:26px;border-radius:999px;background-color:${tones.primary.tint};border:1px solid ${tones.primary.line};font-size:12px;line-height:12px;font-weight:700;color:${tokens.primarySoft};">${index + 1}</td></tr></table>
        ${last ? '' : `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="13" style="width:13px;border-right:1px solid ${tokens.border};height:14px;line-height:14px;font-size:0;">&nbsp;</td></tr></table>`}
      </td>
      <td valign="top" style="padding:3px 0 ${last ? 0 : 14}px;font-size:14px;line-height:21px;color:${tokens.foreground};">${item}</td>
    </tr>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table>`;
}

// Quiet aside under the main content (a tip, a "not expected?" note).
export function note(html: string, tone: Tone = 'info'): string {
  const t = tones[tone];
  const glyph = tone === 'warn' || tone === 'danger' ? '!' : 'i';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:26px;background-color:${t.tint};border:1px solid ${t.line};border-radius:12px;"><tr>
    <td valign="top" width="44" style="width:44px;padding:14px 0 14px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td width="20" height="20" align="center" valign="middle" style="width:20px;height:20px;border-radius:999px;border:1.5px solid ${t.color};font-size:11px;line-height:11px;font-weight:700;color:${t.color};font-family:Georgia,serif;">${glyph}</td></tr></table>
    </td>
    <td valign="top" style="padding:14px 18px 14px 4px;font-size:13px;line-height:20px;color:${tokens.foreground};">${html}</td>
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
export function kpiStrip(cells: { value: string; label: string; tone?: Tone | 'muted' }[], marginBottom = 8): string {
  const width = Math.floor(100 / cells.length);
  const tds = cells
    .map((cell, index) => {
      const color = cell.tone === 'muted' ? tokens.faint : cell.tone ? tones[cell.tone].color : tokens.foreground;
      const divider = index > 0 ? `border-left:1px solid ${tokens.border};` : '';
      return `<td class="kpi" width="${width}%" align="left" valign="top" style="${divider}padding:16px 18px;">
      <div style="font-size:11px;line-height:16px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${tokens.muted};">${escapeHtml(cell.label)}</div>
      <div style="padding-top:6px;font-size:24px;line-height:28px;font-weight:700;letter-spacing:-0.02em;color:${color};font-variant-numeric:tabular-nums;white-space:nowrap;">${escapeHtml(cell.value)}</div>
    </td>`;
    })
    .join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${tokens.surface2}" style="background-color:${tokens.surface2};border:1px solid ${tokens.border};border-radius:12px;border-collapse:separate;margin:0 0 ${marginBottom}px;"><tr>${tds}</tr></table>`;
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

interface HeroOptions {
  // HTML entity of the glyph in the icon tile; no tile when left out.
  icon?: string;
  tone: Tone;
  eyebrow: string;
  title: string;
  // Intro under the title. HTML: callers escape what they insert.
  lede: string;
}

interface LayoutOptions {
  title: string;
  // Inbox preview line - hidden in the body, shown next to the subject.
  preheader: string;
  // Workspace the email is about, shown as a chip in the header.
  context?: string;
  hero: HeroOptions;
  body: string;
  // Who it was sent to and why, as HTML.
  footer: string;
  // Quiet links at the bottom ("Gérer mes notifications"...).
  links?: { label: string; href: string }[];
  frontendUrl?: string;
}

// Card header: the email's tone glows faintly from the top-left corner into
// the card surface, behind the icon, badge, title and intro. Clients without
// gradient support simply show the flat surface.
function renderHero({ icon, tone, eyebrow: label, title, lede: intro }: HeroOptions): string {
  const t = tones[tone];
  return `<tr><td class="px hero" bgcolor="${tokens.surface1}" style="padding:38px 40px 34px;background-color:${tokens.surface1};background-image:radial-gradient(ellipse at 0% 0%,${t.tint} 0%,${tokens.surface1} 70%);border-radius:16px 16px 0 0;">
    ${icon ? iconTile(icon, tone) : ''}
    ${eyebrow(label, tone)}
    ${heading(title)}
    ${lede(intro)}
  </td></tr>`;
}

// The frame every Tarmac email shares: page wash, header with the mark and
// the workspace, one flat card (depth from surface steps and borders, never
// a shadow - same rule as the app) opening on a hero, and a structured
// footer. Table-based and inline-styled because that is the only layout
// every mail client agrees on.
export function renderLayout(options: LayoutOptions): string {
  const { title, preheader, context, hero, body, footer, links = [], frontendUrl } = options;
  const accent = tones[hero.tone].color;
  const footerLinks = [...(frontendUrl ? [{ label: 'Ouvrir Tarmac', href: frontendUrl }] : []), ...links]
    .map((link) => `<a href="${escapeHtml(link.href)}" target="_blank" style="color:${tokens.muted};text-decoration:none;font-weight:500;">${escapeHtml(link.label)}</a>`)
    .join(`<span style="color:${tokens.border};">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>`);
  return `<!doctype html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(title)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: dark; supported-color-schemes: dark; }
  body { margin: 0; padding: 0; width: 100% !important; background-color: ${tokens.background}; -webkit-font-smoothing: antialiased; }
  a { color: ${tokens.primarySoft}; }
  @media (max-width: 620px) {
    .px { padding-left: 22px !important; padding-right: 22px !important; }
    .hero { padding-top: 30px !important; padding-bottom: 28px !important; }
    .stack { display: block !important; width: 100% !important; box-sizing: border-box !important; text-align: left !important; padding-right: 0 !important; }
    .stack-gap { padding-top: 16px !important; }
    .hide-sm { display: none !important; }
    .h1 { font-size: 23px !important; line-height: 29px !important; }
    .detail-label { padding-bottom: 2px !important; }
    .detail-value { padding-top: 0 !important; border-top: 0 !important; }
    .kpi { display: inline-block !important; width: 50% !important; box-sizing: border-box !important; border-left: 0 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:${tokens.background};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">${escapeHtml(preheader)}${'&nbsp;&zwnj;'.repeat(60)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${tokens.background}" style="background-color:${tokens.background};background-image:radial-gradient(ellipse at 50% 0%,#1a1430 0%,${tokens.background} 55%);">
<tr><td align="center" style="padding:36px 12px 44px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;font-family:${tokens.fontSans};color:${tokens.foreground};">
    <tr><td style="padding:0 4px 20px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="middle" style="width:34px;"><img src="cid:${TARMAC_MARK_CID}" width="32" height="32" alt="Tarmac" style="display:block;width:32px;height:32px;border:0;border-radius:9px;"></td>
        <td valign="middle" style="padding-left:11px;font-size:17px;line-height:20px;font-weight:700;letter-spacing:-0.02em;color:${tokens.foreground};">Tarmac</td>
        ${
          context
            ? `<td valign="middle" align="right"><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right"><tr><td style="background-color:${tokens.surface2};border:1px solid ${tokens.border};border-radius:999px;padding:5px 12px 5px 10px;font-size:12px;line-height:16px;font-weight:500;color:${tokens.foreground};white-space:nowrap;"><span style="color:${accent};font-size:8px;vertical-align:1px;">&#9679;</span>&nbsp;&nbsp;${escapeHtml(context)}</td></tr></table></td>`
            : ''
        }
      </tr></table>
    </td></tr>
    <tr><td bgcolor="${tokens.surface1}" style="background-color:${tokens.surface1};border:1px solid ${tokens.border};border-top:2px solid ${accent};border-radius:16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${renderHero(hero)}
        <tr><td class="px" style="padding:0 40px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" style="height:1px;line-height:1px;font-size:0;background-color:${tokens.border};">&nbsp;</td></tr></table></td></tr>
        <tr><td class="px" style="padding:30px 40px 38px;">${body}</td></tr>
      </table>
    </td></tr>
    <tr><td class="px" style="padding:26px 8px 0;">
      ${footerLinks ? `<p style="margin:0 0 12px;font-size:12px;line-height:18px;">${footerLinks}</p>` : ''}
      <p style="margin:0;font-size:12px;line-height:19px;color:${tokens.faint};">${footer}</p>
    </td></tr>
    <tr><td class="px" style="padding:22px 8px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
        <td valign="middle" style="width:18px;"><img src="cid:${TARMAC_MARK_CID}" width="16" height="16" alt="" style="display:block;width:16px;height:16px;border:0;border-radius:4px;opacity:0.6;"></td>
        <td valign="middle" style="padding-left:8px;font-size:11px;line-height:16px;color:${tokens.faint};">Tarmac &middot; supervision et orchestration de votre flotte de serveurs</td>
      </tr></table>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}
