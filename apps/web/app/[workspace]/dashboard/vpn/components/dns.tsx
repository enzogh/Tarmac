'use client';

import { useEffect, useState } from 'react';
import { AtSign, LoaderCircle, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/Callout';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, VpnDnsSettings } from '@/lib/api';
import { cn } from '@/lib/utils';

export const DEFAULT_ZONE = 'intranet.internal';
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Same derivation as the API (hostnameFromName in vpn-dns.ts). */
export function hostnameFromName(name: string): string {
  const label = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/, '');
  return label || 'appareil';
}

export function normalizeHostname(value: string) {
  return value.trim().toLowerCase().replace(/\.+$/, '');
}

export function hostnameError(value: string): string | null {
  const hostname = normalizeHostname(value);
  if (!hostname) return null;
  if (hostname.length > 63) return 'Nom DNS : 63 caractères maximum.';
  if (!LABEL.test(hostname)) {
    return 'Nom DNS : lettres minuscules, chiffres et tirets uniquement, sans tiret au début ni à la fin (ex. pc-alice).';
  }
  return null;
}

function zoneError(value: string): string | null {
  const zone = value.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  if (!zone) return 'Indiquez un domaine, par exemple intranet.internal.';
  if (!zone.split('.').every((label) => LABEL.test(label))) {
    return 'Uniquement des lettres minuscules, chiffres et tirets, séparés par des points.';
  }
  return null;
}

const isLocalZone = (zone: string) => {
  const normalized = zone.trim().toLowerCase().replace(/\.+$/, '');
  return normalized === 'local' || normalized.endsWith('.local');
};

/** A DNS label input with the workspace zone shown as a fixed suffix. */
export function HostnameInput({
  id,
  value,
  onChange,
  zone,
  placeholder,
  onReset,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  zone: string;
  placeholder?: string;
  // Shown as "derive from the name" when set.
  onReset?: () => void;
}) {
  const error = hostnameError(value);
  return (
    <div className="space-y-1.5">
      <div
        className={cn(
          'flex h-9 min-w-0 items-center overflow-hidden rounded-lg border bg-zinc-950/70 font-mono text-xs shadow-insetSoft transition-colors focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-ring',
          error ? 'border-[hsl(var(--danger))]/60' : 'border-border',
        )}
      >
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value.toLowerCase().replace(/\s+/g, '-'))}
          placeholder={placeholder}
          maxLength={63}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-invalid={Boolean(error)}
          className="h-full min-w-0 flex-1 bg-transparent px-3 text-foreground outline-none placeholder:text-muted-foreground/70"
        />
        <span className="flex h-full max-w-[55%] shrink-0 items-center truncate border-l border-border bg-surface-2 px-2.5 text-muted-foreground" title={`.${zone}`}>
          .{zone}
        </span>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            title="Reprendre le nom du profil"
            aria-label="Reprendre le nom du profil"
            className="flex h-full shrink-0 items-center border-l border-border px-2 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {error && <p className="text-2xs text-[hsl(var(--danger))]">{error}</p>}
    </div>
  );
}

/** The "use the internal resolver" switch of the create / edit dialogs. */
export function InternalDnsOption({
  checked,
  onChange,
  fqdn,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  fqdn: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-surface-2 p-3 text-sm text-foreground">
      <Checkbox checked={checked} onChange={(event) => onChange(event.target.checked)} className="mt-0.5" />
      <span className="min-w-0">
        Résoudre les noms internes sur cet appareil
        <span className="block text-xs text-muted-foreground">
          {checked ? (
            <>
              L&apos;appareil interroge le DNS de son point d&apos;entrée : il joint les profils reliés par leur nom (
              <span className="font-mono">{fqdn}</span> pour lui-même), le reste est relayé aux serveurs DNS ci-dessous.
            </>
          ) : (
            "L'appareil garde les serveurs DNS ci-dessous et ne résout pas les noms internes. Les autres profils peuvent quand même le joindre par son nom."
          )}
        </span>
      </span>
    </label>
  );
}

/** Workspace setting: the suffix every profile's internal name ends with. */
export function DnsSettingsDialog({
  open,
  settings,
  sampleHostname,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  settings: VpnDnsSettings | undefined;
  sampleHostname: string;
  onOpenChange: (open: boolean) => void;
  onSaved: (settings: VpnDnsSettings) => void;
}) {
  const current = settings?.zone ?? DEFAULT_ZONE;
  const [zone, setZone] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setZone(current);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const normalized = zone.trim().toLowerCase().replace(/^\.+|\.+$/g, '');
  const invalid = zoneError(zone);
  const changed = normalized !== current;

  const save = async () => {
    if (invalid || !changed) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.vpn.updateDns(normalized));
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "L'enregistrement a échoué.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AtSign className="h-4 w-4 text-primary" />
            Noms DNS internes
          </DialogTitle>
          <DialogDescription>
            Chaque profil a un nom qui pointe vers son adresse VPN. Les appareils reliés se joignent par ce nom plutôt que
            par une adresse IP.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="vpn-dns-zone">Domaine</Label>
            <Input
              id="vpn-dns-zone"
              value={zone}
              onChange={(event) => setZone(event.target.value)}
              placeholder={DEFAULT_ZONE}
              spellCheck={false}
              autoCapitalize="off"
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Exemple : <span className="font-mono text-foreground">{sampleHostname}.{invalid ? current : normalized}</span>
            </p>
          </div>
          <ul className="space-y-1.5 rounded-lg border border-border bg-surface-2/40 p-3 text-xs text-muted-foreground">
            <li>
              Un appareil ne résout que son propre nom et ceux des profils qu&apos;il a le droit de joindre (liens d&apos;accès).
            </li>
            <li>Renommer un profil ou changer ce domaine s&apos;applique en quelques secondes, sans réinstaller la configuration.</li>
            <li>
              Le domaine est aussi ajouté comme suffixe de recherche : <span className="font-mono">ssh {sampleHostname}</span>{' '}
              suffit. Après un changement de domaine, ce raccourci suit à la prochaine installation de la configuration.
            </li>
          </ul>
          {invalid && zone.trim() !== '' && <Callout variant="danger">{invalid}</Callout>}
          {!invalid && isLocalZone(normalized) && (
            <Callout variant="warning">
              Les noms en .local sont réservés au DNS multicast : macOS, iOS et la plupart des Linux ne les demandent pas
              au DNS du VPN, ils risquent de ne fonctionner que sous Windows. Préférez un domaine en .internal, réservé à
              cet usage.
            </Callout>
          )}
          {error && <Callout variant="danger">{error}</Callout>}
        </div>
        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" onClick={() => setZone(DEFAULT_ZONE)} disabled={normalized === DEFAULT_ZONE}>
            Domaine par défaut
          </Button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button write onClick={() => void save()} disabled={saving || Boolean(invalid) || !changed} className="gap-1.5">
              {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
              Enregistrer
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
