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

  return (
    <DashboardLayout>
      <div className="space-y-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="page-heading">Infrastructure</h1>
            <p className="page-subtitle">Gestion des nœuds et des pools de stockage.</p>
          </div>
          <NodeOnboardingModal />
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

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
