'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Plus, CheckCircle, Copy, Check, AlertTriangle } from 'lucide-react';
import { api, NodeItem } from '../lib/api';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from './ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

type NodeRole = 'controller' | 'worker';

function buildDaemonCommand(params: {
  wsUrl: string;
  nodeId: string;
}) {
  const { wsUrl, nodeId } = params;
  return `NODE_ID="${nodeId}" \\
AGENT_TOKEN="<AGENT_SHARED_TOKEN>" \\
CONTROL_PLANE_WS="${wsUrl}" \\
./tarmac-agent`;
}

function buildDockerCommand(params: {
  wsUrl: string;
  nodeId: string;
}) {
  const { wsUrl, nodeId } = params;
  return `docker run -d \\
  --name tarmac-agent \\
  --restart=unless-stopped \\
  -e NODE_ID="${nodeId}" \\
  -e AGENT_TOKEN="<AGENT_SHARED_TOKEN>" \\
  -e CONTROL_PLANE_WS="${wsUrl}" \\
  ghcr.io/enzogh/tarmac/agent:latest`;
}

function buildSystemdInstallCommand(params: {
  wsUrl: string;
  nodeId: string;
}) {
  const { wsUrl, nodeId } = params;
  return `curl -fsSL https://raw.githubusercontent.com/enzogh/Tarmac/main/apps/agent/scripts/install-agent-service.sh | sudo bash -s -- \\
  --node-id "${nodeId}" \\
  --control-plane-ws "${wsUrl}" \\
  --agent-token "<AGENT_SHARED_TOKEN>"`;
}

type Step = 'form' | 'command';

interface NodeOnboardingModalProps {
  onCreated?: () => void;
}

export function NodeOnboardingModal({ onCreated }: NodeOnboardingModalProps) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const wsUrl = apiUrl.replace(/^http/, 'ws') + '/agents-ws';

  const [open, setOpen] = useState(false);
  const [name, setName] = useState('storage-1');
  const [role, setRole] = useState<NodeRole>('worker');
  const [step, setStep] = useState<Step>('form');
  const [createdNode, setCreatedNode] = useState<NodeItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [copyDockerState, setCopyDockerState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [copySystemdState, setCopySystemdState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [token, setToken] = useState('');

  useEffect(() => {
    setToken(localStorage.getItem('tarmac_token') ?? '');
  }, []);

  useEffect(() => {
    if (copyState !== 'copied') return undefined;
    const id = window.setTimeout(() => setCopyState('idle'), 1800);
    return () => window.clearTimeout(id);
  }, [copyState]);

  useEffect(() => {
    if (copyDockerState !== 'copied') return undefined;
    const id = window.setTimeout(() => setCopyDockerState('idle'), 1800);
    return () => window.clearTimeout(id);
  }, [copyDockerState]);

  useEffect(() => {
    if (copySystemdState !== 'copied') return undefined;
    const id = window.setTimeout(() => setCopySystemdState('idle'), 1800);
    return () => window.clearTimeout(id);
  }, [copySystemdState]);

  const resetForm = () => {
    setStep('form');
    setCreatedNode(null);
    setError('');
    setName('storage-1');
    setRole('worker');
    setCopyState('idle');
    setCopyDockerState('idle');
    setCopySystemdState('idle');
  };

  const handleOpenChange = (val: boolean) => {
    setOpen(val);
    if (!val) resetForm();
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) { setError('Token manquant, reconnectez-vous.'); return; }
    setLoading(true);
    setError('');
    try {
      const node = await api.nodes.create(token, { name, role });
      setCreatedNode(node);
      setStep('command');
      onCreated?.();
    } catch {
      setError('Erreur lors de la création du nœud.');
    } finally {
      setLoading(false);
    }
  };

  const copy = async (text: string, setter: (s: 'idle' | 'copied' | 'error') => void) => {
    try {
      await navigator.clipboard.writeText(text);
      setter('copied');
    } catch {
      setter('error');
    }
  };

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            Onboarder un nœud
          </Button>
        </TooltipTrigger>
        <TooltipContent>Enregistrer un nouveau serveur et obtenir la commande de démarrage de l'agent</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Onboarder un nœud</DialogTitle>
          </DialogHeader>

          {step === 'form' && (
            <form onSubmit={handleCreate} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="node-name">Nom du nœud</Label>
                  <Input
                    id="node-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="storage-1"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="node-role">Rôle</Label>
                  <Select value={role} onValueChange={(v) => setRole(v as NodeRole)}>
                    <SelectTrigger id="node-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="worker">Worker</SelectItem>
                      <SelectItem value="controller">Controller</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {error && (
                <p className="text-sm text-rose-400">{error}</p>
              )}

              <DialogFooter>
                <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>
                  Annuler
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading ? 'Création…' : 'Créer le nœud'}
                </Button>
              </DialogFooter>
            </form>
          )}

          {step === 'command' && createdNode && (
            <div className="space-y-5">
              <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
                <CheckCircle className="h-5 w-5 shrink-0 text-emerald-400" />
                <div>
                  <p className="text-sm font-semibold text-emerald-300">Nœud «&nbsp;{createdNode.name}&nbsp;» créé</p>
                  <p className="text-xs text-muted-foreground">
                    ID : <code className="text-foreground">{createdNode.id}</code>
                  </p>
                </div>
              </div>

              <p className="text-sm text-muted-foreground">
                Colle l'une de ces commandes sur le serveur worker pour démarrer l'agent daemon.
              </p>

              {/* Binary */}
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.08] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Ubuntu 22.04 + systemd (auto install)</p>
                    <p className="text-xs text-muted-foreground">Installe les dépendances, compile l'agent, crée un service avec restart auto.</p>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => copy(buildSystemdInstallCommand({ wsUrl, nodeId: createdNode.id }), setCopySystemdState)}
                      >
                        {copySystemdState === 'copied' ? (
                          <><Check className="h-3.5 w-3.5" /> Copié</>
                        ) : (
                          <><Copy className="h-3.5 w-3.5" /> Copier</>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Copier la commande systemd</TooltipContent>
                  </Tooltip>
                </div>
                <pre className="code-block whitespace-pre-wrap break-words">
                  {buildSystemdInstallCommand({ wsUrl, nodeId: createdNode.id })}
                </pre>
              </div>

              {/* Binary */}
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Binaire (recommandé)</p>
                    <p className="text-xs text-muted-foreground">Requiert le binaire <code>tarmac-agent</code>.</p>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => copy(buildDaemonCommand({ wsUrl, nodeId: createdNode.id }), setCopyState)}
                      >
                        {copyState === 'copied' ? (
                          <><Check className="h-3.5 w-3.5" /> Copié</>
                        ) : (
                          <><Copy className="h-3.5 w-3.5" /> Copier</>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Copier la commande dans le presse-papiers</TooltipContent>
                  </Tooltip>
                </div>
                <pre className="code-block whitespace-pre-wrap break-words">
                  {buildDaemonCommand({ wsUrl, nodeId: createdNode.id })}
                </pre>
              </div>

              {/* Docker */}
              <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Docker</p>
                    <p className="text-xs text-muted-foreground">Démarre l'agent en container avec restart automatique.</p>
                  </div>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => copy(buildDockerCommand({ wsUrl, nodeId: createdNode.id }), setCopyDockerState)}
                      >
                        {copyDockerState === 'copied' ? (
                          <><Check className="h-3.5 w-3.5" /> Copié</>
                        ) : (
                          <><Copy className="h-3.5 w-3.5" /> Copier</>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Copier la commande Docker dans le presse-papiers</TooltipContent>
                  </Tooltip>
                </div>
                <pre className="code-block whitespace-pre-wrap break-words">
                  {buildDockerCommand({ wsUrl, nodeId: createdNode.id })}
                </pre>
              </div>

              <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                <p className="text-xs text-amber-300">
                  Remplace <code>&lt;AGENT_SHARED_TOKEN&gt;</code> par la valeur de{' '}
                  <code>AGENT_SHARED_TOKEN</code> configurée sur ton serveur API.
                </p>
              </div>

              <DialogFooter>
                <Button type="button" variant="secondary" onClick={resetForm}>
                  Ajouter un autre
                </Button>
                <Button type="button" onClick={() => handleOpenChange(false)}>
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
