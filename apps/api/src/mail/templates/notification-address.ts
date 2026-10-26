import type { RenderedMail } from '../mail.service';
import {
  button,
  detailRow,
  escapeHtml,
  eyebrow,
  formatDateTime,
  greeting,
  heading,
  iconTile,
  lede,
  note,
  panel,
  pill,
  renderLayout,
  textLines,
  tokens,
} from './layout';

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

export function renderNotificationAddress(input: NotificationAddressInput): RenderedMail {
  const { kind, recipient, recipientName, source, internalDomain, frontendUrl, workspaceName, workspaceSlug } = input;
  const hello = greeting(recipientName);

  const title = kind === 'test' ? 'Les emails arrivent bien' : 'Vos alertes arriveront ici';
  const subject = kind === 'test' ? '[Tarmac] Email de test' : '[Tarmac] Vos alertes seront envoyées à cette adresse';
  const intro =
    kind === 'test'
      ? `${hello} ceci est un message de test envoyé depuis Tarmac. Vous le lisez : l'envoi fonctionne, et les prochaines alertes arriveront au même endroit.`
      : `${hello} Tarmac vous enverra désormais ses alertes à cette adresse. Votre boîte ne sera pas inondée : quand plusieurs alertes se déclenchent en même temps, elles sont réunies dans un seul email.`;

  const sourceLabel =
    source === 'internal'
      ? `${pill('Interne', 'primary')}&nbsp;&nbsp;<span style="color:${tokens.muted};">adresse @${escapeHtml(internalDomain)} de votre compte</span>`
      : source === 'channel'
        ? `${pill('Canal', 'info')}&nbsp;&nbsp;<span style="color:${tokens.muted};">canal de notification du workspace</span>`
        : `${pill('Compte', 'warn')}&nbsp;&nbsp;<span style="color:${tokens.muted};">pas d'adresse @${escapeHtml(internalDomain)}, adresse de connexion utilisée</span>`;

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

  const tip =
    kind === 'test'
      ? "Rien reçu dans la boîte principale ? Regardez dans les spams et marquez l'expéditeur comme fiable : les vraies alertes passeront ensuite directement."
      : `Pour changer d'adresse ou couper ces emails, ouvrez <strong style="color:${tokens.foreground};">Paramètres → Notifications</strong> dans n'importe quel workspace.`;

  const body = `
    ${iconTile('&#10003;', 'ok')}
    ${eyebrow(kind === 'test' ? 'Test de notification' : 'Notifications activées', 'ok')}
    ${heading(title)}
    ${lede(escapeHtml(intro))}
    ${panel(rows)}
    ${note(tip)}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;"><tr><td>${button('Ouvrir Tarmac', settingsUrl)}</td></tr></table>`;

  const footer =
    source === 'channel'
      ? `Envoyé à <span style="color:${tokens.muted};">${escapeHtml(recipient)}</span>, configurée comme canal de notification${workspaceName ? ` de «&nbsp;${escapeHtml(workspaceName)}&nbsp;»` : ''}.`
      : `Envoyé à <span style="color:${tokens.muted};">${escapeHtml(recipient)}</span>. L'adresse est relue à chaque connexion : une adresse @${escapeHtml(internalDomain)} sur votre compte passe toujours en priorité.<br><a href="${escapeHtml(settingsUrl)}" style="color:${tokens.muted};text-decoration:underline;">Gérer mes notifications</a>`;

  const html = renderLayout({
    title,
    preheader: kind === 'test' ? "L'envoi d'emails de Tarmac fonctionne." : `Les alertes Tarmac arriveront sur ${recipient}.`,
    context: workspaceName ?? undefined,
    accent: 'ok',
    body,
    footer,
  });

  const text = textLines([
    title,
    '',
    intro,
    '',
    `Destinataire : ${recipient}`,
    workspaceName ? `Workspace : ${workspaceName}` : '',
    '',
    `Ouvrir Tarmac : ${settingsUrl}`,
  ]);

  return { subject, html, text };
}
