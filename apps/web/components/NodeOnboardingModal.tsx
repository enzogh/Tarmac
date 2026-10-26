'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, CheckCircle, Copy, Loader2, Plus } from 'lucide-react';
import { api, NodeOnboardingInstallResult, NodeOnboardingStartResult } from '../lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

type NodeRole = 'controller' | 'worker';
type HostProvider = 'ovh' | 'standard';
type Step = 'form' | 'deploy-key' | 'installing' | 'done';

interface NodeOnboardingModalProps {
  onCreated?: () => void;
}

export function NodeOnboardingModal({ onCreated }: NodeOnboardingModalProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('form');

  const [name, setName] = useState('storage-1');
  const [role, setRole] = useState<NodeRole>('worker');
  const [provider, setProvider] = useState<HostProvider>('ovh');
  const [hostIp, setHostIp] = useState('');
  const [sshUsername, setSshUsername] = useState('ubuntu');
  const [sshPassword, setSshPassword] = useState('');
  const [repoUrl, setRepoUrl] = useState('git@github.com:enzogh/Tarmac.git');
  const [repoRef, setRepoRef] = useState('main');

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
    setRole('worker');
    setProvider('ovh');
    setHostIp('');
    setSshUsername('ubuntu');
    setSshPassword('');
    setRepoUrl('git@github.com:enzogh/Tarmac.git');
    setRepoRef('main');
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

  const handleStart = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const result = await api.nodes.onboardingStart({
        name: name.trim(),
        role,
        provider,
        hostIp: hostIp.trim(),
        sshUsername: sshUsername.trim(),
        sshPassword,
        repoUrl: repoUrl.trim(),
        repoRef: repoRef.trim(),
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
                  <Select value={role} onValueChange={(value) => setRole(value as NodeRole)}>
                    <SelectTrigger id="node-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="worker">Worker</SelectItem>
                      <SelectItem value="controller">Controller</SelectItem>
                    </SelectContent>
                  </Select>
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
                <div className="space-y-2">
                  <Label htmlFor="ssh-user">Utilisateur SSH</Label>
                  <Input id="ssh-user" value={sshUsername} onChange={(e) => setSshUsername(e.target.value)} required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ssh-password">Mot de passe SSH</Label>
                  <Input
                    id="ssh-password"
                    type="password"
                    value={sshPassword}
                    onChange={(e) => setSshPassword(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="repo-url">Repository agent</Label>
                  <Input id="repo-url" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} required />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="repo-ref">Branch / ref</Label>
                  <Input id="repo-ref" value={repoRef} onChange={(e) => setRepoRef(e.target.value)} required />
                </div>
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
                  Ajoute la clé ci-dessous dans GitHub &gt; Settings &gt; Deploy keys (read-only suffit).
                </p>
              </div>

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

              {error && <p className="text-sm text-rose-400">{error}</p>}

              <DialogFooter>
                <Button type="button" variant="secondary" onClick={reset}>
                  Recommencer
                </Button>
                <Button type="button" onClick={handleInstall} disabled={loading}>
                  J’ai ajouté la clé sur GitHub
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
