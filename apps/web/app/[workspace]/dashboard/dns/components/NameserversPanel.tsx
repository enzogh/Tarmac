'use client';

import { ReactNode, useCallback, useEffect, useState } from 'react';
import { CheckCircle2, CircleDashed, LoaderCircle, RefreshCcw, XCircle } from 'lucide-react';
import { api, DnsDelegationNameserverResult, DnsZoneItem } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/Callout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatRelative } from '@/lib/format';
import { cn } from '@/lib/utils';

type Delegation = {
  nsHostnames: string[];
  glue: Array<{ host: string; ip: string }>;
  verified: boolean;
  checkedAt: string | null;
  detail: DnsDelegationNameserverResult[] | null;
};

function CopyRow({ label, value, mono = true }: { label?: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2">
      <div className="min-w-0">
        {label && <span className="block font-mono text-2xs text-muted-foreground">{label}</span>}
        <span className={cn('block break-all text-sm text-foreground', mono && 'font-mono')}>{value}</span>
      </div>
      <CopyButton value={value} iconOnly />
    </div>
  );
}

function Step({ index, title, children }: { index: number; title: string; children: ReactNode }) {
  return (
    <li className="group relative flex gap-4 pb-6 last:pb-0">
      <span className="absolute left-[0.6875rem] top-7 h-[calc(100%-1.75rem)] w-px bg-border group-last:hidden" aria-hidden />
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
        {index}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {children}
      </div>
    </li>
  );
}

/**
 * Where Cloudflare says "change your nameservers": what to set at the
 * registrar (or in the parent zone for a subdomain), each value one click
 * to copy, and the live verification against the public DNS underneath.
 */
export function NameserversPanel({ zone }: { zone: DnsZoneItem }) {
  const [delegation, setDelegation] = useState<Delegation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const load = useCallback(async () => {
    try {
      setDelegation(await api.dns.zones.getDelegation(zone.id));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossible de charger la délégation.');
    }
  }, [zone.id]);

  useEffect(() => {
    setDelegation(null);
    void load();
  }, [load]);

  // The background checker may verify the zone while this tab is open.
  useEffect(() => {
    if (delegation && zone.delegationVerified !== delegation.verified) void load();
  }, [zone.delegationVerified, delegation, load]);

  const recheck = async () => {
    setChecking(true);
    try {
      const result = await api.dns.zones.recheckDelegation(zone.id);
      setDelegation((current) => (current ? { ...current, ...result } : current));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'La vérification a échoué.');
    } finally {
      setChecking(false);
    }
  };

  if (error) return <Callout variant="danger">{error}</Callout>;
  if (!delegation) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (delegation.nsHostnames.length === 0) {
    return (
      <Callout variant="warning">
        Le groupe de serveurs de ce domaine n&apos;a encore aucun serveur : ajoutez-en un depuis l&apos;onglet Serveurs DNS.
      </Callout>
    );
  }

  const isApex = zone.name.split('.').length <= 2;
  const state = delegation.checkedAt === null ? 'checking' : delegation.verified ? 'verified' : 'waiting';
  const parent = zone.name.split('.').slice(1).join('.');

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-4">
        <Card
          className={cn(
            state === 'verified' ? 'border-[hsl(var(--ok))]/30' : 'border-[hsl(var(--warn))]/30',
          )}
        >
          <CardContent className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              {state === 'verified' ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 text-[hsl(var(--ok))]" />
              ) : state === 'checking' ? (
                <LoaderCircle className="mt-0.5 h-5 w-5 animate-spin text-[hsl(var(--warn))]" />
              ) : (
                <CircleDashed className="mt-0.5 h-5 w-5 text-[hsl(var(--warn))]" />
              )}
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {state === 'verified'
                    ? `${zone.name} est servi par vos serveurs DNS`
                    : state === 'checking'
                      ? 'Vérification de la délégation en cours…'
                      : 'En attente de la délégation'}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {state === 'verified'
                    ? 'Le DNS public renvoie bien vers vos nameservers. Rien d’autre à faire.'
                    : 'Effectuez les étapes ci-dessous. La propagation prend de quelques minutes à 48 h ; Tarmac revérifie automatiquement.'}
                  {delegation.checkedAt && ` Dernière vérification ${formatRelative(delegation.checkedAt)}.`}
                </p>
              </div>
            </div>
            <Button variant="secondary" onClick={() => void recheck()} disabled={checking} className="gap-1.5">
              <RefreshCcw className={cn('h-3.5 w-3.5', checking && 'animate-spin')} />
              Vérifier maintenant
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{isApex ? 'Déléguer le domaine chez votre registrar' : `Déléguer ${zone.name} depuis ${parent}`}</CardTitle>
            <CardDescription>
              {isApex
                ? 'À faire une seule fois, dans l’espace client du registrar où le domaine a été acheté (OVH, Gandi, Namecheap…).'
                : `${zone.name} est un sous-domaine : il suffit d’ajouter quelques enregistrements là où ${parent} est géré aujourd’hui, aucun changement chez le registrar.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol>
              {isApex ? (
                <>
                  <Step index={1} title="Déclarez les serveurs de noms (glue records)">
                    <p className="text-xs text-muted-foreground">
                      Vos nameservers sont dans le domaine lui-même : le registrar doit connaître leur IP. Cherchez
                      « glue records », « host records » ou « DNS personnalisés ».
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {delegation.glue.map((glue) => (
                        <CopyRow key={glue.host} label={glue.host} value={glue.ip} />
                      ))}
                    </div>
                  </Step>
                  <Step index={2} title="Remplacez les serveurs DNS du domaine par :">
                    <div className="grid gap-2 sm:grid-cols-2">
                      {delegation.nsHostnames.map((host) => (
                        <CopyRow key={host} value={host} />
                      ))}
                    </div>
                    <p className="text-xs text-muted-foreground">Supprimez les anciens serveurs DNS de la liste.</p>
                  </Step>
                  <Step index={3} title="Enregistrez et patientez">
                    <p className="text-xs text-muted-foreground">
                      Cette page passe au vert dès que le DNS public renvoie vers vos serveurs.
                    </p>
                  </Step>
                </>
              ) : (
                <>
                  <Step index={1} title={`Dans la zone ${parent}, ajoutez ces enregistrements NS :`}>
                    <div className="grid gap-2">
                      {delegation.nsHostnames.map((host) => (
                        <CopyRow key={host} label={`NS · ${zone.name}`} value={host} />
                      ))}
                    </div>
                  </Step>
                  <Step index={2} title="Puis les adresses de ces serveurs :">
                    <div className="grid gap-2 sm:grid-cols-2">
                      {delegation.glue.map((glue) => (
                        <CopyRow key={glue.host} label={`A · ${glue.host}`} value={glue.ip} />
                      ))}
                    </div>
                  </Step>
                  <Step index={3} title="Patientez">
                    <p className="text-xs text-muted-foreground">
                      Cette page passe au vert dès que le DNS public renvoie vers vos serveurs.
                    </p>
                  </Step>
                </>
              )}
            </ol>
          </CardContent>
        </Card>
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>Contrôle par nameserver</CardTitle>
          <CardDescription>Ce que voit le DNS public, serveur par serveur.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {(delegation.detail ?? delegation.nsHostnames.map((host) => ({ host }) as Partial<DnsDelegationNameserverResult>)).map(
            (entry) => (
              <div key={entry.host} className="rounded-lg border border-border bg-surface-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-xs text-foreground">{entry.host}</span>
                  {entry.ok === undefined ? (
                    <CircleDashed className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : entry.ok ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-[hsl(var(--ok))]" />
                  ) : (
                    <XCircle className="h-4 w-4 shrink-0 text-[hsl(var(--danger))]" />
                  )}
                </div>
                {entry.ok !== undefined && (
                  <dl className="mt-2 space-y-1 text-2xs">
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Visible dans le NS public</dt>
                      <dd className={entry.nsVisible ? 'text-[hsl(var(--ok))]' : 'text-[hsl(var(--danger))]'}>
                        {entry.nsVisible ? 'Oui' : 'Non'}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-muted-foreground">Résout vers</dt>
                      <dd className={cn('font-mono', entry.matches ? 'text-foreground' : 'text-[hsl(var(--danger))]')}>
                        {entry.resolvedIp ?? '—'}
                        {entry.resolvedIp && !entry.matches && ` (attendu ${entry.expectedIp})`}
                      </dd>
                    </div>
                  </dl>
                )}
              </div>
            ),
          )}
        </CardContent>
      </Card>
    </div>
  );
}
