'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, NodeItem } from '../lib/api';
import { Modal } from './Modal';

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

type Step = 'form' | 'command';

interface NodeOnboardingModalProps {
  onCreated?: () => void;
}

export function NodeOnboardingModal({ onCreated }: NodeOnboardingModalProps) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const wsUrl = apiUrl.replace(/^http/, 'ws') + '/agents-ws';

  const [name, setName] = useState('storage-1');
  const [role, setRole] = useState<NodeRole>('worker');
  const [step, setStep] = useState<Step>('form');
  const [createdNode, setCreatedNode] = useState<NodeItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [copyDockerState, setCopyDockerState] = useState<'idle' | 'copied' | 'error'>('idle');
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

  const resetForm = () => {
    setStep('form');
    setCreatedNode(null);
    setError('');
    setName('storage-1');
    setRole('worker');
    setCopyState('idle');
    setCopyDockerState('idle');
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
    <Modal title="Onboarder un nœud" trigger="➕ Onboarder un nœud">
      {(close) => (
        <div className="space-y-6 min-w-[520px]">
          {step === 'form' && (
            <form onSubmit={handleCreate} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-slate-300">Nom du nœud</span>
                  <input
                    className="input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="storage-1"
                    required
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-slate-300">Rôle</span>
                  <select className="select" value={role} onChange={(e) => setRole(e.target.value as NodeRole)}>
                    <option value="worker">🖥️ Worker</option>
                    <option value="controller">⚙️ Controller</option>
                  </select>
                </label>
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <div className="flex justify-end gap-3">
                <button type="button" onClick={close} className="btn-secondary">Annuler</button>
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? 'Création…' : 'Créer le nœud →'}
                </button>
              </div>
            </form>
          )}

          {step === 'command' && createdNode && (
            <div className="space-y-5">
              <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
                <span className="text-emerald-400 text-lg">✓</span>
                <div>
                  <p className="text-sm font-semibold text-emerald-300">Nœud « {createdNode.name} » créé</p>
                  <p className="text-xs text-slate-400">ID : <code className="text-slate-300">{createdNode.id}</code></p>
                </div>
              </div>

              <p className="text-sm text-slate-400">
                Colle l'une de ces commandes sur le serveur worker pour démarrer l'agent daemon qui se connectera au panel en temps réel.
              </p>

              {/* Binary */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-50">Binaire (recommandé)</p>
                    <p className="text-xs text-slate-400">Requiert le binaire <code>tarmac-agent</code> sur le serveur.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => copy(buildDaemonCommand({ wsUrl, nodeId: createdNode.id }), setCopyState)}
                    className="btn-secondary text-xs"
                  >
                    {copyState === 'copied' ? '✓ Copié' : copyState === 'error' ? 'Erreur' : 'Copier'}
                  </button>
                </div>
                <pre className="code-block whitespace-pre-wrap break-words text-xs">
                  {buildDaemonCommand({ wsUrl, nodeId: createdNode.id })}
                </pre>
              </div>

              {/* Docker */}
              <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-50">Docker</p>
                    <p className="text-xs text-slate-400">Démarre l'agent en container avec restart automatique.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => copy(buildDockerCommand({ wsUrl, nodeId: createdNode.id }), setCopyDockerState)}
                    className="btn-secondary text-xs"
                  >
                    {copyDockerState === 'copied' ? '✓ Copié' : copyDockerState === 'error' ? 'Erreur' : 'Copier'}
                  </button>
                </div>
                <pre className="code-block whitespace-pre-wrap break-words text-xs">
                  {buildDockerCommand({ wsUrl, nodeId: createdNode.id })}
                </pre>
              </div>

              <p className="text-xs text-amber-300">
                ⚠️ Remplace <code>&lt;AGENT_SHARED_TOKEN&gt;</code> par la valeur de <code>AGENT_SHARED_TOKEN</code> configurée sur ton serveur API.
              </p>

              <div className="flex justify-end gap-3">
                <button type="button" onClick={resetForm} className="btn-secondary">Ajouter un autre</button>
                <button type="button" onClick={() => { resetForm(); close(); }} className="btn-primary">Terminer</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
