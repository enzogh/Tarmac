'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, NodeItem, PoolItem } from '../../../lib/api';
import { DashboardLayout } from '../../../components/DashboardLayout';
import { Card, Badge } from '../../../components/ui';
import { Modal } from '../../../components/Modal';
import { NodeOnboardingModal } from '../../../components/NodeOnboardingModal';

export default function InfrastructurePage() {
  const router = useRouter();
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null), []);

  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [pools, setPools] = useState<PoolItem[]>([]);

  const [poolName, setPoolName] = useState('');
  const [poolStrategy, setPoolStrategy] = useState('mirror');

  // Edit node state
  const [editNode, setEditNode] = useState<NodeItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  const load = async () => {
    if (!token) return;
    try {
      const [n, p] = await Promise.all([
        api.nodes.list(token),
        api.pools.list(token),
      ]);
      setNodes(n);
      setPools(p);
    } catch {
      localStorage.removeItem('tarmac_token');
      router.push('/login');
    }
  };

  useEffect(() => {
    if (!token) {
      router.push('/login');
      return;
    }
    void load();
    const id = setInterval(() => {
      void load();
    }, 5000);
    return () => clearInterval(id);
  }, [token]);

  const createPool = async (e: FormEvent, close: () => void) => {
    e.preventDefault();
    if (!token) return;
    await api.pools.create(token, { name: poolName, strategy: poolStrategy });
    setPoolName('');
    setPoolStrategy('mirror');
    await load();
    close();
  };

  const deleteNode = async (node: NodeItem) => {
    if (!token) return;
    if (!confirm(`Supprimer le nœud « ${node.name} » ? Cette action est irréversible.`)) return;
    await api.nodes.delete(token, node.id);
    await load();
  };

  const openEditModal = (node: NodeItem) => {
    setEditNode(node);
    setEditName(node.name);
    setEditRole(node.role);
  };

  const saveEditNode = async (e: FormEvent, close: () => void) => {
    e.preventDefault();
    if (!token || !editNode) return;
    setEditLoading(true);
    try {
      await api.nodes.update(token, editNode.id, { name: editName, role: editRole });
      await load();
      close();
    } finally {
      setEditLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="page-heading">Infrastructure</h1>
            <p className="page-subtitle">Gestion des nœuds et des pools de stockage.</p>
          </div>
          <NodeOnboardingModal onCreated={load} />
        </div>

        {/* Nodes Section */}
        <Card title="Nœuds (Serveurs)">
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <p className="max-w-3xl text-sm text-slate-400">
              <strong>Qu'est-ce qu'un nœud ?</strong> Un serveur qui exécute Tarmac et stocke vos données. 
              Chaque nœud peut être un <strong>worker</strong> (stockage) ou un <strong>controller</strong> (gestion).
            </p>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-white/8">
            <table className="table">
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Rôle</th>
                  <th>Statut</th>
                  <th>Vu pour la dernière fois</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((node) => (
                  <tr key={node.id} className="transition-colors hover:bg-white/[0.03]">
                    <td className="font-medium">{node.name}</td>
                    <td className="text-slate-400">
                      {node.role === 'worker' ? '🖥️ Worker' : '⚙️ Controller'}
                    </td>
                    <td>
                      <Badge
                        label={node.status}
                        type={node.status === 'online' ? 'success' : 'error'}
                      />
                    </td>
                    <td className="text-slate-400 text-sm">
                      {node.lastSeenAt
                        ? new Date(node.lastSeenAt).toLocaleString('fr-FR')
                        : '-'}
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEditModal(node)}
                          className="btn-ghost text-xs px-2 py-1"
                          title="Modifier"
                        >
                          ✏️
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteNode(node)}
                          className="btn-ghost text-xs px-2 py-1 text-red-400 hover:text-red-300"
                          title="Supprimer"
                        >
                          🗑️
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {nodes.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center text-slate-500 py-6">
                      Aucun nœud enregistré. Cliquez sur « Onboarder un nœud » pour commencer.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Edit Node Modal (controlled outside Modal component) */}
        {editNode && (
          <div className="modal-backdrop flex items-center justify-center p-4">
            <div className="modal-panel">
              <div className="mb-5 flex items-center justify-between gap-4">
                <h3 className="text-lg font-semibold tracking-tight text-slate-50">
                  Modifier « {editNode.name} »
                </h3>
                <button
                  type="button"
                  onClick={() => setEditNode(null)}
                  className="btn-ghost h-9 w-9 rounded-full p-0"
                  aria-label="Fermer"
                >
                  ×
                </button>
              </div>
              <form
                onSubmit={(e) => saveEditNode(e, () => setEditNode(null))}
                className="space-y-4"
              >
                <div>
                  <label className="block text-sm font-medium mb-2">Nom du nœud</label>
                  <input
                    className="input"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Rôle</label>
                  <select
                    className="select"
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value)}
                  >
                    <option value="worker">🖥️ Worker</option>
                    <option value="controller">⚙️ Controller</option>
                  </select>
                </div>
                <div className="flex justify-end gap-3">
                  <button type="button" onClick={() => setEditNode(null)} className="btn-secondary">
                    Annuler
                  </button>
                  <button type="submit" className="btn-primary" disabled={editLoading}>
                    {editLoading ? 'Sauvegarde…' : 'Sauvegarder'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Pools Section */}
        <Card title="Pools de stockage">
          <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <p className="max-w-3xl text-sm text-slate-400">
              <strong>Qu'est-ce qu'un pool ?</strong> Un groupe de disques fonctionnant ensemble selon une 
              <strong> stratégie</strong> (mirror = copie, raid = distribution, etc).
            </p>
            <Modal
              title="Créer un pool"
              trigger="➕ Nouveau pool"
            >
              {(close) => (
                <form onSubmit={(e) => createPool(e, close)} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Nom du pool</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="ex: pool-data"
                      value={poolName}
                      onChange={(e) => setPoolName(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Stratégie</label>
                    <select
                      className="select"
                      value={poolStrategy}
                      onChange={(e) => setPoolStrategy(e.target.value)}
                    >
                      <option value="mirror">🪞 Mirror (Copie)</option>
                      <option value="raid">⚙️ RAID (Distribution)</option>
                      <option value="single">📁 Single (Stockage simple)</option>
                    </select>
                  </div>
                  <button type="submit" className="btn-primary w-full">
                    Créer pool
                  </button>
                </form>
              )}
            </Modal>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {pools.map((pool) => (
              <div key={pool.id} className="rounded-2xl border border-white/8 bg-white/[0.03] p-4 transition-colors hover:bg-white/[0.05]">
                <div className="mb-3 flex items-start justify-between">
                  <h4 className="font-semibold text-slate-100">{pool.name}</h4>
                  <Badge label={pool.status} type="info" />
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Stratégie</span>
                    <span className="font-medium text-slate-200">{pool.strategy}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Membres</span>
                    <span className="font-medium text-slate-200">{pool.members.length}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
