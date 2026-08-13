'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2, RefreshCcw, XCircle } from 'lucide-react';
import { DnsDelegationNameserverResult, DnsZoneItem } from '@/lib/api';
import { Callout } from '@/components/Callout';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

export type DnsInfoPanelState = {
  zone: DnsZoneItem;
  tab: 'delegation' | 'dnssec';
  delegation?: {
    nsHostnames: string[];
    glue: Array<{ host: string; ip: string }>;
    verified: boolean;
    checkedAt: string | null;
    detail: DnsDelegationNameserverResult[] | null;
  };
  dnssec?: { dsRecords: string[]; dnskeyRecords: string[] };
  loading: boolean;
};

// Overall status line above the per-nameserver table - "checking" (never
// checked yet, or the background loop/manual recheck hasn't landed a
// result), "verified" (every nameserver passed both checks against a real
// public resolver), or "waiting" (checked at least once, still not fully
// correct - most commonly still-propagating registrar changes).
function DelegationStatusLine({ delegation }: { delegation: NonNullable<DnsInfoPanelState['delegation']> }) {
  if (delegation.checkedAt === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-amber-300">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Vérification en cours…
      </span>
    );
  }
  if (delegation.verified) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Délégation vérifiée sur le DNS public
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-amber-300">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      En attente de propagation — nouvelle vérification automatique périodique
    </span>
  );
}

export function DelegationDnssecDialog({
  infoPanel,
  onClose,
  onRecheck,
}: {
  infoPanel: DnsInfoPanelState | null;
  onClose: () => void;
  onRecheck: () => Promise<void>;
}) {
  const [rechecking, setRechecking] = useState(false);

  const handleRecheck = async () => {
    setRechecking(true);
    try {
      await onRecheck();
    } finally {
      setRechecking(false);
    }
  };

  return (
    <Dialog open={!!infoPanel} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center justify-between gap-2">
            <DialogTitle>
              {infoPanel?.tab === 'delegation' ? 'Délégation' : 'DNSSEC'} — {infoPanel?.zone.name}
            </DialogTitle>
            {infoPanel?.tab === 'delegation' && infoPanel.delegation && (
              <Button variant="ghost" size="sm" className="gap-1.5" disabled={rechecking} onClick={handleRecheck}>
                <RefreshCcw className={`h-3.5 w-3.5 ${rechecking ? 'animate-spin' : ''}`} />
                Revérifier
              </Button>
            )}
          </div>
        </DialogHeader>
        {infoPanel?.loading ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : infoPanel?.tab === 'delegation' ? (
          <div className="space-y-4 text-sm">
            {infoPanel.delegation && infoPanel.delegation.nsHostnames.length > 0 && (
              <>
                <DelegationStatusLine delegation={infoPanel.delegation} />

                {infoPanel.delegation.detail && infoPanel.delegation.detail.length > 0 && (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Nameserver</TableHead>
                        <TableHead>NS visible</TableHead>
                        <TableHead>Glue résout vers</TableHead>
                        <TableHead className="w-[70px]">Statut</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {infoPanel.delegation.detail.map((entry) => (
                        <TableRow key={entry.host}>
                          <TableCell className="font-mono">{entry.host}</TableCell>
                          <TableCell>
                            {entry.nsVisible ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                            ) : (
                              <XCircle className="h-4 w-4 text-rose-400" />
                            )}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {entry.resolvedIp ?? '—'}
                            {entry.resolvedIp && !entry.matches && (
                              <span className="ml-1.5 text-rose-400">(attendu {entry.expectedIp})</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {entry.ok ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                            ) : (
                              <XCircle className="h-4 w-4 text-rose-400" />
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}

                <div className="space-y-2">
                  <p className="text-muted-foreground">Nameservers de cette zone :</p>
                  {infoPanel.delegation.nsHostnames.map((host) => (
                    <div key={host} className="rounded-lg border border-white/[0.08] bg-zinc-950/60 px-3 py-2 font-mono">
                      {host}
                    </div>
                  ))}
                </div>

                {infoPanel.zone.name.split('.').length <= 2 ? (
                  <Callout variant="warning">
                    <strong>{infoPanel.zone.name}</strong> ressemble à un domaine racine — pour le déléguer
                    directement, ton registrar doit accepter d'y ajouter les <strong>glue records</strong>{' '}
                    (parfois appelés « host records » / « enregistrements hôte ») ci-dessous. Certains registrars ne
                    proposent pas cette option facilement.
                    <ul className="mt-2 space-y-1 font-mono text-xs">
                      {infoPanel.delegation.glue.map((g) => (
                        <li key={g.host}>
                          {g.host} → {g.ip}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2">
                      Alternative plus simple : recrée cette zone comme un{' '}
                      <strong>sous-domaine</strong> (ex : <code>dns.{infoPanel.zone.name}</code>) — tu n'as alors
                      besoin d'ajouter que des enregistrements A/NS classiques dans le DNS existant de ton domaine
                      principal, sans configuration spéciale chez le registrar.
                    </p>
                  </Callout>
                ) : (
                  <Callout variant="info">
                    <strong>{infoPanel.zone.name}</strong> est un sous-domaine : pas de glue record nécessaire.
                    Dans le DNS existant de ton domaine principal (là où tu gères déjà ses enregistrements
                    aujourd'hui), ajoute simplement :
                    <ul className="mt-2 space-y-1 font-mono text-xs">
                      <li>
                        NS &nbsp;{infoPanel.zone.name} → {infoPanel.delegation.nsHostnames.join(', ')}
                      </li>
                      {infoPanel.delegation.glue.map((g) => (
                        <li key={g.host}>
                          A &nbsp;{g.host} → {g.ip}
                        </li>
                      ))}
                    </ul>
                  </Callout>
                )}
              </>
            )}
            {(!infoPanel.delegation || infoPanel.delegation.nsHostnames.length === 0) && (
              <p className="text-muted-foreground">Ajoute au moins un serveur au groupe DNS de cette zone.</p>
            )}
          </div>
        ) : (
          <div className="space-y-4 text-sm">
            <p className="text-muted-foreground">
              Enregistre ce DS record chez ton registrar pour activer la validation DNSSEC de la chaîne de confiance.
            </p>
            {infoPanel?.dnssec?.dsRecords.length ? (
              infoPanel.dnssec.dsRecords.map((ds) => (
                <div key={ds} className="rounded-lg border border-white/[0.08] bg-zinc-950/60 px-3 py-2 font-mono text-xs break-all">
                  {ds}
                </div>
              ))
            ) : (
              <p className="flex items-center gap-2 text-muted-foreground">
                <XCircle className="h-4 w-4" />
                Aucune clé disponible pour l'instant (le nœud primaire doit être en ligne et avoir appliqué la zone).
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
