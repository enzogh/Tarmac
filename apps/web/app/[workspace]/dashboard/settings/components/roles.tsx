'use client';

import type { ReactNode } from 'react';
import { Crown, Eye, Pencil, SlidersHorizontal, Tag, type LucideIcon } from 'lucide-react';
import type { ApiKeyScope, WorkspaceCustomRole, WorkspaceRole } from '@/lib/api';
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
// members whose permissions are full, read-only or hand-picked. "role" is a
// named role defined by the workspace (WorkspaceCustomRole).
export type RoleChoice = 'admin' | 'editor' | 'viewer' | 'custom' | 'role';
type BuiltInChoice = Exclude<RoleChoice, 'role'>;
const BUILT_IN: BuiltInChoice[] = ['admin', 'editor', 'viewer', 'custom'];

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
  role: {
    label: 'Rôle du workspace',
    description: 'Un rôle défini par les administrateurs de ce workspace.',
    icon: Tag,
    badge: 'border-[hsl(var(--chart-5))]/30 bg-[hsl(var(--chart-5))]/10 text-[hsl(var(--chart-5))]',
  },
};

export type MemberAccessDraft = { admin: boolean; permissions: PermissionMap; custom: boolean; customRoleId?: string | null };

export function roleOf(role: WorkspaceRole, scopes: readonly ApiKeyScope[], customRoleId?: string | null): RoleChoice {
  if (role === 'owner') return 'admin';
  if (customRoleId) return 'role';
  const preset = presetOf(scopesToPermissions(scopes));
  return preset === 'full' ? 'editor' : preset === 'read' ? 'viewer' : 'custom';
}

export function draftFrom(role: WorkspaceRole, scopes: readonly ApiKeyScope[], customRoleId?: string | null): MemberAccessDraft {
  const choice = roleOf(role, scopes, customRoleId);
  return { admin: choice === 'admin', permissions: scopesToPermissions(scopes), custom: choice === 'custom', customRoleId: choice === 'role' ? customRoleId : null };
}

export function choiceOf(draft: MemberAccessDraft): RoleChoice {
  if (draft.admin) return 'admin';
  if (draft.customRoleId) return 'role';
  if (draft.custom) return 'custom';
  const preset = presetOf(draft.permissions);
  return preset === 'full' ? 'editor' : preset === 'read' ? 'viewer' : 'custom';
}

export function draftToAccess(draft: MemberAccessDraft): { role: WorkspaceRole; permissions: ApiKeyScope[]; customRoleId: string | null } {
  return draft.admin
    ? { role: 'owner', permissions: permissionsToScopes(fullPermissions()), customRoleId: null }
    : { role: 'member', permissions: permissionsToScopes(draft.permissions), customRoleId: draft.customRoleId ?? null };
}

/** `name` labels a workspace role (choice "role") with its own name. */
export function RoleBadge({ choice, name, className }: { choice: RoleChoice; name?: string | null; className?: string }) {
  const info = ROLE_INFO[choice];
  return (
    <span className={cn('inline-flex max-w-[12rem] items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-2xs font-medium', info.badge, className)}>
      <info.icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{choice === 'role' && name ? name : info.label}</span>
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

function RoleCard({ active, icon: Icon, label, description, aside, onClick }: { active: boolean; icon: LucideIcon; label: string; description: string; aside?: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'border-primary/60 bg-primary/[0.07] ring-1 ring-primary/30' : 'border-border bg-surface-2 hover:border-primary/30',
      )}
    >
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md', active ? 'bg-primary/15 text-primary' : 'bg-surface-3 text-muted-foreground')}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{label}</span>
        <span className="line-clamp-2 block text-2xs leading-relaxed text-muted-foreground">{description}</span>
        {aside}
      </span>
    </button>
  );
}

export function RoleEditor({
  value,
  onChange,
  customRoles = [],
}: {
  value: MemberAccessDraft;
  onChange: (next: MemberAccessDraft) => void;
  customRoles?: WorkspaceCustomRole[];
}) {
  const choice = choiceOf(value);
  const pick = (next: BuiltInChoice) => {
    if (next === 'admin') onChange({ ...value, admin: true, custom: false, customRoleId: null });
    if (next === 'editor') onChange({ admin: false, custom: false, permissions: fullPermissions(), customRoleId: null });
    if (next === 'viewer') onChange({ admin: false, custom: false, permissions: readOnlyPermissions(), customRoleId: null });
    if (next === 'custom') onChange({ admin: false, custom: true, permissions: value.admin ? fullPermissions() : value.permissions, customRoleId: null });
  };
  const pickRole = (role: WorkspaceCustomRole) =>
    onChange({ admin: false, custom: false, permissions: scopesToPermissions(role.permissions), customRoleId: role.id });
  const selectedRole = customRoles.find((role) => role.id === value.customRoleId) ?? null;

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Rôle">
        {BUILT_IN.map((id) => (
          <RoleCard key={id} active={choice === id} icon={ROLE_INFO[id].icon} label={ROLE_INFO[id].label} description={ROLE_INFO[id].description} onClick={() => pick(id)} />
        ))}
      </div>

      {customRoles.length > 0 && (
        <div className="space-y-2">
          <p className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground/70">Rôles de ce workspace</p>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Rôles du workspace">
            {customRoles.map((role) => (
              <RoleCard
                key={role.id}
                active={value.customRoleId === role.id}
                icon={Tag}
                label={role.name}
                description={role.description || 'Rôle défini par les administrateurs.'}
                aside={<AccessStrip role="member" scopes={role.permissions} className="mt-1.5" />}
                onClick={() => pickRole(role)}
              />
            ))}
          </div>
        </div>
      )}

      {choice === 'role' ? (
        <p className="rounded-lg border border-border bg-surface-2/50 px-3 py-2 text-2xs leading-relaxed text-muted-foreground">
          Suit le rôle « {selectedRole?.name ?? 'du workspace'} » : si ses droits changent, ceux de cette personne suivent automatiquement.
        </p>
      ) : choice === 'custom' ? (
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
