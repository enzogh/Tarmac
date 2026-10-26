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
  panel,
  renderLayout,
  sectionTitle,
  steps,
  textLines,
  tokens,
} from './layout';

export interface OwnershipTransferInput {
  recipient: string;
  recipientName?: string | null;
  workspaceName: string;
  workspaceSlug: string;
  previousOwner?: string | null;
  transferredBy?: string | null;
  frontendUrl: string;
}

export function renderOwnershipTransfer(input: OwnershipTransferInput): RenderedMail {
  const { recipient, recipientName, workspaceName, workspaceSlug, previousOwner, transferredBy, frontendUrl } = input;
  const name = escapeHtml(workspaceName);
  const title = `Vous êtes propriétaire de « ${workspaceName} »`;
  const settingsUrl = `${frontendUrl}/${encodeURIComponent(workspaceSlug)}/dashboard/settings`;

  const rows = [
    detailRow('Workspace', `<strong style="font-weight:600;">${name}</strong>`, true),
    previousOwner ? detailRow('Ancien propriétaire', escapeHtml(previousOwner), false) : '',
    transferredBy && transferredBy !== previousOwner ? detailRow('Transfert fait par', escapeHtml(transferredBy), false) : '',
    detailRow('Date', escapeHtml(formatDateTime(new Date())), false),
  ].join('');

  const body = `
    ${iconTile('&#9733;', 'primary')}
    ${eyebrow('Transfert de propriété', 'primary')}
    ${heading(title)}
    ${lede(`${greeting(recipientName)} la propriété du workspace «&nbsp;${name}&nbsp;» vous a été transférée. Vous en êtes désormais le responsable principal.`)}
    ${panel(rows)}
    ${sectionTitle('Ce qui change pour vous')}
    ${steps([
      'Vous êtes administrateur : membres, rôles, clés API et paramètres sont entre vos mains.',
      'Ce workspace compte désormais dans votre propre limite de création.',
      'Le rapport hebdomadaire du lundi matin vous est maintenant adressé.',
    ])}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;"><tr><td>${button('Ouvrir les paramètres', settingsUrl)}</td></tr></table>`;

  const html = renderLayout({
    title,
    preheader: `${previousOwner ?? 'Un administrateur'} vous a confié le workspace ${workspaceName}.`,
    context: workspaceName,
    accent: 'primary',
    body,
    footer: `Envoyé à <span style="color:${tokens.muted};">${escapeHtml(recipient)}</span>, nouveau propriétaire de «&nbsp;${name}&nbsp;».`,
  });

  const text = textLines([
    title,
    '',
    `La propriété du workspace « ${workspaceName} » vous a été transférée${previousOwner ? ` par ${previousOwner}` : ''}.`,
    'Vous êtes administrateur, il compte dans votre limite de création et le rapport hebdomadaire vous est adressé.',
    '',
    `Paramètres : ${settingsUrl}`,
  ]);

  return { subject: `[Tarmac] Vous êtes propriétaire de « ${workspaceName} »`, html, text };
}
