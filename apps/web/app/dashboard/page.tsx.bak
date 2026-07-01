'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  api,
  AlertItem,
  Forecast,
  MigrationItem,
  MountItem,
  NodeItem,
  PoolItem,
  ShareItem,
  SyncJobItem,
} from '../../lib/api';

function Badge({ value }: { value: string }) {
  return <span className={`badge ${value}`}>{value}</span>;
}

export default function DashboardPage() {
  const router = useRouter();
  const token = useMemo(() => (typeof window !== 'undefined' ? localStorage.getItem('tarmac_token') : null), []);

  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [shares, setShares] = useState<ShareItem[]>([]);
  const [mounts, setMounts] = useState<MountItem[]>([]);
  const [pools, setPools] = useState<PoolItem[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [syncJobs, setSyncJobs] = useState<SyncJobItem[]>([]);
  const [migrations, setMigrations] = useState<MigrationItem[]>([]);
  const [topology, setTopology] = useState<Record<string, unknown> | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);

  const [nodeName, setNodeName] = useState('');
  const [nodeRole, setNodeRole] = useState('worker');

  const [shareName, setShareName] = useState('');
  const [sharePath, setSharePath] = useState('');
  const [shareNodeId, setShareNodeId] = useState('');

  const [mountName, setMountName] = useState('');
  const [mountSource, setMountSource] = useState('');
  const [mountTarget, setMountTarget] = useState('');
  const [mountNodeId, setMountNodeId] = useState('');

  const [poolName, setPoolName] = useState('');
  const [poolStrategy, setPoolStrategy] = useState('mirror');

  const [syncJobName, setSyncJobName] = useState('');
  const [syncJobSource, setSyncJobSource] = useState('');
  const [syncJobTarget, setSyncJobTarget] = useState('');
  const [syncJobSchedule, setSyncJobSchedule] = useState('manual');
  const [syncJobNodeId, setSyncJobNodeId] = useState('');

  const [migrationName, setMigrationName] = useState('');
  const [migrationSourceNodeId, setMigrationSourceNodeId] = useState('');
  const [migrationTargetNodeId, setMigrationTargetNodeId] = useState('');

  const load = async () => {
    if (!token) return;
    try {
      const [n, s, m, p, a, sj, mg, tp, fc] = await Promise.all([
        api.nodes.list(token),
        api.shares.list(token),
        api.mounts.list(token),
        api.pools.list(token),
        api.alerts.list(token),
        api.syncJobs.list(token),
        api.migrations.list(token),
        api.topology.get(token),
        api.storage.forecast(token),
      ]);
      setNodes(n);
      setShares(s);
      setMounts(m);
      setPools(p);
      setAlerts(a);
      setSyncJobs(sj);
      setMigrations(mg);
      setTopology(tp);
      setForecast(fc);
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

  const createNode = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    await api.nodes.create(token, { name: nodeName, role: nodeRole });
    setNodeName('');
    await load();
  };

  const createShare = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    await api.shares.create(token, {
      name: shareName,
      path: sharePath,
      nodeId: shareNodeId || undefined,
    });
    setShareName('');
    setSharePath('');
    await load();
  };

  const createMount = async (e: FormEvent) => {
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
    await load();
  };

  const createPool = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    await api.pools.create(token, { name: poolName, strategy: poolStrategy });
    setPoolName('');
    await load();
  };

  const createSyncJob = async (e: FormEvent) => {
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
    await load();
  };

  const createMigration = async (e: FormEvent) => {
    e.preventDefault();
    if (!token) return;
    await api.migrations.create(token, {
      name: migrationName,
      sourceNodeId: migrationSourceNodeId || undefined,
      targetNodeId: migrationTargetNodeId || undefined,
    });
    setMigrationName('');
    await load();
  };

  return (
    <div className="container">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Tarmac Dashboard</h1>
        <button
          className="secondary"
          onClick={() => {
            localStorage.removeItem('tarmac_token');
            router.push('/login');
          }}
        >
          Déconnexion
        </button>
      </div>

      <div className="card">
        <h2>Forecast</h2>
        {forecast ? (
          <div>
            <p>
              {forecast.totalUsedGb} / {forecast.totalCapacityGb} GB ({Math.round(forecast.usageRatio * 100)}%)
            </p>
            <p>
              Croissance estimée: {forecast.avgGrowthPerDayGb} GB/jour · Jours restants:{' '}
              {forecast.forecast.daysToFull ?? 'N/A'}
            </p>
          </div>
        ) : (
          <p>Chargement...</p>
        )}
      </div>

      <div className="card">
        <h2>Nodes</h2>
        <form className="row" onSubmit={createNode}>
          <input placeholder="Nom" value={nodeName} onChange={(e) => setNodeName(e.target.value)} required />
          <select value={nodeRole} onChange={(e) => setNodeRole(e.target.value)}>
            <option value="worker">worker</option>
            <option value="controller">controller</option>
          </select>
          <button>Créer node</button>
        </form>
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Rôle</th>
              <th>Status</th>
              <th>lastSeen</th>
            </tr>
          </thead>
          <tbody>
            {nodes.map((n) => (
              <tr key={n.id}>
                <td>{n.name}</td>
                <td>{n.role}</td>
                <td>
                  <Badge value={n.status} />
                </td>
                <td>{n.lastSeenAt ? new Date(n.lastSeenAt).toLocaleString() : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Pools</h2>
        <form className="row" onSubmit={createPool}>
          <input placeholder="Nom" value={poolName} onChange={(e) => setPoolName(e.target.value)} required />
          <input
            placeholder="Stratégie"
            value={poolStrategy}
            onChange={(e) => setPoolStrategy(e.target.value)}
            required
          />
          <button>Créer pool</button>
        </form>
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Strategy</th>
              <th>Status</th>
              <th>Membres</th>
            </tr>
          </thead>
          <tbody>
            {pools.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{p.strategy}</td>
                <td>
                  <Badge value={p.status} />
                </td>
                <td>{p.members.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Alerts</h2>
        <table>
          <thead>
            <tr>
              <th>Message</th>
              <th>Severity</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.id}>
                <td>{a.message}</td>
                <td>
                  <Badge value={a.severity} />
                </td>
                <td>
                  <Badge value={a.status} />
                </td>
                <td className="row">
                  <button
                    className="secondary"
                    onClick={async () => {
                      if (!token) return;
                      await api.alerts.ack(token, a.id);
                      await load();
                    }}
                  >
                    Ack
                  </button>
                  <button
                    className="secondary"
                    onClick={async () => {
                      if (!token) return;
                      await api.alerts.resolve(token, a.id);
                      await load();
                    }}
                  >
                    Resolve
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Sync jobs</h2>
        <form className="row" onSubmit={createSyncJob}>
          <input placeholder="Nom" value={syncJobName} onChange={(e) => setSyncJobName(e.target.value)} required />
          <input
            placeholder="Source"
            value={syncJobSource}
            onChange={(e) => setSyncJobSource(e.target.value)}
            required
          />
          <input
            placeholder="Target"
            value={syncJobTarget}
            onChange={(e) => setSyncJobTarget(e.target.value)}
            required
          />
          <input
            placeholder="Schedule"
            value={syncJobSchedule}
            onChange={(e) => setSyncJobSchedule(e.target.value)}
            required
          />
          <select value={syncJobNodeId} onChange={(e) => setSyncJobNodeId(e.target.value)}>
            <option value="">Node (optionnel)</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
          <button>Créer sync-job</button>
        </form>
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Source</th>
              <th>Target</th>
              <th>Status</th>
              <th>Run</th>
            </tr>
          </thead>
          <tbody>
            {syncJobs.map((job) => (
              <tr key={job.id}>
                <td>{job.name}</td>
                <td>{job.sourcePath}</td>
                <td>{job.targetPath}</td>
                <td>
                  <Badge value={job.status} />
                </td>
                <td>
                  <button
                    className="secondary"
                    onClick={async () => {
                      if (!token) return;
                      await api.syncJobs.run(token, job.id);
                      await load();
                    }}
                  >
                    Run now
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Migrations</h2>
        <form className="row" onSubmit={createMigration}>
          <input
            placeholder="Nom migration"
            value={migrationName}
            onChange={(e) => setMigrationName(e.target.value)}
            required
          />
          <select value={migrationSourceNodeId} onChange={(e) => setMigrationSourceNodeId(e.target.value)}>
            <option value="">Source node</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
          <select value={migrationTargetNodeId} onChange={(e) => setMigrationTargetNodeId(e.target.value)}>
            <option value="">Target node</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
          <button>Créer migration</button>
        </form>
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {migrations.map((item) => (
              <tr key={item.id}>
                <td>{item.name}</td>
                <td>
                  <Badge value={item.status} />
                </td>
                <td>{item.progress}%</td>
                <td>
                  <button
                    className="secondary"
                    onClick={async () => {
                      if (!token) return;
                      await api.migrations.start(token, item.id);
                      await load();
                    }}
                  >
                    Start
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Topology (JSON)</h2>
        <pre style={{ maxHeight: 280, overflow: 'auto' }}>{JSON.stringify(topology, null, 2)}</pre>
      </div>

      <div className="card">
        <h2>Shares</h2>
        <form className="row" onSubmit={createShare}>
          <input placeholder="Nom" value={shareName} onChange={(e) => setShareName(e.target.value)} required />
          <input placeholder="Path" value={sharePath} onChange={(e) => setSharePath(e.target.value)} required />
          <select value={shareNodeId} onChange={(e) => setShareNodeId(e.target.value)}>
            <option value="">Node (optionnel)</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
          <button>Créer share</button>
        </form>
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Path</th>
              <th>Status</th>
              <th>Node</th>
            </tr>
          </thead>
          <tbody>
            {shares.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.path}</td>
                <td>
                  <Badge value={s.status} />
                </td>
                <td>{s.nodeId ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Mounts</h2>
        <form className="row" onSubmit={createMount}>
          <input placeholder="Nom" value={mountName} onChange={(e) => setMountName(e.target.value)} required />
          <input placeholder="Source" value={mountSource} onChange={(e) => setMountSource(e.target.value)} required />
          <input placeholder="Target" value={mountTarget} onChange={(e) => setMountTarget(e.target.value)} required />
          <select value={mountNodeId} onChange={(e) => setMountNodeId(e.target.value)}>
            <option value="">Node (optionnel)</option>
            {nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
          <button>Créer mount</button>
        </form>
        <table>
          <thead>
            <tr>
              <th>Nom</th>
              <th>Source</th>
              <th>Target</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {mounts.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td>{m.sourcePath}</td>
                <td>{m.targetPath}</td>
                <td>
                  <Badge value={m.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
