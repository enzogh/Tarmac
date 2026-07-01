'use client';

import { useEffect, useMemo, useState } from 'react';
import { Modal } from './Modal';

type NodeRole = 'controller' | 'worker';

function escapeSingleQuotes(value: string) {
  return value.replace(/'/g, `'\"'\"'`);
}

function buildNodeScript(params: {
  apiUrl: string;
  token: string;
  name: string;
  role: NodeRole;
}) {
  const { apiUrl, token, name, role } = params;

  return `#!/usr/bin/env bash
set -euo pipefail

API_URL="${apiUrl}"
export TARMAC_TOKEN='${escapeSingleQuotes(token)}'

curl -sS -X POST "\${API_URL}/api/v1/nodes" \
  -H "Authorization: Bearer \${TARMAC_TOKEN}" \
  -H "Content-Type: application/json" \
  --data-binary @- <<'JSON'
{
  "name": "${name}",
  "role": "${role}",
  "status": "offline"
}
JSON

echo "Node ${name} registered."
`;
}

export function NodeOnboardingModal() {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
  const [name, setName] = useState('storage-1');
  const [role, setRole] = useState<NodeRole>('worker');
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [token, setToken] = useState('');

  useEffect(() => {
    setToken(localStorage.getItem('tarmac_token') ?? '');
  }, []);

  const script = useMemo(
    () =>
      buildNodeScript({
        apiUrl,
        token: token || 'paste-your-dashboard-token',
        name,
        role,
      }),
    [apiUrl, name, role, token],
  );

  useEffect(() => {
    if (copyState !== 'copied') return undefined;

    const id = window.setTimeout(() => setCopyState('idle'), 1800);
    return () => window.clearTimeout(id);
  }, [copyState]);

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(script);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  };

  return (
    <Modal title="Onboarding d'un nœud" trigger="➕ Onboarder un nœud">
      {(close) => (
        <div className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-300">Nom du nœud</span>
              <input
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="storage-1"
              />
            </label>

            <label className="space-y-2">
              <span className="text-sm font-medium text-slate-300">Rôle</span>
              <select className="select" value={role} onChange={(e) => setRole(e.target.value as NodeRole)}>
                <option value="worker">Worker</option>
                <option value="controller">Controller</option>
              </select>
            </label>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-50">Script bash prêt à coller</p>
                <p className="text-xs text-slate-400">
                  Colle ce script dans le terminal du serveur à onboarder.
                </p>
              </div>
              <button type="button" onClick={copyScript} className="btn-secondary">
                {copyState === 'copied' ? 'Copié' : copyState === 'error' ? 'Erreur' : 'Copier le script'}
              </button>
            </div>

            <pre className="code-block whitespace-pre-wrap break-words">{script}</pre>
            {!token && (
              <p className="mt-3 text-xs text-amber-300">
                Aucun token trouvé dans le navigateur. Le script contient un placeholder à remplacer.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-slate-400">
              Le script appelle directement l'API pour enregistrer le nœud avec le bon rôle.
            </p>
            <button type="button" onClick={close} className="btn-primary">
              Terminer
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
