'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, MigrationItem, NodeItem } from '../../../lib/api';
import { DashboardLayout } from '../../../components/DashboardLayout';
import { Card, Badge } from '../../../components/ui';
import { Modal } from '../../../components/Modal';

export default function MigrationsPage() {
  const router = useRouter();
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null), []);

  const [migrations, setMigrations] = useState<MigrationItem[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);

  // Form states
  const [migrationName, setMigrationName] = useState('');
  const [migrationSourceNodeId, setMigrationSourceNodeId] = useState('');
  const [migrationTargetNodeId, setMigrationTargetNodeId] = useState('');

  const load = async () => {
    if (!token) return;
    try {
      const [mg, n] = await Promise.all([
        api.migrations.list(token),
        api.nodes.list(token),
      ]);
      setMigrations(mg);
      setNodes(n);
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

  const createMigration = async (e: FormEvent, close: () => void) => {
    e.preventDefault();
    if (!token) return;
    await api.migrations.create(token, {
      name: migrationName,
      sourceNodeId: migrationSourceNodeId || undefined,
      targetNodeId: migrationTargetNodeId || undefined,
    });
    setMigrationName('');
    setMigrationSourceNodeId('');
    setMigrationTargetNodeId('');
    await load();
    close();
  };

  const startMigration = async (migrationId: string) => {
    if (!token) return;
    await api.migrations.start(token, migrationId);
    await load();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'success';
      case 'running':
        return 'info';
      case 'failed':
        return 'error';
      default:
        return 'info';
    }
  };

  return (
    <DashboardLayout>
      <div>
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-slate-100">➡️ Migrations</h1>
          <p className="text-slate-400">Déplacement de données entre nœuds</p>
        </div>

        <Card title="Migrations de données">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-slate-400">
              <strong>Qu'est-ce qu'une migration ?</strong> Une opération qui déplace vos données 
              d'un serveur source à un serveur destination. Utile pour les maintenances ou rééquilibrages.
            </p>
            <Modal
              title="Créer une migration"
              trigger="➕ Nouvelle migration"
            >
              {(close) => (
                <form onSubmit={(e) => createMigration(e, close)} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Nom de la migration</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="ex: Migration storage-1 vers storage-2"
                      value={migrationName}
                      onChange={(e) => setMigrationName(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Nœud source</label>
                    <select
                      className="select"
                      value={migrationSourceNodeId}
                      onChange={(e) => setMigrationSourceNodeId(e.target.value)}
                    >
                      <option value="">Sélectionner une source</option>
                      {nodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Nœud destination</label>
                    <select
                      className="select"
                      value={migrationTargetNodeId}
                      onChange={(e) => setMigrationTargetNodeId(e.target.value)}
                    >
                      <option value="">Sélectionner une destination</option>
                      {nodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" className="btn-primary w-full">
                    Créer migration
                  </button>
                </form>
              )}
            </Modal>
          </div>

          <div className="space-y-4">
            {migrations.map((migration) => (
              <div key={migration.id} className="p-4 bg-slate-800 rounded-lg border border-slate-700">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <h4 className="font-semibold text-slate-100">{migration.name}</h4>
                    <p className="text-xs text-slate-400 mt-1">
                      Création: {new Date(migration.createdAt).toLocaleString('fr-FR')}
                    </p>
                  </div>
                  <Badge label={migration.status} type={getStatusColor(migration.status)} />
                </div>

                {/* Progress bar */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-slate-300">Progression</span>
                    <span className="text-sm text-slate-400">{migration.progress}%</span>
                  </div>
                  <div className="w-full bg-slate-700 rounded-full h-3 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-blue-600 to-blue-400 h-full transition-all duration-300"
                      style={{ width: `${migration.progress}%` }}
                    />
                  </div>
                </div>

                {/* Action button */}
                {migration.status === 'pending' && (
                  <button
                    onClick={() => startMigration(migration.id)}
                    className="btn-primary w-full"
                  >
                    ▶️ Démarrer la migration
                  </button>
                )}
                {migration.status === 'running' && (
                  <div className="text-center text-slate-400">
                    ⏳ Migration en cours...
                  </div>
                )}
                {migration.status === 'completed' && (
                  <div className="text-center text-green-400">
                    ✅ Migration terminée avec succès
                  </div>
                )}
              </div>
            ))}
            {migrations.length === 0 && (
              <p className="text-center text-slate-400 py-8">Aucune migration</p>
            )}
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
