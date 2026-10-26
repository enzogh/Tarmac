import type { RenderedMail } from '../mail.service';
import {
  button,
  detailRow,
  escapeHtml,
  eyebrow,
  formatDay,
  greeting,
  heading,
  iconTile,
  lede,
  note,
  panel,
  pill,
  renderLayout,
  sectionTitle,
  steps,
  textLines,
  tokens,
} from './layout';

export interface WorkspaceInvitationInput {
  // 'invited': no Tarmac account yet - the membership is created at their
  //            first sign-in with this address.
  // 'added':   an existing account was added straight away.
  kind: 'invited' | 'added';
  recipient: string;
  recipientName?: string | null;
  workspaceName: string;
  workspaceSlug: string;
  roleLabel: string;
  roleDescription: string;
  invitedBy?: string | null;
  expiresAt?: Date | null;
  frontendUrl: string;
}

export function renderWorkspaceInvitation(input: WorkspaceInvitationInput): RenderedMail {
  const { kind, recipient, recipientName, workspaceName, workspaceSlug, roleLabel, roleDescription, invitedBy, expiresAt, frontendUrl } = input;
  const invited = kind === 'invited';
  const name = escapeHtml(workspaceName);
  const by = invitedBy ? escapeHtml(invitedBy) : null;

  const title = invited ? `Rejoignez « ${workspaceName} » sur Tarmac` : `Vous avez accès à « ${workspaceName} »`;
  const subject = invited
    ? `[Tarmac] ${invitedBy ?? 'Un administrateur'} vous invite sur « ${workspaceName} »`
    : `[Tarmac] Vous avez été ajouté à « ${workspaceName} »`;
  const intro = invited
    ? `${greeting(recipientName)} ${by ? `<strong style="color:${tokens.foreground};">${by}</strong> vous invite` : 'Vous êtes invité'} à rejoindre le workspace «&nbsp;${name}&nbsp;» sur Tarmac, la console qui supervise ses serveurs, son stockage et son réseau.`
    : `${greeting(recipientName)} ${by ? `<strong style="color:${tokens.foreground};">${by}</strong> vous a ajouté` : 'Vous avez été ajouté'} au workspace «&nbsp;${name}&nbsp;». Il apparaît déjà dans la liste de vos workspaces.`;

  const actionUrl = invited ? `${frontendUrl}/login` : `${frontendUrl}/${encodeURIComponent(workspaceSlug)}/dashboard`;

  const rows = [
    detailRow('Workspace', `<strong style="font-weight:600;">${name}</strong>`, true),
    detailRow('Votre rôle', `${pill(roleLabel, 'primary')}<div style="padding-top:6px;font-size:13px;line-height:19px;color:${tokens.muted};">${escapeHtml(roleDescription)}</div>`, false),
    by ? detailRow(invited ? 'Invité par' : 'Ajouté par', by, false) : '',
    invited && expiresAt ? detailRow('Valable jusqu’au', escapeHtml(formatDay(expiresAt)), false) : '',
  ].join('');

  const nextSteps = invited
    ? steps([
        'Cliquez sur <strong>Rejoindre le workspace</strong> ci-dessous.',
        `Connectez-vous avec votre compte d'entreprise (SSO), en utilisant l'adresse <span style="font-family:${tokens.fontMono};font-size:13px;">${escapeHtml(recipient)}</span>.`,
        `«&nbsp;${name}&nbsp;» vous attend dans <strong>Mes workspaces</strong> : il suffit de l'ouvrir.`,
      ])
    : steps([
        'Ouvrez Tarmac et connectez-vous comme d’habitude.',
        `Choisissez «&nbsp;${name}&nbsp;» dans <strong>Mes workspaces</strong>, ou utilisez le bouton ci-dessous.`,
      ]);

  const body = `
    ${iconTile(invited ? '&#9993;' : '&#10003;', invited ? 'primary' : 'ok')}
    ${eyebrow(invited ? 'Invitation' : 'Nouvel accès', invited ? 'primary' : 'ok')}
    ${heading(title)}
    ${lede(intro)}
    ${panel(rows)}
    ${sectionTitle('Pour commencer')}
    ${nextSteps}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;"><tr><td>${button(invited ? 'Rejoindre le workspace' : `Ouvrir ${workspaceName}`, actionUrl)}</td></tr></table>
    ${
      invited
        ? note("La connexion est refusée ? Votre compte doit faire partie du groupe d'accès Tarmac : demandez-le à la personne qui vous a invité ou à votre administrateur.", 'warn')
        : ''
    }`;

  const footer = invited
    ? `Envoyé à <span style="color:${tokens.muted};">${escapeHtml(recipient)}</span>. Vous ne vous attendiez pas à cette invitation ? Ignorez simplement cet email : sans connexion de votre part, elle expire d'elle-même.`
    : `Envoyé à <span style="color:${tokens.muted};">${escapeHtml(recipient)}</span> parce que votre compte vient d'être ajouté à «&nbsp;${name}&nbsp;».`;

  const html = renderLayout({
    title,
    preheader: invited ? `Votre rôle : ${roleLabel}. Connectez-vous avec ${recipient} pour rejoindre le workspace.` : `Votre rôle : ${roleLabel}.`,
    context: workspaceName,
    accent: invited ? 'primary' : 'ok',
    body,
    footer,
  });

  const text = textLines([
    title,
    '',
    invited
      ? `${invitedBy ?? 'Un administrateur'} vous invite à rejoindre le workspace « ${workspaceName} » sur Tarmac.`
      : `${invitedBy ?? 'Un administrateur'} vous a ajouté au workspace « ${workspaceName} ».`,
    `Votre rôle : ${roleLabel} — ${roleDescription}`,
    invited && expiresAt ? `Invitation valable jusqu'au ${formatDay(expiresAt)}.` : '',
    '',
    invited ? `Connectez-vous avec ${recipient} : ${actionUrl}` : `Ouvrir le workspace : ${actionUrl}`,
  ]);

  return { subject, html, text };
}
