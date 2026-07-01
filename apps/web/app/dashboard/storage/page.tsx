'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ShareItem, MountItem, NodeItem } from '../../../lib/api';
import { DashboardLayout } from '../../../components/DashboardLayout';
import { Card, Badge } from '../../../components/ui';
import { Modal } from '../../../components/Modal';

export default function StoragePage() {
  const router = useRouter();
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null), []);

  const [shares, setShares] = useState<ShareItem[]>([]);
  const [mounts, setMounts] = useState<MountItem[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);

  // Form states
  const [shareName, setShareName] = useState('');
  const [sharePath, setSharePath] = useState('');
  const [shareNodeId, setShareNodeId] = useState('');

  const [mountName, setMountName] = useState('');
  const [mountSource, setMountSource] = useState('');
  const [mountTarget, setMountTarget] = useState('');
  const [mountNodeId, setMountNodeId] = useState('');

  const load = async () => {
    if (!token) return;
    try {
      const [s, m, n] = await Promise.all([
        api.shares.list(token),
        api.mounts.list(token),
        api.nodes.list(token),
      ]);
      setShares(s);
      setMounts(m);
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

  const createShare = async (e: FormEvent, close: () => void) => {
    e.preventDefault();
    if (!token) return;
    await api.shares.create(token, {
      name: shareName,
      path: sharePath,
      nodeId: shareNodeId || undefined,
    });
    setShareName('');
    setSharePath('');
    setShareNodeId('');
    await load();
    close();
  };

  const createMount = async (e: FormEvent, close: () => void) => {
    e.preventDefault();
    if (!token) return;
    await api.mounts.create(token, {
      name: mountName,
      sourcePath: mountSource,
      targetPath: mountTarget,
      nodeId: mountNodeId || undefined,
    });
    setMountName('');
    setMountSource('');
    setMountTarget('');
    setMountNodeId('');
    await load();
    close();
  };

  return (
    <DashboardLayout>
      <div>
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-slate-100">📁 Stockage</h1>
          <p className="text-slate-400">Gestion des partages et des montages</p>
        </div>

        {/* Shares Section */}
        <Card title="Partages NFS/SMB">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-slate-400">
              <strong>Qu'est-ce qu'un partage ?</strong> Un dossier accessible en réseau (NFS pour Linux, SMB pour Windows) 
              que d'autres ordinateurs peuvent utiliser.
            </p>
            <Modal
              title="Créer un partage"
              trigger="➕ Nouveau partage"
            >
              {(close) => (
                <form onSubmit={(e) => createShare(e, close)} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Nom du partage</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="ex: backup"
                      value={shareName}
                      onChange={(e) => setShareName(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Chemin du dossier</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="ex: /data/backup"
                      value={sharePath}
                      onChange={(e) => setSharePath(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Nœud (optionnel)</label>
                    <select
                      className="select"
                      value={shareNodeId}
                      onChange={(e) => setShareNodeId(e.target.value)}
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
                    Créer partage
                  </button>
                </form>
              )}
            </Modal>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {shares.map((share) => (
              <div key={share.id} className="p-4 bg-slate-800 rounded-lg border border-slate-700">
                <div className="flex items-start justify-between mb-3">
                  <h4 className="font-semibold text-slate-100">{share.name}</h4>
                  <Badge label={share.status} type="info" />
                </div>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-slate-400">Chemin:</span>
                    <p className="text-slate-300 font-mono text-xs mt-1 break-all">{share.path}</p>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Nœud</span>
                    <span className="text-slate-200">{share.nodeId ?? 'Auto'}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Mounts Section */}
        <Card title="Montages">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-slate-400">
              <strong>Qu'est-ce qu'un montage ?</strong> Associer un partage (share) à un chemin local sur un nœud,
              un peu comme connecter une clé USB à votre ordinateur.
            </p>
            <Modal
              title="Créer un montage"
              trigger="➕ Nouveau montage"
            >
              {(close) => (
                <form onSubmit={(e) => createMount(e, close)} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-2">Nom du montage</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="ex: data-mount"
                      value={mountName}
                      onChange={(e) => setMountName(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Source (partage)</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="ex: //server/share"
                      value={mountSource}
                      onChange={(e) => setMountSource(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Destination (chemin local)</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="ex: /mnt/data"
                      value={mountTarget}
                      onChange={(e) => setMountTarget(e.target.value)}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2">Nœud (optionnel)</label>
                    <select
                      className="select"
                      value={mountNodeId}
                      onChange={(e) => setMountNodeId(e.target.value)}
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
                    Créer montage
                  </button>
                </form>
              )}
            </Modal>
          </div>

          <div className="space-y-3">
            {mounts.map((mount) => (
              <div key={mount.id} className="p-4 bg-slate-800 rounded-lg border border-slate-700">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="font-semibold text-slate-100">{mount.name}</h4>
                  <Badge label={mount.status} type="info" />
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2 text-slate-400">
                    <span className="font-mono text-xs">{mount.sourcePath}</span>
                    <span>→</span>
                    <span className="font-mono text-xs">{mount.targetPath}</span>
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
