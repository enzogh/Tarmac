'use client';

import { useEffect, useState } from 'react';
import { LoaderCircle, ShieldCheck, ShieldOff } from 'lucide-react';
import { api, DnsZoneItem } from '@/lib/api';
import { Callout } from '@/components/Callout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

export function DnssecPanel({
  zone,
  onChanged,
  onNotice,
}: {
  zone: DnsZoneItem;
  onChanged: () => Promise<unknown>;
  onNotice: (notice: { type: 'success' | 'error'; message: string }) => void;
}) {
  const [keys, setKeys] = useState<{ dsRecords: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const [saving, setSaving] = useState(false);

  const setDnssec = async (enabled: boolean) => {
    setSaving(true);
    try {
      await api.dns.zones.update(zone.id, { dnssecEnabled: enabled });
      setConfirmingDisable(false);
      onNotice({
        type: 'success',
        message: enabled
          ? `DNSSEC activé sur ${zone.name} : la zone va être signée par vos serveurs.`
          : `DNSSEC désactivé sur ${zone.name} : ses clés vont être retirées de vos serveurs.`,
      });
      await onChanged();
    } catch {
      onNotice({ type: 'error', message: enabled ? "DNSSEC n'a pas pu être activé." : "DNSSEC n'a pas pu être désactivé." });
    } finally {
      setSaving(false);
    }
  };

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
        <CardContent className="flex flex-col gap-4 py-8 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <ShieldOff className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">DNSSEC n&apos;est pas activé pour {zone.name}</p>
              <p className="mt-1 max-w-prose text-xs text-muted-foreground">
                La zone fonctionne normalement, sans signature. Activez DNSSEC si votre registrar permet d&apos;y publier
                un enregistrement DS : vos visiteurs seront alors protégés contre les réponses DNS falsifiées.
              </p>
            </div>
          </div>
          <Button write onClick={() => void setDnssec(true)} disabled={saving} className="shrink-0 gap-1.5">
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            Activer DNSSEC
          </Button>
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
        <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Votre registrar ne gère pas DNSSEC pour ce domaine ? Désactivez-le : la zone sera servie sans signature.
          </p>
          <Button write variant="secondary" onClick={() => setConfirmingDisable(true)} className="shrink-0 gap-1.5">
            <ShieldOff className="h-4 w-4" />
            Désactiver DNSSEC
          </Button>
        </div>
      </CardContent>

      <Dialog open={confirmingDisable} onOpenChange={(open) => !saving && setConfirmingDisable(open)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Désactiver DNSSEC sur {zone.name} ?</DialogTitle>
            <DialogDescription>
              Les clés de signature seront supprimées de vos serveurs DNS, et la zone sera servie sans signature.
            </DialogDescription>
          </DialogHeader>
          <Callout variant="warning">
            Si l&apos;enregistrement DS est publié chez votre registrar, retirez-le d&apos;abord et attendez sa
            disparition (jusqu&apos;à 48 h). Sinon, les résolveurs qui valident DNSSEC rejetteront le domaine, qui
            deviendra injoignable pour une partie de vos visiteurs. Si vous ne l&apos;avez jamais publié, vous pouvez
            désactiver sans attendre.
          </Callout>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirmingDisable(false)} disabled={saving}>
              Annuler
            </Button>
            <Button write variant="destructive" onClick={() => void setDnssec(false)} disabled={saving} className="gap-1.5">
              {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
              Désactiver DNSSEC
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
