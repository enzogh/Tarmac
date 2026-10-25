'use client';

import { useState } from 'react';
import { ArrowLeft, ArrowRight, Globe, MoreHorizontal, RefreshCcw, ScrollText, ShieldCheck, Trash2 } from 'lucide-react';
import { api, DnsServerGroupItem, DnsZoneItem, NodeItem } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatusDot, StatusPill } from '@/components/ui/status';
import { Tabs, TabsCount, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { zoneHealth } from './dns-ui';
import { DnssecPanel } from './DnssecPanel';
import { NameserversPanel } from './NameserversPanel';
import { RecordsPanel } from './RecordsPanel';
import { DnsJournalState } from './useDnsPageState';
import { ZoneJournal } from './ZoneJournal';

export type ZoneView = 'records' | 'nameservers' | 'dnssec' | 'journal';

/** One domain's dashboard: records first, setup and diagnostics one tab away. */
export function ZoneDetail({
  zone,
  group,
  nodes,
  journal,
  view,
  onViewChange,
  onBack,
  onChanged,
  onDeleted,
  onNotice,
}: {
  zone: DnsZoneItem;
  group: DnsServerGroupItem | undefined;
  nodes: NodeItem[];
  journal: DnsJournalState;
  view: ZoneView;
  onViewChange: (view: ZoneView) => void;
  onBack: () => void;
  onChanged: () => Promise<unknown>;
  onDeleted: (message: string) => void;
  onNotice: (notice: { type: 'success' | 'error'; message: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const health = zoneHealth(zone);
  const nodeName = (id: string) => nodes.find((node) => node.id === id)?.name ?? id;

  const reapply = async () => {
    setBusy(true);
    try {
      await api.dns.zones.reapply(zone.id);
      onNotice({ type: 'success', message: `Réapplication de ${zone.name} demandée aux serveurs DNS.` });
      await onChanged();
    } catch {
      onNotice({ type: 'error', message: 'La réapplication a échoué.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const typed = window.prompt(
      `Supprimer ${zone.name} et ses ${zone.records.length} enregistrement(s) ?\nLe domaine cessera de répondre.\n\nTapez le nom du domaine pour confirmer :`,
    );
    if (typed?.trim().toLowerCase() !== zone.name) return;
    setBusy(true);
    try {
      await api.dns.zones.delete(zone.id);
      onDeleted(`Domaine ${zone.name} supprimé.`);
    } catch {
      onNotice({ type: 'error', message: 'La suppression du domaine a échoué.' });
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Tous les domaines
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-2">
              <Globe className="h-5 w-5 text-muted-foreground" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-lg font-semibold tracking-tight text-foreground">{zone.name}</h2>
                <StatusPill tone={health.tone}>{health.label}</StatusPill>
                {zone.dnssecEnabled && (
                  <span className="inline-flex items-center gap-1 text-2xs text-[hsl(var(--ok))]">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    DNSSEC
                  </span>
                )}
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>Servi par {group?.name ?? '—'}</span>
                {group?.members.map((member) => (
                  <span key={member.nodeId} className="inline-flex items-center gap-1.5">
                    <StatusDot tone={member.status === 'active' ? 'ok' : member.status === 'error' ? 'danger' : 'warn'} />
                    {nodeName(member.nodeId)}
                    <span className="text-muted-foreground/60">{member.role === 'primary' ? 'primaire' : 'secondaire'}</span>
                  </span>
                ))}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => void reapply()} disabled={busy} className="gap-1.5">
              <RefreshCcw className={cn('h-3.5 w-3.5', busy && 'animate-spin')} />
              Réappliquer
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Plus d'actions">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onSelect={() => onViewChange('journal')} className="gap-2">
                  <ScrollText className="h-3.5 w-3.5" />
                  Voir le journal
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => void remove()} className="gap-2 text-[hsl(var(--danger))]">
                  <Trash2 className="h-3.5 w-3.5" />
                  Supprimer le domaine
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* The one thing still to do, said where it can't be missed - the
          equivalent of Cloudflare's "complete your nameserver setup". */}
      {health.key === 'awaiting-ns' && view !== 'nameservers' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[hsl(var(--warn))]/30 bg-[hsl(var(--warn))]/[0.06] px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">Terminez la configuration de {zone.name}</p>
            <p className="text-xs text-muted-foreground">
              Vos enregistrements sont prêts, mais Internet interroge encore les anciens serveurs DNS du domaine.
            </p>
          </div>
          <Button size="sm" onClick={() => onViewChange('nameservers')} className="gap-1.5">
            Configurer les nameservers
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
      {health.key === 'error' && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[hsl(var(--danger))]/30 bg-[hsl(var(--danger))]/[0.06] px-4 py-3">
          <div>
            <p className="text-sm font-medium text-foreground">La zone n&apos;a pas pu être appliquée</p>
            <p className="text-xs text-muted-foreground">Le journal des serveurs indique la cause ; réappliquez une fois corrigé.</p>
          </div>
          <Button size="sm" variant="secondary" onClick={() => onViewChange('journal')} className="gap-1.5">
            <ScrollText className="h-3.5 w-3.5" />
            Ouvrir le journal
          </Button>
        </div>
      )}

      <Tabs value={view} onValueChange={(value) => onViewChange(value as ZoneView)}>
        <TabsList>
          <TabsTrigger value="records" className="gap-1.5">
            Enregistrements <TabsCount>{zone.records.length}</TabsCount>
          </TabsTrigger>
          <TabsTrigger value="nameservers" className="gap-1.5">
            Nameservers
            {!zone.delegationVerified && <StatusDot tone="warn" />}
          </TabsTrigger>
          <TabsTrigger value="dnssec">DNSSEC</TabsTrigger>
          <TabsTrigger value="journal">Journal</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="animate-fade-in" key={view}>
        {view === 'records' && <RecordsPanel zone={zone} nodes={nodes} onChanged={onChanged} onNotice={onNotice} />}
        {view === 'nameservers' && <NameserversPanel zone={zone} />}
        {view === 'dnssec' && <DnssecPanel zone={zone} />}
        {view === 'journal' && <ZoneJournal zone={zone} group={group} nodes={nodes} journal={journal} />}
      </div>
    </div>
  );
}
