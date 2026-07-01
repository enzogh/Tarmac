'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, SyncJobItem, NodeItem } from '../../../lib/api';
import { DashboardLayout } from '../../../components/DashboardLayout';
import { Card, Badge } from '../../../components/ui';
import { Modal } from '../../../components/Modal';

export default function ReplicationPage() {
  const router = useRouter();
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null), []);

  const [syncJobs, setSyncJobs] = useState<SyncJobItem[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);

  // Form states
  const [syncJobName, setSyncJobName] = useState('');
  const [syncJobSource, setSyncJobSource] = useState('');
  const [syncJobTarget, setSyncJobTarget] = useState('');
  const [syncJobSchedule, setSyncJobSchedule] = useState('manual');
  const [syncJobNodeId, setSyncJobNodeId] = useState('');

  const load = async () => {
    if (!token) return;
    try {
      const [sj, n] = await Promise.all([
        api.syncJobs.list(token),
        api.nodes.list(token),
      ]);
      setSyncJobs(sj);
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

  const createSyncJob = async (e: FormEvent, close: () => void) => {
    e.preventDefault();
    if (!token) return;
    await api.syncJobs.create(token, {
      name: syncJobName,
      sourcePath: syncJobSource,
      targetPath: syncJobTarget,
      schedule: syncJobSchedule,
      nodeId: syncJobNodeId || undefined,
    });
    setSyncJobName('');
    setSyncJobSource('');
    setSyncJobTarget('');
    setSyncJobSchedule('manual');
    setSyncJobNodeId('');
    await load();
    close();
  };

  const runSync = async (jobId: string) => {
    if (!token) return;
    await api.syncJobs.run(token, jobId);
    await load();
  };

  return (
    <DashboardLayout>
      <div>
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-slate-100">🔄 Réplication</h1>
          <p className="text-slate-400">Synchronisation de données entre serveurs</p>
        </div>

        <Card title="Travaux de synchronisation">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-slate-400">
              <strong>Qu'est-ce qu'un travail de sync ?</strong> Une tâche qui copie automatiquement des données 
              d'une source à une destination. Utile pour les sauvegardes ou la réplication.
            </p>
            <Modal
              title="Créer un travail de sync"
              trigger="➕ Nouveau travail"
            >
              {(close) => (
                <form onSubmit={(e) => createSyncJob(e, close)} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Nom du travail</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="ex: backup-daily"
                      value={syncJobName}
                      onChange={(e) => setSyncJobName(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Dossier source</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="ex: /data/important"
                      value={syncJobSource}
                      onChange={(e) => setSyncJobSource(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Dossier destination</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="ex: /backup/important"
                      value={syncJobTarget}
                      onChange={(e) => setSyncJobTarget(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Programmation</label>
                    <select
                      className="select"
                      value={syncJobSchedule}
                      onChange={(e) => setSyncJobSchedule(e.target.value)}
                    >
                      <option value="manual">⏱️ Manuel</option>
                      <option value="hourly">⏰ Toutes les heures</option>
                      <option value="daily">📅 Tous les jours</option>
                      <option value="weekly">📆 Toutes les semaines</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Nœud (optionnel)</label>
                    <select
                      className="select"
                      value={syncJobNodeId}
                      onChange={(e) => setSyncJobNodeId(e.target.value)}
                    >
                      <option value="">Automatique</option>
                      {nodes.map((n) => (
                        <option key={n.id} value={n.id}>
                          {n.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button type="submit" className="btn-primary w-full">
                    Créer travail
                  </button>
                </form>
              )}
            </Modal>
          </div>

          <div className="space-y-3">
            {syncJobs.map((job) => (
              <div key={job.id} className="p-4 bg-slate-800 rounded-lg border border-slate-700 hover:border-slate-600 transition-colors">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h4 className="font-semibold text-slate-100">{job.name}</h4>
                    <p className="text-xs text-slate-400 mt-1">{job.sourcePath} → {job.targetPath}</p>
                  </div>
                  <Badge label={job.status} type="info" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-400">Schedule: {job.schedule}</span>
                  <button
                    onClick={() => runSync(job.id)}
                    className="btn-secondary text-sm"
                  >
                    ▶️ Exécuter maintenant
                  </button>
                </div>
              </div>
            ))}
            {syncJobs.length === 0 && (
              <p className="text-center text-slate-400 py-8">Aucun travail de synchronisation</p>
            )}
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}
