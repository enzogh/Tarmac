'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, CheckCircle, Copy, FileKey, KeyRound, Loader2, Plus, Upload } from 'lucide-react';
import { api, NodeOnboardingInstallResult, NodeOnboardingStartResult } from '../lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

type HostProvider = 'ovh' | 'standard';
type AuthMethod = 'password' | 'key';
type Step = 'form' | 'deploy-key' | 'installing' | 'done';

interface NodeOnboardingModalProps {
  onCreated?: () => void;
}

export function NodeOnboardingModal({ onCreated }: NodeOnboardingModalProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('form');

  const [name, setName] = useState('storage-1');
  const [provider, setProvider] = useState<HostProvider>('ovh');
  const [hostIp, setHostIp] = useState('');
  const [sshUsername, setSshUsername] = useState('ubuntu');
  const [authMethod, setAuthMethod] = useState<AuthMethod>('password');
  const [sshPassword, setSshPassword] = useState('');
  const [sshPrivateKey, setSshPrivateKey] = useState('');
  const [keyFileName, setKeyFileName] = useState('');
  const [sshKeyPassphrase, setSshKeyPassphrase] = useState('');
  const [sudoPassword, setSudoPassword] = useState('');
  const keyFileInput = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [onboarding, setOnboarding] = useState<NodeOnboardingStartResult | null>(null);
  const [installResult, setInstallResult] = useState<NodeOnboardingInstallResult | null>(null);

  useEffect(() => {
    if (copyState !== 'copied') return;
    const id = window.setTimeout(() => setCopyState('idle'), 1600);
    return () => window.clearTimeout(id);
  }, [copyState]);

  useEffect(() => {
    if (provider === 'ovh' && sshUsername === 'root') {
      setSshUsername('ubuntu');
    }
    if (provider === 'standard' && sshUsername === 'ubuntu') {
      setSshUsername('root');
    }
  }, [provider, sshUsername]);

  const reset = () => {
    setStep('form');
    setName('storage-1');
    setProvider('ovh');
    setHostIp('');
    setSshUsername('ubuntu');
    setAuthMethod('password');
    setSshPassword('');
    setSshPrivateKey('');
    setKeyFileName('');
    setSshKeyPassphrase('');
    setSudoPassword('');
    setError('');
    setLoading(false);
    setCopyState('idle');
    setOnboarding(null);
    setInstallResult(null);
  };

  const onOpenChange = (value: boolean) => {
    setOpen(value);
    if (!value) reset();
  };

  const effectiveProviderLabel = useMemo(
    () =>
      provider === 'ovh'
        ? 'OVH: connexion SSH user + élévation root via sudo'
        : 'Standard: exécution directe avec l’utilisateur SSH fourni',
    [provider],
  );

  const handleKeyFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 64 * 1024) {
      setError('Ce fichier est trop volumineux pour être une clé SSH.');
      return;
    }
    setError('');
    setSshPrivateKey(await file.text());
    setKeyFileName(file.name);
  };

  const handleStart = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await api.nodes.onboardingStart({
        name: name.trim(),
        provider,
        hostIp: hostIp.trim(),
        sshUsername: sshUsername.trim(),
        ...(authMethod === 'password'
          ? { authMethod, sshPassword }
          : {
              authMethod,
              sshPrivateKey,
              sshKeyPassphrase: sshKeyPassphrase || undefined,
              sudoPassword: provider === 'ovh' && sudoPassword ? sudoPassword : undefined,
            }),
      });
      setOnboarding(result);
      setStep('deploy-key');
      onCreated?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Impossible de démarrer l’onboarding.');
    } finally {
      setLoading(false);
    }
  };

  const handleInstall = async () => {
    if (!onboarding) return;
    setLoading(true);
    setError('');
    setStep('installing');
    try {
      const result = await api.nodes.onboardingInstall(onboarding.onboardingId);
      setInstallResult(result);
      setStep('done');
      onCreated?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Installation distante échouée.');
      setStep('deploy-key');
    } finally {
      setLoading(false);
    }
  };

  const copyPublicKey = async () => {
    if (!onboarding?.githubDeployKey.publicKey) return;
    try {
      await navigator.clipboard.writeText(onboarding.githubDeployKey.publicKey);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button write onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            Onboarder un nœud
          </Button>
        </TooltipTrigger>
        <TooltipContent>Onboarding auto: SSH + clé GitHub + install agent</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Onboarding automatisé d’un nœud</DialogTitle>
          </DialogHeader>

          {step === 'form' && (
            <form className="space-y-4" onSubmit={handleStart}>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="node-name">Nom du nœud</Label>
                  <Input id="node-name" value={name} onChange={(e) => setName(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="node-role">Rôle</Label>
                  <Input id="node-role" value="Worker" readOnly disabled aria-readonly="true" title="Les nœuds ajoutés ici sont toujours des workers." />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="provider">Hébergeur</Label>
                  <Select value={provider} onValueChange={(value) => setProvider(value as HostProvider)}>
                    <SelectTrigger id="provider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ovh">OVH</SelectItem>
                      <SelectItem value="standard">Standard</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="host-ip">IP serveur</Label>
                  <Input id="host-ip" value={hostIp} onChange={(e) => setHostIp(e.target.value)} placeholder="10.0.0.10" required />
                </div>
              </div>

              <div className="space-y-3 rounded-xl border border-border bg-zinc-900/40 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-foreground">Authentification SSH</p>
                  <Tabs value={authMethod} onValueChange={(value) => setAuthMethod(value as AuthMethod)}>
                    <TabsList variant="segmented" aria-label="Méthode d’authentification SSH">
                      <TabsTrigger value="password">
                        <KeyRound className="h-3.5 w-3.5" /> Mot de passe
                      </TabsTrigger>
                      <TabsTrigger value="key">
                        <FileKey className="h-3.5 w-3.5" /> Clé SSH
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="ssh-user">Utilisateur SSH</Label>
                    <Input id="ssh-user" value={sshUsername} onChange={(e) => setSshUsername(e.target.value)} required />
                  </div>
                  {authMethod === 'password' ? (
                    <div className="space-y-2">
                      <Label htmlFor="ssh-password">Mot de passe SSH</Label>
                      <Input
                        id="ssh-password"
                        type="password"
                        autoComplete="off"
                        value={sshPassword}
                        onChange={(e) => setSshPassword(e.target.value)}
                        required
                      />
                      {provider === 'ovh' && (
                        <p className="text-xs text-muted-foreground">Utilisé aussi pour sudo.</p>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label htmlFor="ssh-key-passphrase">
                        Phrase de passe <span className="font-normal text-muted-foreground">(si la clé est chiffrée)</span>
                      </Label>
                      <Input
                        id="ssh-key-passphrase"
                        type="password"
                        autoComplete="off"
                        value={sshKeyPassphrase}
                        onChange={(e) => setSshKeyPassphrase(e.target.value)}
                      />
                    </div>
                  )}
                </div>

                {authMethod === 'key' && (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <Label htmlFor="ssh-private-key">Clé privée</Label>
                        <input
                          ref={keyFileInput}
                          type="file"
                          className="hidden"
                          onChange={handleKeyFile}
                        />
                        <Button type="button" variant="secondary" size="sm" onClick={() => keyFileInput.current?.click()}>
                          <Upload className="h-3.5 w-3.5" /> Importer un fichier
                        </Button>
                      </div>
                      <textarea
                        id="ssh-private-key"
                        value={sshPrivateKey}
                        onChange={(e) => {
                          setSshPrivateKey(e.target.value);
                          setKeyFileName('');
                        }}
                        placeholder={'-----BEGIN OPENSSH PRIVATE KEY-----\n…\n-----END OPENSSH PRIVATE KEY-----'}
                        spellCheck={false}
                        autoComplete="off"
                        required
                        rows={5}
                        className="flex w-full resize-y rounded-lg border border-border bg-zinc-950/70 px-3 py-2 font-mono text-xs text-foreground shadow-insetSoft transition-colors placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <p className="text-xs text-muted-foreground">
                        {keyFileName
                          ? <>Clé chargée depuis <code>{keyFileName}</code>.</>
                          : <>Collez la clé privée (par exemple <code>~/.ssh/id_ed25519</code>), pas le fichier <code>.pub</code>. Sa clé publique doit figurer dans <code>authorized_keys</code> sur le serveur.</>}
                      </p>
                    </div>
                    {provider === 'ovh' && (
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="sudo-password">
                            Mot de passe sudo <span className="font-normal text-muted-foreground">(facultatif)</span>
                          </Label>
                          <Input
                            id="sudo-password"
                            type="password"
                            autoComplete="off"
                            value={sudoPassword}
                            onChange={(e) => setSudoPassword(e.target.value)}
                          />
                          <p className="text-xs text-muted-foreground">
                            À laisser vide si {sshUsername.trim() || 'l’utilisateur'} peut utiliser sudo sans mot de passe.
                          </p>
                        </div>
                      </div>
                    )}
                  </>
                )}

                <p className="text-xs text-muted-foreground">
                  Ces identifiants servent uniquement à l’installation et ne sont jamais enregistrés.
                </p>
              </div>

              <p className="text-xs text-muted-foreground">{effectiveProviderLabel}</p>

              {error && <p className="text-sm text-rose-400">{error}</p>}

              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
                  Annuler
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? 'Initialisation…' : 'Démarrer onboarding'}
                </Button>
              </DialogFooter>
            </form>
          )}

          {step === 'deploy-key' && onboarding && (
            <div className="space-y-4">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
                <p className="text-sm font-medium text-emerald-200">
                  Nœud créé: <strong>{onboarding.node.name}</strong> ({onboarding.node.id})
                </p>
                <p className="mt-1 text-xs text-emerald-100/80">
                  {onboarding.githubDeployKey.registered
                    ? 'Sa clé de déploiement a été ajoutée automatiquement au dépôt GitHub, en lecture seule. Il ne reste qu’à installer l’agent.'
                    : 'Ajoute la clé ci-dessous dans GitHub > Settings > Deploy keys (read-only suffit).'}
                </p>
              </div>
              {onboarding.githubDeployKey.registrationError && (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                  L’ajout automatique sur GitHub a échoué : {onboarding.githubDeployKey.registrationError} Ajoute la clé à la main.
                </p>
              )}

              {!onboarding.githubDeployKey.registered && (
                <div className="space-y-2 rounded-xl border border-border bg-zinc-900/60 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground">Clé publique deploy</p>
                    <Button type="button" variant="secondary" size="sm" onClick={copyPublicKey}>
                      {copyState === 'copied' ? (
                        <>
                          <Check className="h-3.5 w-3.5" /> Copié
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" /> Copier
                        </>
              )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Titre suggéré: <code>{onboarding.githubDeployKey.title}</code>
                </p>
                <pre className="code-block whitespace-pre-wrap break-all">
                  {onboarding.githubDeployKey.publicKey}
                </pre>
              </div>
              )}

              {error && <p className="text-sm text-rose-400">{error}</p>}

              <DialogFooter>
                <Button type="button" variant="secondary" onClick={reset}>
                  Recommencer
                </Button>
                <Button type="button" onClick={handleInstall} disabled={loading}>
                  {onboarding.githubDeployKey.registered ? 'Installer l’agent' : 'J’ai ajouté la clé sur GitHub'}
                </Button>
              </DialogFooter>
            </div>
          )}

          {step === 'installing' && (
            <div className="space-y-3 py-4">
              <div className="flex items-center gap-2 text-sm text-foreground/90">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                Installation automatique en cours sur le serveur distant…
              </div>
              <p className="text-xs text-muted-foreground">
                Actions: création <code>~/.apps/Tarmac</code>, pull repo, installation service agent et démarrage.
              </p>
            </div>
          )}

          {step === 'done' && installResult && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
                <CheckCircle className="mt-0.5 h-4 w-4 text-emerald-400" />
                <div>
                  <p className="text-sm font-medium text-emerald-200">
                    Agent installé sur {installResult.nodeName}
                  </p>
                  <p className="text-xs text-emerald-100/80">Service tarmac-agent démarré.</p>
                </div>
              </div>

              <pre className="max-h-56 overflow-auto rounded-xl border border-border bg-zinc-950/70 p-3 text-xs text-zinc-300">
                {installResult.output}
              </pre>

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <DialogFooter>
                <Button type="button" variant="secondary" onClick={reset}>
                  Ajouter un autre
                </Button>
                <Button type="button" onClick={() => onOpenChange(false)}>
                  Terminer
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
