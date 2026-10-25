import { Bell, Globe, HardDrive, Network, ScrollText, Server, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { ApiKeyResource, ApiKeyScope } from './api';

export type AccessLevel = 'none' | 'read' | 'write';

export type ApiKeyResourceInfo = {
  id: ApiKeyResource;
  label: string;
  icon: LucideIcon;
  /** Doc modules (by name, see app/docs/api) this permission opens. */
  modules: string[];
  read: string;
  write?: string;
  /** Shown when write is granted: what makes it sensitive. */
  writeWarning?: string;
};

// One entry per permission area a key can be granted, in the order of the
// sidebar. Read/write descriptions say concretely what the key can do, so
// nobody has to cross-reference the API reference to pick a level.
export const API_KEY_RESOURCES: ApiKeyResourceInfo[] = [
  {
    id: 'nodes',
    label: 'Nœuds & agents',
    icon: Server,
    modules: ['Nœuds', 'Agents', 'Topologie'],
    read: 'Lister les nœuds, leurs métriques, l’état SMART des disques et la topologie.',
    write: 'Ajouter, modifier ou supprimer des nœuds, lancer un onboarding, couper les alertes, régénérer les jetons et mettre à jour les agents.',
    writeWarning: 'Peut retirer des nœuds de la flotte et régénérer leurs jetons d’agent.',
  },
  {
    id: 'storage',
    label: 'Stockage',
    icon: HardDrive,
    modules: ['Partages NFS', 'Montages', 'Pools & réplication', 'Migrations', 'Tâches de synchronisation', 'Stockage'],
    read: 'Consulter partages, montages, pools, migrations, tâches de synchronisation et capacité.',
    write: 'Créer et modifier partages, montages et pools, lancer migrations et synchronisations.',
  },
  {
    id: 'network',
    label: 'Réseau privé',
    icon: Network,
    modules: ['Réseau (VLAN)'],
    read: 'Voir les membres du réseau privé, l’état des liens et leur historique.',
    write: 'Lancer des tests de connectivité, ajouter un nœud au réseau, définir les passerelles.',
  },
  {
    id: 'dns',
    label: 'DNS',
    icon: Globe,
    modules: ['DNS'],
    read: 'Lister zones, enregistrements, groupes de serveurs, DNSSEC et état de délégation.',
    write: 'Créer des zones, ajouter, modifier ou supprimer des enregistrements, gérer les groupes et le DNS interne.',
  },
  {
    id: 'vpn',
    label: 'VPN',
    icon: ShieldCheck,
    modules: ['VPN'],
    read: 'Lister les profils, leur état de connexion et les passerelles.',
    write: 'Créer, modifier et supprimer des profils, changer la sortie, télécharger les configurations.',
    writeWarning: 'Les configurations téléchargées contiennent les clés privées des appareils.',
  },
  {
    id: 'alerts',
    label: 'Alertes',
    icon: Bell,
    modules: ['Alertes'],
    read: 'Lister alertes, règles de seuil et canaux de notification.',
    write: 'Acquitter et résoudre des alertes, gérer règles et canaux, envoyer des notifications de test.',
  },
  {
    id: 'logs',
    label: 'Journal',
    icon: ScrollText,
    modules: ['Journal'],
    read: 'Lire et exporter le journal d’actions et les logs des agents.',
  },
];

export const RESOURCE_BY_ID = Object.fromEntries(API_KEY_RESOURCES.map((resource) => [resource.id, resource])) as Record<
  ApiKeyResource,
  ApiKeyResourceInfo
>;

export type PermissionMap = Record<ApiKeyResource, AccessLevel>;

export function maxLevel(resource: ApiKeyResourceInfo): AccessLevel {
  return resource.write ? 'write' : 'read';
}

export function emptyPermissions(): PermissionMap {
  return Object.fromEntries(API_KEY_RESOURCES.map((resource) => [resource.id, 'none'])) as PermissionMap;
}

export function fullPermissions(): PermissionMap {
  return Object.fromEntries(API_KEY_RESOURCES.map((resource) => [resource.id, maxLevel(resource)])) as PermissionMap;
}

export function readOnlyPermissions(): PermissionMap {
  return Object.fromEntries(API_KEY_RESOURCES.map((resource) => [resource.id, 'read'])) as PermissionMap;
}

// Write implies read on the API side, but both are stored so a key's
// scopes read unambiguously in logs and in the API.
export function permissionsToScopes(permissions: PermissionMap): ApiKeyScope[] {
  return API_KEY_RESOURCES.flatMap((resource) => {
    const level = permissions[resource.id];
    if (level === 'none') return [];
    return level === 'write' ? [`${resource.id}:read`, `${resource.id}:write`] : [`${resource.id}:read`];
  }) as ApiKeyScope[];
}

export function scopesToPermissions(scopes: readonly string[]): PermissionMap {
  const permissions = emptyPermissions();
  for (const resource of API_KEY_RESOURCES) {
    if (scopes.includes(`${resource.id}:write`)) permissions[resource.id] = 'write';
    else if (scopes.includes(`${resource.id}:read`)) permissions[resource.id] = 'read';
  }
  return permissions;
}

export type PermissionPreset = 'full' | 'read' | 'custom';

export function presetOf(permissions: PermissionMap): PermissionPreset {
  if (API_KEY_RESOURCES.every((resource) => permissions[resource.id] === maxLevel(resource))) return 'full';
  if (API_KEY_RESOURCES.every((resource) => permissions[resource.id] === 'read')) return 'read';
  return 'custom';
}
