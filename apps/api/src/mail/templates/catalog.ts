import type { RenderedMail } from '../mail.service';
import { renderAlertDigest } from './alert-digest';
import { renderNotificationAddress } from './notification-address';
import { renderOwnershipTransfer } from './ownership-transfer';
import { renderWeeklyReport } from './weekly-report';
import { renderWorkspaceInvitation } from './workspace-invitation';

export interface EmailPreviewContext {
  frontendUrl: string;
  recipient: string;
  recipientName: string | null;
  internalDomain: string;
}

export interface EmailTemplateEntry {
  id: string;
  name: string;
  // When it goes out and to whom, in plain words for the admin page.
  trigger: string;
  audience: string;
  render: (context: EmailPreviewContext) => RenderedMail;
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000);
const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

// Every email Tarmac sends, rendered with realistic sample data: what the
// platform admin page previews and can send as a test.
export const EMAIL_TEMPLATES: EmailTemplateEntry[] = [
  {
    id: 'alert-digest',
    name: 'Alertes groupées',
    trigger: 'Quand plusieurs alertes se déclenchent ensemble, une fois la rafale terminée.',
    audience: 'Membres ayant accès aux alertes, et canaux email du workspace',
    render: ({ frontendUrl, recipient }) =>
      renderAlertDigest({
        workspaceName: 'Production',
        workspaceSlug: 'production',
        recipient,
        frontendUrl,
        alerts: [
          { message: 'Le nœud ne répond plus depuis 3 minutes', severity: 'critical', triggeredAt: minutesAgo(4), nodeName: 'nas-paris-01' },
          { message: 'Utilisation disque à 92 % sur /srv/data', severity: 'high', triggeredAt: minutesAgo(3), nodeName: 'vps-backup' },
          { message: 'Utilisation disque à 92 % sur /srv/data', severity: 'high', triggeredAt: minutesAgo(2), nodeName: 'vps-backup' },
          { message: 'Lien VLAN hors ligne : nas-paris-01 ↔ vps-lyon-02', severity: 'medium', triggeredAt: minutesAgo(2), nodeName: null },
        ],
      }),
  },
  {
    id: 'alert-single',
    name: 'Alerte unique',
    trigger: 'Quand une seule alerte se déclenche.',
    audience: 'Membres ayant accès aux alertes, et canaux email du workspace',
    render: ({ frontendUrl, recipient }) =>
      renderAlertDigest({
        workspaceName: 'Production',
        workspaceSlug: 'production',
        recipient,
        frontendUrl,
        alerts: [{ message: 'Charge CPU au-dessus de 90 % depuis 10 minutes', severity: 'medium', triggeredAt: minutesAgo(1), nodeName: 'vps-lyon-02' }],
      }),
  },
  {
    id: 'invitation',
    name: 'Invitation dans un workspace',
    trigger: 'Quand un administrateur invite une adresse qui ne s’est encore jamais connectée.',
    audience: 'La personne invitée',
    render: ({ frontendUrl, recipient, recipientName }) =>
      renderWorkspaceInvitation({
        kind: 'invited',
        recipient,
        recipientName: null,
        workspaceName: 'Production',
        workspaceSlug: 'production',
        roleLabel: 'Éditeur',
        roleDescription: 'Consulte et modifie toutes les pages, sans gérer le workspace ni ses membres.',
        invitedBy: recipientName ?? 'Camille Martin',
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
        frontendUrl,
      }),
  },
  {
    id: 'member-added',
    name: 'Ajout à un workspace',
    trigger: 'Quand un compte existant est ajouté à un workspace, ou qu’une invitation est acceptée.',
    audience: 'La personne ajoutée',
    render: ({ frontendUrl, recipient, recipientName }) =>
      renderWorkspaceInvitation({
        kind: 'added',
        recipient,
        recipientName,
        workspaceName: 'Production',
        workspaceSlug: 'production',
        roleLabel: 'Lecteur',
        roleDescription: 'Consulte toutes les pages, sans rien modifier.',
        invitedBy: 'Camille Martin',
        frontendUrl,
      }),
  },
  {
    id: 'ownership-transfer',
    name: 'Transfert de propriété',
    trigger: 'Quand la propriété d’un workspace est transférée.',
    audience: 'Le nouveau propriétaire',
    render: ({ frontendUrl, recipient, recipientName }) =>
      renderOwnershipTransfer({
        recipient,
        recipientName,
        workspaceName: 'Production',
        workspaceSlug: 'production',
        previousOwner: 'Camille Martin',
        transferredBy: 'Camille Martin',
        frontendUrl,
      }),
  },
  {
    id: 'weekly-report',
    name: 'Rapport hebdomadaire',
    trigger: 'Chaque lundi à 8 h, pour chaque workspace qui a des nœuds (désactivable dans ses paramètres).',
    audience: 'Le propriétaire du workspace',
    render: ({ frontendUrl, recipient, recipientName }) =>
      renderWeeklyReport({
        recipient,
        recipientName,
        workspaceName: 'Production',
        workspaceSlug: 'production',
        frontendUrl,
        periodStart: daysAgo(7),
        periodEnd: daysAgo(1),
        nodes: [
          { name: 'nas-paris-01', availability: 0.9987, online: true },
          { name: 'vps-lyon-02', availability: 1, online: true },
          { name: 'vps-backup', availability: 0.962, online: true },
          { name: 'edge-marseille', availability: 0.912, online: false },
        ],
        alerts: {
          total: 14,
          open: 2,
          bySeverity: { critical: 1, high: 4, medium: 7, low: 2 },
          top: [
            { message: 'Le nœud ne répond plus depuis 3 minutes', nodeName: 'edge-marseille', severity: 'critical', count: 1 },
            { message: 'Utilisation disque à 92 % sur /srv/data', nodeName: 'vps-backup', severity: 'high', count: 4 },
            { message: 'Charge CPU au-dessus de 90 % depuis 10 minutes', nodeName: 'vps-lyon-02', severity: 'medium', count: 6 },
          ],
        },
        storage: [
          { nodeName: 'vps-backup', usedGb: 1840, capacityGb: 2000, growthGb: 64, daysToFull: 17.5 },
          { nodeName: 'nas-paris-01', usedGb: 5320, capacityGb: 8000, growthGb: 120, daysToFull: 156 },
          { nodeName: 'vps-lyon-02', usedGb: 38, capacityGb: 160, growthGb: 0, daysToFull: null },
        ],
        backups: [
          { jobName: 'Photos → NAS', succeeded: 7, failed: 0, lastStatus: 'success' },
          { jobName: 'Base clients → vps-backup', succeeded: 12, failed: 2, lastStatus: 'failed' },
        ],
      }),
  },
  {
    id: 'notification-enabled',
    name: 'Adresse d’alerte confirmée',
    trigger: 'À la première connexion, ou quand l’adresse qui reçoit les alertes change.',
    audience: 'La personne connectée',
    render: ({ frontendUrl, recipient, recipientName, internalDomain }) =>
      renderNotificationAddress({ kind: 'enabled', recipient, recipientName, source: 'internal', internalDomain, frontendUrl }),
  },
  {
    id: 'notification-test',
    name: 'Email de test',
    trigger: 'Quand quelqu’un clique sur « Envoyer un test » dans ses notifications ou un canal email.',
    audience: 'La personne qui teste, ou l’adresse du canal',
    render: ({ frontendUrl, recipient, recipientName, internalDomain }) =>
      renderNotificationAddress({ kind: 'test', recipient, recipientName, source: 'internal', internalDomain, frontendUrl }),
  },
];
