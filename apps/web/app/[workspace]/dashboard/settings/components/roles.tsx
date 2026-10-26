'use client';

import { Crown, Eye, Pencil, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import type { ApiKeyScope, WorkspaceRole } from '@/lib/api';
import {
  API_KEY_RESOURCES,
  fullPermissions,
  PermissionMap,
  permissionsToScopes,
  presetOf,
  readOnlyPermissions,
  scopesToPermissions,
} from '@/lib/api-key-permissions';
import { cn } from '@/lib/utils';
import { PermissionEditor } from '../../api-keys/components/PermissionEditor';

// What people pick from. "admin" is the owner role; the three others are
// members whose permissions are full, read-only or hand-picked.
export type RoleChoice = 'admin' | 'editor' | 'viewer' | 'custom';

export const ROLE_INFO: Record<RoleChoice, { label: string; description: string; icon: LucideIcon; badge: string }> = {
  admin: {
    label: 'Administrateur',
    description: 'Tout, plus les paramètres, les membres et les clés API.',
    icon: Crown,
    badge: 'border-primary/30 bg-primary/10 text-primary',
  },
  editor: {
    label: 'Éditeur',
    description: 'Consulte et modifie toutes les pages.',
    icon: Pencil,
    badge: 'border-[hsl(var(--ok))]/25 bg-[hsl(var(--ok))]/10 text-[hsl(var(--ok))]',
  },
  viewer: {
    label: 'Lecteur',
    description: 'Consulte tout, sans rien modifier.',
    icon: Eye,
    badge: 'border-[hsl(var(--info))]/25 bg-[hsl(var(--info))]/10 text-[hsl(var(--info))]',
  },
  custom: {
    label: 'Personnalisé',
    description: 'Choisir l’accès page par page.',
    icon: SlidersHorizontal,
    badge: 'border-[hsl(var(--warn))]/25 bg-[hsl(var(--warn))]/10 text-[hsl(var(--warn))]',
  },
};

export type MemberAccessDraft = { admin: boolean; permissions: PermissionMap; custom: boolean };

export function roleOf(role: WorkspaceRole, scopes: readonly ApiKeyScope[]): RoleChoice {
  if (role === 'owner') return 'admin';
  const preset = presetOf(scopesToPermissions(scopes));
  return preset === 'full' ? 'editor' : preset === 'read' ? 'viewer' : 'custom';
}

export function draftFrom(role: WorkspaceRole, scopes: readonly ApiKeyScope[]): MemberAccessDraft {
  const choice = roleOf(role, scopes);
  return { admin: choice === 'admin', permissions: scopesToPermissions(scopes), custom: choice === 'custom' };
}

export function choiceOf(draft: MemberAccessDraft): RoleChoice {
  if (draft.admin) return 'admin';
  if (draft.custom) return 'custom';
  const preset = presetOf(draft.permissions);
  return preset === 'full' ? 'editor' : preset === 'read' ? 'viewer' : 'custom';
}

export function draftToAccess(draft: MemberAccessDraft): { role: WorkspaceRole; permissions: ApiKeyScope[] } {
  return draft.admin
    ? { role: 'owner', permissions: permissionsToScopes(fullPermissions()) }
    : { role: 'member', permissions: permissionsToScopes(draft.permissions) };
}

export function RoleBadge({ choice, className }: { choice: RoleChoice; className?: string }) {
  const info = ROLE_INFO[choice];
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-2xs font-medium', info.badge, className)}>
      <info.icon className="h-3 w-3" />
      {info.label}
    </span>
  );
}

/**
 * One icon per page area: filled when the member can change it, outlined
 * for read-only, faded when out of reach. Reads as a fingerprint of the
 * role at a glance; the tooltip spells it out.
 */
export function AccessStrip({ role, scopes, className }: { role: WorkspaceRole; scopes: readonly ApiKeyScope[]; className?: string }) {
  const permissions = role === 'owner' ? fullPermissions() : scopesToPermissions(scopes);
  return (
    <span className={cn('inline-flex items-center gap-0.5', className)}>
      {API_KEY_RESOURCES.map((resource) => {
        const level = permissions[resource.id];
        const Icon = resource.icon;
        return (
          <span
            key={resource.id}
            title={`${resource.label} : ${level === 'write' ? 'modification' : level === 'read' ? 'lecture seule' : 'aucun accès'}`}
            className={cn(
              'flex h-5 w-5 items-center justify-center rounded',
              level === 'write' && 'bg-primary/15 text-primary',
              level === 'read' && 'text-foreground/70 ring-1 ring-inset ring-border',
              level === 'none' && 'text-muted-foreground/30',
            )}
          >
            <Icon className="h-3 w-3" />
          </span>
        );
      })}
    </span>
  );
}

export function RoleEditor({ value, onChange }: { value: MemberAccessDraft; onChange: (next: MemberAccessDraft) => void }) {
  const choice = choiceOf(value);
  const pick = (next: RoleChoice) => {
    if (next === 'admin') onChange({ ...value, admin: true, custom: false });
    if (next === 'editor') onChange({ admin: false, custom: false, permissions: fullPermissions() });
    if (next === 'viewer') onChange({ admin: false, custom: false, permissions: readOnlyPermissions() });
    if (next === 'custom') onChange({ admin: false, custom: true, permissions: value.admin ? fullPermissions() : value.permissions });
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Rôle">
        {(Object.keys(ROLE_INFO) as RoleChoice[]).map((id) => {
          const info = ROLE_INFO[id];
          const active = choice === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => pick(id)}
              className={cn(
                'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active ? 'border-primary/60 bg-primary/[0.07] ring-1 ring-primary/30' : 'border-border bg-surface-2 hover:border-primary/30',
              )}
            >
              <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md', active ? 'bg-primary/15 text-primary' : 'bg-surface-3 text-muted-foreground')}>
                <info.icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{info.label}</span>
                <span className="block text-2xs leading-relaxed text-muted-foreground">{info.description}</span>
              </span>
            </button>
          );
        })}
      </div>

      {choice === 'custom' ? (
        <PermissionEditor
          value={value.permissions}
          onChange={(permissions) => onChange({ admin: false, custom: true, permissions })}
          hidePresets
          showIds={false}
          footnote="La modification inclut la lecture. Une page sans accès disparaît du menu. Les paramètres, les membres et les clés API restent réservés aux administrateurs."
        />
      ) : (
        <p className="rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-2xs leading-relaxed text-muted-foreground">
          {choice === 'admin'
            ? 'Accès complet à toutes les pages, et gestion du workspace : nom et adresse, membres et rôles, clés API, suppression.'
            : choice === 'editor'
              ? 'Peut tout consulter et tout modifier (nœuds, stockage, réseau, DNS, VPN, alertes), sans gérer le workspace ni ses membres.'
              : 'Voit toutes les pages et leurs données, mais aucun bouton d’action ne fonctionnera pour lui. Idéal pour un client ou un auditeur.'}
        </p>
      )}
    </div>
  );
}
