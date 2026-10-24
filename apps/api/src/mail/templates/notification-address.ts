import type { RenderedMail } from '../mail.service';
import { button, escapeHtml, eyebrow, formatDateTime, pill, renderLayout, tokens, tones } from './layout';

export interface NotificationAddressInput {
  // 'enabled': first SSO login (or the address changed) - says where alerts
  //            will land from now on.
  // 'test':    someone pressed "Envoyer un test" in the app.
  kind: 'enabled' | 'test';
  recipient: string;
  recipientName?: string | null;
  // Whether `recipient` is the internal (@intraced.fr) address or the
  // account's sign-up address used as a fallback.
  source: 'internal' | 'account' | 'channel';
  internalDomain: string;
  frontendUrl: string;
  workspaceName?: string | null;
  workspaceSlug?: string | null;
}

function detailRow(label: string, value: string, first: boolean): string {
  const border = first ? '' : `border-top:1px solid ${tokens.border};`;
  return `<tr>
    <td class="stack detail-label" valign="top" style="${border}padding:13px 18px;width:38%;font-size:12px;line-height:20px;font-weight:500;letter-spacing:0.04em;text-transform:uppercase;color:${tokens.muted};">${label}</td>
    <td class="stack detail-value" valign="top" style="${border}padding:13px 18px;font-size:14px;line-height:20px;color:${tokens.foreground};word-break:break-word;">${value}</td>
  </tr>`;
}

export function renderNotificationAddress(input: NotificationAddressInput): RenderedMail {
  const { kind, recipient, recipientName, source, internalDomain, frontendUrl, workspaceName, workspaceSlug } = input;
  const firstName = recipientName?.trim().split(/\s+/)[0];
  const greeting = firstName ? `Bonjour ${firstName},` : 'Bonjour,';

  const title = kind === 'test' ? 'Les emails arrivent bien' : 'Tes alertes arrivent ici';
  const subject = kind === 'test' ? '[Tarmac] Email de test' : '[Tarmac] Les alertes te seront envoyées à cette adresse';
  const lede =
    kind === 'test'
      ? `${greeting} ceci est un message de test envoyé depuis Tarmac. S'il est dans ta boîte de réception, le relais SMTP interne fonctionne et les prochaines alertes arriveront au même endroit.`
      : `${greeting} Tarmac t'enverra désormais ses alertes à cette adresse. Pas d'inquiétude pour ta boîte : quand plusieurs alertes se déclenchent en même temps, elles sont réunies dans un seul email.`;

  const sourceLabel =
    source === 'internal'
      ? `${pill('Interne', 'primary')}&nbsp;&nbsp;<span style="color:${tokens.muted};">adresse @${escapeHtml(internalDomain)} de ton compte</span>`
      : source === 'channel'
        ? `${pill('Canal', 'info')}&nbsp;&nbsp;<span style="color:${tokens.muted};">canal de notification du workspace</span>`
        : `${pill('Compte', 'warn')}&nbsp;&nbsp;<span style="color:${tokens.muted};">aucune adresse @${escapeHtml(internalDomain)} trouvée, adresse d'inscription utilisée</span>`;

  const settingsUrl = workspaceSlug
    ? `${frontendUrl}/${encodeURIComponent(workspaceSlug)}/dashboard/settings`
    : `${frontendUrl}/workspaces`;

  const rows = [
    detailRow('Destinataire', `<span style="font-family:${tokens.fontMono};font-size:13px;">${escapeHtml(recipient)}</span>`, true),
    detailRow('Origine', sourceLabel, false),
    detailRow('Regroupement', 'Les alertes simultanées partent ensemble, en un seul message', false),
    workspaceName ? detailRow('Workspace', escapeHtml(workspaceName), false) : '',
    detailRow('Envoyé le', escapeHtml(formatDateTime(new Date())), false),
  ].join('');

  const check = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 22px;"><tr>
    <td width="44" height="44" align="center" valign="middle" bgcolor="${tones.ok.tint}" style="width:44px;height:44px;border-radius:12px;background-color:${tones.ok.tint};border:1px solid ${tones.ok.line};font-size:20px;line-height:20px;font-weight:700;color:${tones.ok.color};">&#10003;</td>
  </tr></table>`;

  const body = `
    ${check}
    ${eyebrow(kind === 'test' ? 'Test de notification' : 'Notifications activées', 'ok')}
    <h1 class="h1" style="margin:0 0 10px;font-size:26px;line-height:32px;font-weight:600;letter-spacing:-0.02em;color:${tokens.foreground};">${title}</h1>
    <p style="margin:0 0 26px;font-size:14px;line-height:22px;color:${tokens.muted};">${escapeHtml(lede)}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${tokens.surface2}" style="background-color:${tokens.surface2};border:1px solid ${tokens.border};border-radius:10px;">${rows}</table>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;"><tr><td>${button('Ouvrir Tarmac', settingsUrl)}</td></tr></table>`;

  const footer =
    source === 'channel'
      ? `Envoyé à <span style="color:${tokens.muted};">${escapeHtml(recipient)}</span>, configurée comme canal de notification${workspaceName ? ` de «&nbsp;${escapeHtml(workspaceName)}&nbsp;»` : ''}.`
      : `Envoyé à <span style="color:${tokens.muted};">${escapeHtml(recipient)}</span>. L'adresse est relue à chaque connexion : une adresse @${escapeHtml(internalDomain)} sur ton compte passe toujours en priorité.<br><a href="${escapeHtml(settingsUrl)}" style="color:${tokens.muted};text-decoration:underline;">Gérer les notifications</a>`;

  const html = renderLayout({
    title,
    preheader: kind === 'test' ? 'Le relais SMTP de Tarmac fonctionne.' : `Les alertes Tarmac arriveront sur ${recipient}.`,
    context: workspaceName ?? undefined,
    accent: 'ok',
    body,
    footer,
  });

  const text = [
    title,
    '',
    lede,
    '',
    `Destinataire : ${recipient}`,
    workspaceName ? `Workspace : ${workspaceName}` : '',
    '',
    `Ouvrir Tarmac : ${settingsUrl}`,
  ]
    .filter((line, index, lines) => line !== '' || lines[index - 1] !== '')
    .join('\n');

  return { subject, html, text };
}
