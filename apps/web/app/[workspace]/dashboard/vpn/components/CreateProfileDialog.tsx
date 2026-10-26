'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Globe2, LoaderCircle, Network, PartyPopper } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/Callout';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, VpnAccess, VpnGateway, VpnProfile, VpnProfileMode, VpnProfileWithConfig } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AccessEditor, accessError, accessPayload, DEFAULT_ACCESS } from './access';
import { ConfigPanel } from './ConfigPanel';
import { RouteDiagram } from './RouteDiagram';
import { NodePicker } from './NodePicker';
import { MODE_LABEL } from './vpn-ui';

const STEPS = [
  { id: 'entry', title: "Point d'entrée", hint: "Le serveur auquel l'appareil se connecte." },
  { id: 'traffic', title: 'Trafic et sortie', hint: 'Ce qui passe par le VPN, et par où il sort sur Internet.' },
  { id: 'access', title: 'Accès', hint: "Ce que l'appareil peut joindre une fois connecté." },
  { id: 'review', title: 'Finalisation', hint: 'Options et récapitulatif.' },
] as const;

export const EXPIRY_OPTIONS = [
  { value: 'never', label: "Jamais (jusqu'à suppression)" },
  { value: '1', label: '24 heures' },
  { value: '7', label: '7 jours' },
  { value: '30', label: '30 jours' },
  { value: '90', label: '90 jours' },
  { value: '365', label: '1 an' },
];

export function expiryToIso(value: string): string | undefined {
  if (value === 'never') return undefined;
  return new Date(Date.now() + Number(value) * 24 * 60 * 60 * 1000).toISOString();
}

export function parseTags(raw: string): string[] {
  return [...new Set(raw.split(',').map((part) => part.trim()).filter(Boolean))].slice(0, 10);
}

export function parseDns(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const WG_KEY = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$/;

function ModeOption({ mode, selected, onSelect }: { mode: VpnProfileMode; selected: boolean; onSelect: () => void }) {
  const Icon = mode === 'full' ? Globe2 : Network;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full gap-3 rounded-lg border p-3 text-left transition-colors',
        selected ? 'border-primary/60 bg-primary/[0.07] ring-1 ring-primary/30' : 'border-border bg-surface-2 hover:border-primary/30',
      )}
    >
      <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')} />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{MODE_LABEL[mode].title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{MODE_LABEL[mode].description}</span>
      </span>
    </button>
  );
}

export function CreateProfileDialog({
  open,
  onOpenChange,
  gateways,
  profiles,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gateways: VpnGateway[];
  profiles: VpnProfile[];
  onCreated: () => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [access, setAccess] = useState<VpnAccess>(DEFAULT_ACCESS);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [mode, setMode] = useState<VpnProfileMode>('full');
  // '' = leave directly through the entry node.
  const [exitId, setExitId] = useState<string>('');
  const [dns, setDns] = useState('');
  const [expiry, setExpiry] = useState('never');
  const [ownKey, setOwnKey] = useState(false);
  const [publicKey, setPublicKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<VpnProfileWithConfig | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(0);
    setName('');
    setDescription('');
    setTags('');
    setAccess(DEFAULT_ACCESS);
    setMode('full');
    setExitId('');
    setDns('');
    setExpiry('never');
    setOwnKey(false);
    setPublicKey('');
    setError(null);
    setCreated(null);
    // Preselect when there's a single obvious choice.
    const eligible = gateways.filter((gateway) => gateway.entryEligibility === null);
    setEntryId(eligible.length === 1 ? eligible[0].id : null);
    // Only reset when the dialog opens, not on every gateways poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const entry = gateways.find((gateway) => gateway.id === entryId) ?? null;
  const exit = mode === 'full' ? (gateways.find((gateway) => gateway.id === (exitId || entryId)) ?? null) : null;
  const dnsList = parseDns(dns);
  const dnsInvalid = dnsList.some((value) => !IPV4.test(value)) || dnsList.length > 4;
  const keyInvalid = ownKey && !WG_KEY.test(publicKey.trim());

  const stepError =
    step === 0
      ? !name.trim()
        ? 'Donnez un nom au profil (par exemple le nom de la personne ou de l’appareil).'
        : !entry
          ? "Choisissez le nœud auquel l'appareil va se connecter."
          : null
      : step === 2
        ? accessError(access)
        : step === 3
        ? dnsInvalid
          ? 'Serveurs DNS : jusqu’à 4 adresses IPv4 séparées par des virgules.'
          : keyInvalid
            ? 'La clé publique doit être une clé WireGuard en base64 (44 caractères).'
            : null
        : null;

  const submit = async () => {
    if (!entry || stepError) return;
    setSubmitting(true);
    setError(null);
    try {
      const profile = await api.vpn.create({
        name: name.trim(),
        description: description.trim() || undefined,
        mode,
        entryNodeId: entry.id,
        exitNodeId: mode === 'full' && exitId ? exitId : null,
        dns: dnsList.length > 0 ? dnsList : undefined,
        expiresAt: expiryToIso(expiry),
        publicKey: ownKey ? publicKey.trim() : undefined,
        tags: parseTags(tags),
        ...accessPayload(access),
      });
      setCreated(profile);
      onCreated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'La création du profil a échoué.');
    } finally {
      setSubmitting(false);
    }
  };

  const route = entry ? (
    <RouteDiagram entry={entry} exit={mode === 'full' ? (exit ?? entry) : null} className="text-xs" />
  ) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <PartyPopper className="h-4 w-4 text-primary" />
                Profil « {created.name} » prêt
              </DialogTitle>
              <DialogDescription>
                Les nœuds sont en cours de configuration (quelques secondes). Installez dès maintenant le profil sur
                l&apos;appareil :
              </DialogDescription>
            </DialogHeader>
            <ConfigPanel profileName={created.name} config={created.config} complete={created.hasPrivateKey} />
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Terminer</Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Nouveau profil VPN</DialogTitle>
              <DialogDescription>Un profil = un appareil ou une personne qui se connecte à votre flotte.</DialogDescription>
              <ol className="flex gap-2 pt-3">
                {STEPS.map((item, index) => (
                  <li key={item.id} className="flex flex-1 flex-col gap-1.5">
                    <span className={cn('h-1 rounded-full transition-colors', index <= step ? 'bg-primary' : 'bg-surface-3')} />
                    <span className={cn('text-2xs', index === step ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                      {index + 1}. {item.title}
                    </span>
                  </li>
                ))}
              </ol>
            </DialogHeader>

            <div className="space-y-5">
              {step === 0 && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="vpn-name">Nom du profil</Label>
                      <Input
                        id="vpn-name"
                        value={name}
                        maxLength={80}
                        autoFocus
                        onChange={(event) => setName(event.target.value)}
                        placeholder="Ex. PC portable de Léa"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="vpn-description">
                        Description <span className="font-normal text-muted-foreground">(facultatif)</span>
                      </Label>
                      <Input
                        id="vpn-description"
                        value={description}
                        maxLength={500}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder="Ex. Accès télétravail"
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="vpn-tags">
                        Libellés <span className="font-normal text-muted-foreground">(facultatif, séparés par des virgules)</span>
                      </Label>
                      <Input
                        id="vpn-tags"
                        value={tags}
                        onChange={(event) => setTags(event.target.value)}
                        placeholder="Ex. Support, Paris"
                        list="vpn-create-tags"
                      />
                      <datalist id="vpn-create-tags">
                        {[...new Set(profiles.flatMap((profile) => profile.tags))].map((tag) => (
                          <option key={tag} value={tag} />
                        ))}
                      </datalist>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Point d&apos;entrée</Label>
                    <p className="text-xs text-muted-foreground">{STEPS[0].hint} Choisissez-le proche de l&apos;utilisateur pour une latence minimale.</p>
                    {gateways.length === 0 ? (
                      <Callout variant="warning">Aucun nœud dans ce workspace. Ajoutez d&apos;abord un nœud depuis la page Nœuds.</Callout>
                    ) : (
                      <NodePicker
                        gateways={gateways}
                        value={entryId}
                        disabledReason={(gateway) => gateway.entryEligibility}
                        meta={(gateway) => (gateway.entryProfiles > 0 ? `${gateway.entryProfiles} profil${gateway.entryProfiles > 1 ? 's' : ''}` : null)}
                        onSelect={(gateway) => {
                          setEntryId(gateway.id);
                          if (exitId === gateway.id) setExitId('');
                        }}
                      />
                    )}
                  </div>
                </>
              )}

              {step === 1 && entry && (
                <>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <ModeOption mode="full" selected={mode === 'full'} onSelect={() => setMode('full')} />
                    <ModeOption mode="private" selected={mode === 'private'} onSelect={() => setMode('private')} />
                  </div>
                  {mode === 'full' && (
                    <div className="space-y-2">
                      <Label>Sortie Internet</Label>
                      <p className="text-xs text-muted-foreground">
                        L&apos;IP publique que verront les sites visités. Vous pourrez la changer à tout moment en un clic,
                        même pendant que l&apos;appareil est connecté.
                      </p>
                      <NodePicker
                        gateways={gateways}
                        value={exitId || entry.id}
                        pinned={[{ gateway: entry, badge: 'Sortie directe' }]}
                        disabledReason={(gateway) => (gateway.id === entry.id ? null : gateway.exitEligibility)}
                        meta={(gateway) => (gateway.exitProfiles > 0 ? `${gateway.exitProfiles} profil${gateway.exitProfiles > 1 ? 's' : ''}` : null)}
                        onSelect={(gateway) => setExitId(gateway.id === entry.id ? '' : gateway.id)}
                        listClassName="max-h-[15rem]"
                      />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Chemin du trafic</Label>
                    {route}
                  </div>
                </>
              )}

              {step === 2 && entry && (
                <AccessEditor value={access} onChange={setAccess} mode={mode} gateways={gateways} profiles={profiles} />
              )}

              {step === 3 && entry && (
                <>
                  <div className="space-y-2">
                    <Label>Récapitulatif</Label>
                    {route}
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="vpn-dns">Serveurs DNS</Label>
                      <Input
                        id="vpn-dns"
                        value={dns}
                        onChange={(event) => setDns(event.target.value)}
                        placeholder={mode === 'full' ? '1.1.1.1, 1.0.0.1 (par défaut)' : 'Aucun (DNS de l’appareil)'}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="vpn-expiry">Expiration</Label>
                      <Select value={expiry} onValueChange={setExpiry}>
                        <SelectTrigger id="vpn-expiry">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {EXPIRY_OPTIONS.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-2xs text-muted-foreground">Un profil expiré est désactivé automatiquement.</p>
                    </div>
                  </div>
                  <div className="space-y-2 rounded-lg border border-border bg-surface-2 p-3">
                    <label className="flex items-start gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={ownKey}
                        onChange={(event) => setOwnKey(event.target.checked)}
                        className="mt-0.5 h-4 w-4 rounded"
                      />
                      <span>
                        Utiliser ma propre clé publique
                        <span className="block text-xs text-muted-foreground">
                          Pour les utilisateurs avancés : la clé privée reste sur l&apos;appareil et Tarmac ne la connaît
                          jamais. Par défaut, Tarmac génère la paire de clés pour vous.
                        </span>
                      </span>
                    </label>
                    {ownKey && (
                      <Input
                        value={publicKey}
                        onChange={(event) => setPublicKey(event.target.value)}
                        placeholder="Clé publique WireGuard (base64, 44 caractères)"
                        className="font-mono text-xs"
                      />
                    )}
                  </div>
                </>
              )}

              {(error || (stepError && step >= 2)) && (
                <Callout variant={error || step === 3 ? 'danger' : 'warning'}>{error ?? stepError}</Callout>
              )}
            </div>

            <DialogFooter className="sm:justify-between">
              <Button variant="ghost" onClick={() => (step === 0 ? onOpenChange(false) : setStep(step - 1))} className="gap-1.5">
                {step > 0 && <ArrowLeft className="h-4 w-4" />}
                {step === 0 ? 'Annuler' : 'Retour'}
              </Button>
              {step < STEPS.length - 1 ? (
                <Button
                  onClick={() => setStep(step + 1)}
                  disabled={Boolean(stepError)}
                  title={stepError ?? undefined}
                  className="gap-1.5"
                >
                  Continuer
                  <ArrowRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button onClick={() => void submit()} disabled={submitting || Boolean(stepError)} className="gap-1.5">
                  {submitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
                  Créer le profil
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
