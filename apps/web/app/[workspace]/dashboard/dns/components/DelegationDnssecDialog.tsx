'use client';

import { XCircle } from 'lucide-react';
import { DnsZoneItem } from '@/lib/api';
import { Callout } from '@/components/Callout';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export type DnsInfoPanelState = {
  zone: DnsZoneItem;
  tab: 'delegation' | 'dnssec';
  delegation?: { nsHostnames: string[]; glue: Array<{ host: string; ip: string }> };
  dnssec?: { dsRecords: string[]; dnskeyRecords: string[] };
  loading: boolean;
};

export function DelegationDnssecDialog({
  infoPanel,
  onClose,
}: {
  infoPanel: DnsInfoPanelState | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!infoPanel} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {infoPanel?.tab === 'delegation' ? 'Délégation' : 'DNSSEC'} — {infoPanel?.zone.name}
          </DialogTitle>
        </DialogHeader>
        {infoPanel?.loading ? (
          <p className="text-sm text-muted-foreground">Chargement…</p>
        ) : infoPanel?.tab === 'delegation' ? (
          <div className="space-y-4 text-sm">
            {infoPanel.delegation && infoPanel.delegation.nsHostnames.length > 0 && (
              <>
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
