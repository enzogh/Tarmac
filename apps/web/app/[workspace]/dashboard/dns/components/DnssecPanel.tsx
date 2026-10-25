'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { api, DnsZoneItem } from '@/lib/api';
import { Callout } from '@/components/Callout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyButton } from '@/components/ui/copy-button';
import { Skeleton } from '@/components/ui/skeleton';

// DS record parts, in the order registrars ask for them.
function parseDs(ds: string) {
  const parts = ds.trim().split(/\s+/);
  const index = parts.findIndex((part) => part.toUpperCase() === 'DS');
  const fields = index >= 0 ? parts.slice(index + 1) : parts;
  if (fields.length < 4) return null;
  return { keyTag: fields[0], algorithm: fields[1], digestType: fields[2], digest: fields.slice(3).join('') };
}

export function DnssecPanel({ zone }: { zone: DnsZoneItem }) {
  const [keys, setKeys] = useState<{ dsRecords: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!zone.dnssecEnabled) return;
    let cancelled = false;
    setKeys(null);
    setError(null);
    api.dns.zones
      .getDnssecKeys(zone.id)
      .then((result) => !cancelled && setKeys(result))
      .catch(() => !cancelled && setError('Clés indisponibles : le serveur primaire doit être en ligne et avoir appliqué la zone.'));
    return () => {
      cancelled = true;
    };
  }, [zone.id, zone.dnssecEnabled]);

  if (!zone.dnssecEnabled) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 py-8">
          <ShieldOff className="mt-0.5 h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium text-foreground">DNSSEC n&apos;est pas activé pour {zone.name}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              DNSSEC se choisit à la création du domaine. Pour l&apos;activer, recréez le domaine avec l&apos;option
              cochée.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <ShieldCheck className="h-4 w-4 text-[hsl(var(--ok))]" />
          DNSSEC activé — signature automatique
        </CardTitle>
        <CardDescription>
          Pour que les résolveurs valident les signatures, ajoutez cet enregistrement DS chez votre registrar (section
          « DNSSEC »). Sans lui, la zone fonctionne mais n&apos;est pas validée.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <Callout variant="warning">{error}</Callout>
        ) : !keys ? (
          <Skeleton className="h-28 w-full" />
        ) : keys.dsRecords.length === 0 ? (
          <Callout variant="warning">Aucune clé publiée pour l&apos;instant : la zone est encore en cours de signature.</Callout>
        ) : (
          keys.dsRecords.map((ds) => {
            const parsed = parseDs(ds);
            return (
              <div key={ds} className="space-y-3 rounded-lg border border-border bg-surface-2 p-3">
                {parsed && (
                  <dl className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                    {[
                      ['Key tag', parsed.keyTag],
                      ['Algorithme', parsed.algorithm],
                      ['Type de digest', parsed.digestType],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-2xs uppercase tracking-wider text-muted-foreground">{label}</dt>
                        <dd className="mt-0.5 flex items-center gap-1 font-mono text-foreground">
                          {value}
                          <CopyButton value={value} iconOnly className="h-6 w-6" />
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
                <div>
                  <span className="text-2xs uppercase tracking-wider text-muted-foreground">
                    {parsed ? 'Digest' : 'Enregistrement DS'}
                  </span>
                  <div className="mt-0.5 flex items-start justify-between gap-2">
                    <code className="break-all font-mono text-xs text-foreground">{parsed?.digest ?? ds}</code>
                    <CopyButton value={parsed?.digest ?? ds} iconOnly />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
                  <code className="min-w-0 truncate font-mono text-2xs text-muted-foreground">{ds}</code>
                  <CopyButton value={ds} label="Copier l'enregistrement complet" />
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
