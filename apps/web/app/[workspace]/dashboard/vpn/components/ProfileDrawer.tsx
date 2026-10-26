'use client';

import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, Clock, Download, Globe2, Pencil, Power, RotateCcw, Server, ShieldCheck, Trash2, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/Callout';
import { CopyButton } from '@/components/ui/copy-button';
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { StatusDot, StatusPill } from '@/components/ui/status';
import type { VpnGateway, VpnProfile } from '@/lib/api';
import { formatBytes, formatDateTime, formatRelative, formatThroughput } from '@/lib/format';
import { meshSummary, peerSummary, reachableBy } from './access';
import { ExitSwitcher } from './ExitSwitcher';
import type { ProfileAction } from './ProfileTable';
import { isLiveConnected } from './ProfileTable';
import { RouteDiagram } from './RouteDiagram';
import { endpointIp, LiveSession, MODE_LABEL, profileStatus } from './vpn-ui';

function Field({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs text-muted-foreground">{label}</dt>
      <dd className={mono ? 'truncate font-mono text-xs text-foreground' : 'truncate text-sm text-foreground'}>{children}</dd>
    </div>
  );
}

function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>
      {action}
    </div>
  );
}

export function ProfileDrawer({
  profile,
  profiles,
  gateways,
  live,
  switchingTo,
  flash,
  onOpenChange,
  onSwitchExit,
  onAction,
  onOpenProfile,
}: {
  profile: VpnProfile | null;
  profiles: VpnProfile[];
  gateways: VpnGateway[];
  live?: LiveSession;
  switchingTo: string | null;
  flash?: string | null;
  onOpenChange: (open: boolean) => void;
  onSwitchExit: (exitNodeId: string | null) => void;
  onAction: (action: ProfileAction) => void;
  onOpenProfile: (profile: VpnProfile) => void;
}) {
  if (!profile) return <Sheet open={false} onOpenChange={onOpenChange}>{null}</Sheet>;

  const status = profileStatus(profile);
  const connected = isLiveConnected(profile, live);
  const lastHandshakeAt = live?.lastHandshakeAt ?? profile.session.lastHandshakeAt;
  const endpoint = live?.endpoint ?? profile.session.endpoint;
  const usable = profile.deployment.status !== 'disabled' && profile.deployment.status !== 'expired';
  const nodeNames = new Map(gateways.map((gateway) => [gateway.id, gateway.name]));
  const profileNames = new Map(profiles.map((item) => [item.id, item.name]));
  const reachers = reachableBy(profile, profiles);
  const peers =
    profile.access.peers === 'selected' ? profiles.filter((item) => profile.access.peerProfileIds.includes(item.id)) : [];
  const meshNodes =
    profile.access.mesh === 'selected' ? gateways.filter((gateway) => profile.access.meshNodeIds.includes(gateway.id)) : [];

  const chipList = (items: Array<{ id: string; name: string; onClick?: () => void }>) => (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {items.slice(0, 12).map((item) =>
        item.onClick ? (
          <button key={item.id} type="button" onClick={item.onClick} className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-2xs text-foreground hover:border-primary/40">
            {item.name}
          </button>
        ) : (
          <span key={item.id} className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-2xs text-foreground">
            {item.name}
          </span>
        ),
      )}
      {items.length > 12 && <span className="px-1 text-2xs text-muted-foreground">+{items.length - 12}</span>}
    </div>
  );

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined}>
        <SheetHeader>
          <div className="flex flex-wrap items-center gap-2">
            <SheetTitle className="truncate">{profile.name}</SheetTitle>
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
            <Badge variant="secondary">{MODE_LABEL[profile.mode].short}</Badge>
          </div>
          <SheetDescription>
            {profile.description || 'Aucune description'} · créé {formatRelative(profile.createdAt)}
          </SheetDescription>
          {profile.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {profile.tags.map((tag) => (
                <span key={tag} className="rounded bg-surface-3 px-1.5 py-px text-2xs text-muted-foreground">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </SheetHeader>

        <SheetBody className="space-y-6">
          {status.hint && <Callout variant={status.tone === 'danger' ? 'danger' : 'warning'}>{status.hint}</Callout>}
          {profile.deployment.warning && <Callout variant="warning">{profile.deployment.warning}</Callout>}

          <section>
            <SectionTitle>Trajet</SectionTitle>
            <RouteDiagram entry={profile.entryNode} exit={profile.exitNode} deviceDetail={endpointIp(endpoint) ?? profile.clientIp} active={connected && usable} />
            {profile.mode === 'full' && usable && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <ExitSwitcher profile={profile} gateways={gateways} switchingTo={switchingTo} onSwitch={onSwitchExit} />
                {flash && (
                  <span className="inline-flex animate-fade-in items-center gap-1.5 text-xs text-[hsl(var(--ok))]">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {flash}
                  </span>
                )}
              </div>
            )}
          </section>

          <section>
            <SectionTitle>Session</SectionTitle>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border bg-surface-2/40 p-3">
              <Field label="Dernière activité">
                <span className="inline-flex items-center gap-1.5" title={formatDateTime(lastHandshakeAt)}>
                  {connected && <StatusDot tone="ok" pulse />}
                  {lastHandshakeAt ? formatRelative(lastHandshakeAt) : 'Jamais connecté'}
                </span>
              </Field>
              <Field label="Débit actuel">
                {live && connected ? (
                  <span className="inline-flex items-center gap-2 tabular-nums">
                    <span className="inline-flex items-center gap-0.5">
                      <ArrowDown className="h-3 w-3 text-muted-foreground" />
                      {formatThroughput(live.txRate)}
                    </span>
                    <span className="inline-flex items-center gap-0.5">
                      <ArrowUp className="h-3 w-3 text-muted-foreground" />
                      {formatThroughput(live.rxRate)}
                    </span>
                  </span>
                ) : (
                  '—'
                )}
              </Field>
              {/* rx/tx are counted from the node's side. */}
              <Field label="Volume de la session">
                ↓ {formatBytes(live?.txBytes ?? profile.session.txBytes)} · ↑ {formatBytes(live?.rxBytes ?? profile.session.rxBytes)}
              </Field>
              <Field label="IP publique de l'appareil" mono>
                {endpointIp(endpoint) ?? '—'}
              </Field>
            </dl>
          </section>

          <section>
            <SectionTitle
              action={
                <button type="button" onClick={() => onAction('access')} className="text-xs font-medium text-primary hover:underline">
                  Modifier
                </button>
              }
            >
              Accès autorisés
            </SectionTitle>
            <ul className="divide-y divide-border rounded-lg border border-border">
              <li className="flex items-start gap-3 px-3 py-2.5">
                <Globe2 className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">Internet</p>
                  <p className="text-xs text-muted-foreground">
                    {profile.mode === 'full' ? `Oui, sortie par ${profile.exitNode?.name ?? profile.entryNode.name}` : 'Non transporté par le VPN'}
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3 px-3 py-2.5">
                <Server className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">Serveurs du réseau privé</p>
                  <p className="text-xs text-muted-foreground">{meshSummary(profile.access, nodeNames)}</p>
                  {meshNodes.length > 0 && chipList(meshNodes.map((node) => ({ id: node.id, name: node.name })))}
                </div>
              </li>
              <li className="flex items-start gap-3 px-3 py-2.5">
                <Users className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">Peut joindre</p>
                  <p className="text-xs text-muted-foreground">{peerSummary(profile.access, profileNames)}</p>
                  {peers.length > 0 && chipList(peers.map((peer) => ({ id: peer.id, name: peer.name, onClick: () => onOpenProfile(peer) })))}
                </div>
              </li>
              <li className="flex items-start gap-3 px-3 py-2.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">Joignable par</p>
                  <p className="text-xs text-muted-foreground">
                    {reachers.length === 0 ? 'Aucun autre profil' : `${reachers.length} profil${reachers.length > 1 ? 's' : ''}`}
                  </p>
                  {reachers.length > 0 && chipList(reachers.map((peer) => ({ id: peer.id, name: peer.name, onClick: () => onOpenProfile(peer) })))}
                </div>
              </li>
            </ul>
          </section>

          <section>
            <SectionTitle>Configuration</SectionTitle>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Field label="Adresse VPN" mono>
                {profile.clientIp}
              </Field>
              <Field label="DNS" mono>
                {profile.dns.length > 0 ? profile.dns.join(', ') : 'DNS de l’appareil'}
              </Field>
              <Field label="Expiration">
                {profile.expiresAt ? (
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDateTime(profile.expiresAt)}
                  </span>
                ) : (
                  'Jamais'
                )}
              </Field>
              <Field label="Sortie changée">{profile.exitSwitchedAt ? formatRelative(profile.exitSwitchedAt) : '—'}</Field>
              <div className="col-span-2 min-w-0">
                <dt className="text-2xs text-muted-foreground">Clé publique</dt>
                <dd className="flex items-center gap-1">
                  <span className="truncate font-mono text-xs text-foreground">{profile.clientPublicKey}</span>
                  <CopyButton value={profile.clientPublicKey} iconOnly />
                </dd>
              </div>
            </dl>
          </section>
        </SheetBody>

        <SheetFooter>
          <Button onClick={() => onAction('install')} disabled={!usable} className="gap-1.5">
            <Download className="h-4 w-4" />
            Installer
          </Button>
          <Button variant="secondary" onClick={() => onAction('edit')} className="gap-1.5">
            <Pencil className="h-4 w-4" />
            Modifier
          </Button>
          <Button variant="secondary" onClick={() => onAction('toggle')} className="gap-1.5">
            <Power className="h-4 w-4" />
            {profile.enabled ? 'Désactiver' : 'Réactiver'}
          </Button>
          <span className="flex-1" />
          <Button variant="ghost" size="icon" onClick={() => onAction('rotate')} title="Régénérer les clés" aria-label="Régénérer les clés">
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onAction('delete')}
            title="Supprimer"
            aria-label="Supprimer"
            className="text-[hsl(var(--danger))]"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
