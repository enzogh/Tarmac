'use client';

import { ReactNode, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Download, Eye, EyeOff, Laptop, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/Callout';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';

function downloadConfig(filename: string, config: string) {
  const url = URL.createObjectURL(new Blob([config], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// Same rule as the API's configFilename(): WireGuard clients reject tunnel
// names over 15 characters or with unusual characters.
export function configFilenameFor(profileName: string) {
  const base = profileName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_=+.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 15);
  return `${base || 'tarmac'}.conf`;
}

function maskSecrets(config: string) {
  return config.replace(/^(PrivateKey|PresharedKey) = (?!<).+$/gm, '$1 = ••••••••••••••••••••••••••••••••••••••••••••');
}

function Step({ index, children }: { index: number; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-2xs font-semibold text-primary">
        {index}
      </span>
      <span className="text-sm text-muted-foreground">{children}</span>
    </li>
  );
}

/**
 * Everything needed to get a device on the VPN, for both kinds of device
 * people actually use: a file to import on a computer, a QR code to scan
 * from the phone app. The config is shown masked by default since it holds
 * the profile's private key.
 */
export function ConfigPanel({
  profileName,
  config,
  complete = true,
}: {
  profileName: string;
  config: string;
  complete?: boolean;
}) {
  const [target, setTarget] = useState<'desktop' | 'mobile'>('desktop');
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const filename = useMemo(() => configFilenameFor(profileName), [profileName]);

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(config, { errorCorrectionLevel: 'M', margin: 1, width: 240 })
      .then((url) => !cancelled && setQr(url))
      .catch(() => !cancelled && setQr(null));
    return () => {
      cancelled = true;
    };
  }, [config]);

  const copy = async () => {
    await navigator.clipboard.writeText(config);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-4">
      {!complete && (
        <Callout variant="warning">
          Ce profil a été créé avec votre propre clé publique : remplacez <code className="font-mono">&lt;VOTRE_CLE_PRIVEE&gt;</code>{' '}
          par la clé privée correspondante avant d&apos;importer le fichier.
        </Callout>
      )}

      <Tabs value={target} onValueChange={(value) => setTarget(value as 'desktop' | 'mobile')}>
        <TabsList variant="segmented">
          <TabsTrigger value="desktop" className="gap-1.5">
            <Laptop className="h-3.5 w-3.5" />
            Ordinateur
          </TabsTrigger>
          <TabsTrigger value="mobile" className="gap-1.5">
            <Smartphone className="h-3.5 w-3.5" />
            Téléphone
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {target === 'desktop' ? (
        <div className="space-y-4">
          <ol className="space-y-2">
            <Step index={1}>
              Installez l&apos;application WireGuard officielle (
              <a href="https://www.wireguard.com/install/" target="_blank" rel="noreferrer" className="text-primary hover:underline">
                wireguard.com/install
              </a>
              ).
            </Step>
            <Step index={2}>Téléchargez le fichier de configuration ci-dessous.</Step>
            <Step index={3}>
              Dans WireGuard : <span className="text-foreground">Importer un tunnel depuis un fichier</span>, puis{' '}
              <span className="text-foreground">Activer</span>.
            </Step>
          </ol>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => downloadConfig(filename, config)} className="gap-1.5">
              <Download className="h-4 w-4" />
              Télécharger {filename}
            </Button>
            <Button variant="secondary" onClick={() => void copy()} className="gap-1.5">
              {copied ? <Check className="h-4 w-4 text-[hsl(var(--ok))]" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copié' : 'Copier'}
            </Button>
          </div>
          <div className="rounded-lg border border-border bg-surface-2">
            <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
              <span className="font-mono text-2xs text-muted-foreground">{filename}</span>
              <button
                type="button"
                onClick={() => setRevealed((value) => !value)}
                className="flex items-center gap-1 text-2xs text-muted-foreground hover:text-foreground"
              >
                {revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                {revealed ? 'Masquer les clés' : 'Afficher les clés'}
              </button>
            </div>
            <pre className="overflow-x-auto px-3 py-2 font-mono text-2xs leading-relaxed text-foreground/90">
              {revealed ? config : maskSecrets(config)}
            </pre>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <div className="shrink-0 rounded-xl bg-white p-2">
            {qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt={`QR code de configuration ${profileName}`} width={200} height={200} />
            ) : (
              <Skeleton className="h-[200px] w-[200px]" />
            )}
          </div>
          <ol className="space-y-2">
            <Step index={1}>Installez WireGuard depuis l&apos;App Store ou le Play Store.</Step>
            <Step index={2}>
              Touchez <span className="text-foreground">+</span> puis{' '}
              <span className="text-foreground">Scanner un code QR</span>.
            </Step>
            <Step index={3}>Nommez le tunnel et activez-le.</Step>
          </ol>
        </div>
      )}

      <p className="text-2xs text-muted-foreground">
        Cette configuration contient la clé privée du profil : ne la partagez qu&apos;avec la personne qui l&apos;utilise.
        Vous pourrez la retélécharger à tout moment depuis le menu du profil.
      </p>
    </div>
  );
}

/** Fetches and shows a saved profile's config (menu "Installer sur un appareil"). */
export function ConfigDialog({
  profile,
  onOpenChange,
}: {
  profile: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [state, setState] = useState<{ config: string; complete: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setState(null);
    setError(null);
    if (!profile) return;
    let cancelled = false;
    api.vpn
      .config(profile.id)
      .then((result) => !cancelled && setState({ config: result.config, complete: result.complete }))
      .catch((caught) => !cancelled && setError(caught instanceof Error ? caught.message : 'Configuration indisponible.'));
    return () => {
      cancelled = true;
    };
  }, [profile]);

  return (
    <Dialog open={profile !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Installer « {profile?.name} » sur un appareil</DialogTitle>
          <DialogDescription>Compatible avec les applications WireGuard Windows, macOS, Linux, iOS et Android.</DialogDescription>
        </DialogHeader>
        {error ? (
          <Callout variant="danger">{error}</Callout>
        ) : state && profile ? (
          <ConfigPanel profileName={profile.name} config={state.config} complete={state.complete} />
        ) : (
          <div className="space-y-3">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-32 w-full" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
