'use client';

import type { LucideIcon } from 'lucide-react';
import { Ban, Globe2, Info, Network, Server, ShieldCheck, Users, UsersRound } from 'lucide-react';
import { SelectableList } from '@/components/ui/selectable-list';
import { StatusDot } from '@/components/ui/status';
import type { VpnAccess, VpnAccessScope, VpnGateway, VpnProfile, VpnProfileMode } from '@/lib/api';
import { cn } from '@/lib/utils';
import { NodeFlag } from './vpn-ui';

export const DEFAULT_ACCESS: VpnAccess = { mesh: 'all', meshNodeIds: [], peers: 'none', peerProfileIds: [] };

export function accessPayload(access: VpnAccess) {
  return {
    meshAccess: access.mesh,
    meshNodeIds: access.mesh === 'selected' ? access.meshNodeIds : [],
    peerAccess: access.peers,
    peerProfileIds: access.peers === 'selected' ? access.peerProfileIds : [],
  };
}

export function accessError(access: VpnAccess): string | null {
  if (access.mesh === 'selected' && access.meshNodeIds.length === 0) {
    return 'Choisissez au moins un nœud, ou « Aucun » pour couper l’accès au réseau privé.';
  }
  if (access.peers === 'selected' && access.peerProfileIds.length === 0) {
    return 'Choisissez au moins un profil, ou « Isolé ».';
  }
  return null;
}

export function meshSummary(access: VpnAccess, nodeNames: Map<string, string>): string {
  if (access.mesh === 'all') return 'Tout le réseau';
  if (access.mesh === 'none') return 'Aucun nœud';
  const names = access.meshNodeIds.map((id) => nodeNames.get(id)).filter(Boolean) as string[];
  return names.length === 1 ? names[0] : `${names.length} nœuds`;
}

export function peerSummary(access: VpnAccess, profileNames: Map<string, string>): string {
  if (access.peers === 'all') return 'Tous les profils';
  if (access.peers === 'none') return 'Isolé';
  const names = access.peerProfileIds.map((id) => profileNames.get(id)).filter(Boolean) as string[];
  return names.length === 1 ? names[0] : `${names.length} profils`;
}

/** Profiles that may open connections to `profile`. */
export function reachableBy(profile: VpnProfile, profiles: VpnProfile[]): VpnProfile[] {
  return profiles.filter(
    (other) =>
      other.id !== profile.id &&
      (other.access.peers === 'all' || (other.access.peers === 'selected' && other.access.peerProfileIds.includes(profile.id))),
  );
}

/** Compact "Internet · Réseau · Profils" chips for a table row. */
export function AccessChips({
  profile,
  nodeNames,
  profileNames,
}: {
  profile: VpnProfile;
  nodeNames: Map<string, string>;
  profileNames: Map<string, string>;
}) {
  const chip = (icon: LucideIcon, label: string, tone: 'on' | 'partial' | 'off', title: string) => {
    const Icon = icon;
    return (
      <span
        title={title}
        className={cn(
          'inline-flex max-w-[9rem] items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs',
          tone === 'on' && 'border-[hsl(var(--ok))]/25 bg-[hsl(var(--ok))]/10 text-[hsl(var(--ok))]',
          tone === 'partial' && 'border-[hsl(var(--info))]/25 bg-[hsl(var(--info))]/10 text-[hsl(var(--info))]',
          tone === 'off' && 'border-border bg-surface-2 text-muted-foreground',
        )}
      >
        <Icon className="h-3 w-3 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
    );
  };
  const tone = (scope: VpnAccessScope) => (scope === 'all' ? 'on' : scope === 'selected' ? 'partial' : 'off');
  return (
    <span className="flex flex-wrap items-center gap-1">
      {chip(
        Globe2,
        profile.mode === 'full' ? 'Internet' : 'Pas d’Internet',
        profile.mode === 'full' ? 'on' : 'off',
        profile.mode === 'full' ? 'Navigation Internet via le VPN' : 'Le VPN ne transporte pas la navigation Internet',
      )}
      {chip(Server, meshSummary(profile.access, nodeNames), tone(profile.access.mesh), 'Accès aux serveurs du réseau privé')}
      {chip(Users, peerSummary(profile.access, profileNames), tone(profile.access.peers), 'Accès aux autres appareils VPN')}
    </span>
  );
}

function ScopeOption({
  icon: Icon,
  title,
  description,
  selected,
  recommended,
  onSelect,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  selected: boolean;
  recommended?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors',
        selected ? 'border-primary/60 bg-primary/[0.07] ring-1 ring-primary/30' : 'border-border bg-surface-2 hover:border-primary/30',
      )}
    >
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')} />
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-foreground">
          {title}
          {recommended && (
            <span className="rounded bg-[hsl(var(--ok))]/15 px-1.5 py-px text-2xs font-normal text-[hsl(var(--ok))]">Recommandé</span>
          )}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
    </button>
  );
}

function Section({ icon: Icon, title, hint, children }: { icon: LucideIcon; title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2.5">
      <div>
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </h4>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </section>
  );
}

const NODE_TONE = { online: 'ok', degraded: 'warn', offline: 'danger' } as const;

/**
 * Everything a client may open connections to, in three plain questions:
 * Internet (follows the traffic mode), the fleet's servers, the other VPN
 * devices. Enforced by the entry node; replies to allowed connections
 * always come back.
 */
export function AccessEditor({
  value,
  onChange,
  mode,
  gateways,
  profiles,
  selfId,
}: {
  value: VpnAccess;
  onChange: (next: VpnAccess) => void;
  mode: VpnProfileMode;
  gateways: VpnGateway[];
  profiles: VpnProfile[];
  /** The profile being edited, left out of its own peer list. */
  selfId?: string;
}) {
  const set = (patch: Partial<VpnAccess>) => onChange({ ...value, ...patch });
  const nodeItems = gateways.map((gateway) => ({
    id: gateway.id,
    label: gateway.name,
    detail: gateway.vlanIp ?? 'Pas encore sur le réseau privé',
    icon: (
      <span className="flex items-center gap-1.5">
        <NodeFlag node={gateway} className="text-sm" />
        <StatusDot tone={NODE_TONE[gateway.status]} />
      </span>
    ),
  }));
  const peerItems = profiles
    .filter((profile) => profile.id !== selfId)
    .map((profile) => ({
      id: profile.id,
      label: profile.name,
      detail: `${profile.clientIp} · via ${profile.entryNode.name}`,
      tags: profile.tags,
    }));

  return (
    <div className="space-y-5">
      <Section icon={Globe2} title="Internet" hint="Suit le choix « Trafic » du profil.">
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm">
          {mode === 'full' ? (
            <>
              <StatusDot tone="ok" />
              <span className="text-foreground">Autorisé</span>
              <span className="text-xs text-muted-foreground">— la navigation sort par le nœud de sortie choisi.</span>
            </>
          ) : (
            <>
              <StatusDot tone="neutral" />
              <span className="text-foreground">Non transporté</span>
              <span className="text-xs text-muted-foreground">— l’appareil garde sa connexion Internet habituelle.</span>
            </>
          )}
        </div>
      </Section>

      <Section
        icon={Network}
        title="Serveurs du réseau privé"
        hint="Les nœuds de la flotte que cet appareil peut joindre par leur IP privée (SSH, bases de données, services internes…)."
      >
        <div className="grid gap-2 sm:grid-cols-3">
          <ScopeOption icon={Network} title="Tout le réseau" description="Tous les nœuds, présents et futurs." selected={value.mesh === 'all'} onSelect={() => set({ mesh: 'all' })} />
          <ScopeOption icon={Server} title="Nœuds choisis" description="Uniquement ceux cochés ci-dessous." selected={value.mesh === 'selected'} onSelect={() => set({ mesh: 'selected' })} />
          <ScopeOption icon={Ban} title="Aucun" description="Aucun serveur, pas même le point d’entrée." selected={value.mesh === 'none'} onSelect={() => set({ mesh: 'none' })} />
        </div>
        {value.mesh === 'selected' && (
          <SelectableList
            items={nodeItems}
            selected={value.meshNodeIds}
            onChange={(meshNodeIds) => set({ meshNodeIds })}
            placeholder="Nœud ou IP privée…"
            emptyLabel="Aucun nœud dans ce workspace."
          />
        )}
      </Section>

      <Section
        icon={UsersRound}
        title="Autres appareils VPN"
        hint="Les autres profils que cet appareil peut contacter directement (partage de fichiers, bureau à distance…), même s’ils passent par un autre point d’entrée."
      >
        <div className="grid gap-2 sm:grid-cols-3">
          <ScopeOption icon={ShieldCheck} title="Isolé" description="Aucun autre appareil VPN." recommended selected={value.peers === 'none'} onSelect={() => set({ peers: 'none' })} />
          <ScopeOption icon={Users} title="Profils choisis" description="Uniquement ceux cochés ci-dessous." selected={value.peers === 'selected'} onSelect={() => set({ peers: 'selected' })} />
          <ScopeOption icon={UsersRound} title="Tous les profils" description="Pour un poste d’administration." selected={value.peers === 'all'} onSelect={() => set({ peers: 'all' })} />
        </div>
        {value.peers === 'selected' && (
          <SelectableList
            items={peerItems}
            selected={value.peerProfileIds}
            onChange={(peerProfileIds) => set({ peerProfileIds })}
            placeholder="Profil, libellé ou IP…"
            emptyLabel="Aucun autre profil pour l’instant."
          />
        )}
      </Section>

      <p className="flex gap-2 rounded-lg border border-border bg-surface-2/60 px-3 py-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Ces règles portent sur les connexions <strong className="text-foreground">ouvertes par cet appareil</strong> : les
          réponses reviennent toujours. Pour qu’un autre profil puisse l’appeler lui aussi, autorisez-le dans ce profil-là. Les
          serveurs DNS du profil restent toujours joignables.
        </span>
      </p>
    </div>
  );
}
