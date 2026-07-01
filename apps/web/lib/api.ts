const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export type NodeItem = {
  id: string;
  name: string;
  role: string;
  status: 'offline' | 'online' | 'degraded';
  lastSeenAt?: string | null;
};

export type ShareItem = {
  id: string;
  name: string;
  path: string;
  status: 'pending' | 'active' | 'error';
  nodeId?: string | null;
};

export type MountItem = {
  id: string;
  name: string;
  sourcePath: string;
  additionalSources: string[];
  targetPath: string;
  fsType: string;
  mountOptions?: string | null;
  status: 'pending' | 'active' | 'error';
  nodeId?: string | null;
};

export type PoolItem = {
  id: string;
  name: string;
  strategy: string;
  status: 'pending' | 'active' | 'error';
  members: Array<{ nodeId: string; role: 'primary' | 'replica'; status: 'pending' | 'active' | 'error' }>;
};

export type AlertItem = {
  id: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'acknowledged' | 'resolved';
  nodeId?: string | null;
  triggeredAt: string;
};

export type SyncJobItem = {
  id: string;
  name: string;
  sourcePath: string;
  targetPath: string;
  schedule: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  nodeId?: string | null;
};

export type MigrationItem = {
  id: string;
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  sourceNodeId?: string | null;
  targetNodeId?: string | null;
  createdAt: string;
};

export type Forecast = {
  nodeId?: string | null;
  totalCapacityGb: number;
  totalUsedGb: number;
  usageRatio: number;
  avgGrowthPerDayGb: number;
  forecast: {
    remainingGb: number;
    daysToFull: number | null;
    projectedFullDate: string | null;
  };
};

export type NodeMetricSample = {
  id: string;
  nodeId: string;
  cpu: number;
  ram: number;
  disk: number;
  networkRx: number;
  networkTx: number;
  ioRead: number;
  ioWrite: number;
  createdAt: string;
};

export type StorageOverview = Forecast & {
  generatedAt: string;
  metrics: {
    cpu: number;
    ram: number;
    networkRx: number;
    networkTx: number;
    ioRead: number;
    ioWrite: number;
  };
  disks: Array<{
    id: string;
    nodeId: string;
    nodeName: string;
    name: string;
    mountPath: string;
    type: 'hdd' | 'ssd' | 'nvme';
    health: 'healthy' | 'warning' | 'critical' | 'unknown';
    capacityGb: number;
    usedGb: number;
    usageRatio: number;
    updatedAt: string;
  }>;
};

async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    throw new Error(`API error ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export const api = {
  login: (email: string, password: string) =>
    fetch(`${API_BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).then(async (r) => {
      if (!r.ok) throw new Error('Login invalide');
      return r.json() as Promise<{ access_token: string }>;
    }),

  nodes: {
    list: (token: string) => request<NodeItem[]>('/api/v1/nodes', token),
    metrics: (token: string, id: string, range: '1h' | '6h' | '24h' = '1h') =>
      request<NodeMetricSample[]>(`/api/v1/nodes/${id}/metrics?range=${range}`, token),
    create: (token: string, payload: { name: string; role: string }) =>
      request<NodeItem>('/api/v1/nodes', token, { method: 'POST', body: JSON.stringify(payload) }),
    update: (token: string, id: string, payload: { name?: string; role?: string }) =>
      request<NodeItem>(`/api/v1/nodes/${id}`, token, { method: 'PATCH', body: JSON.stringify(payload) }),
    delete: (token: string, id: string) =>
      request<NodeItem>(`/api/v1/nodes/${id}`, token, { method: 'DELETE' }),
  },

  shares: {
    list: (token: string) => request<ShareItem[]>('/api/v1/shares', token),
    create: (token: string, payload: { name: string; path: string; nodeId?: string }) =>
      request<ShareItem>('/api/v1/shares', token, { method: 'POST', body: JSON.stringify(payload) }),
  },

  mounts: {
    list: (token: string) => request<MountItem[]>('/api/v1/mounts', token),
    create: (
      token: string,
      payload: {
        name: string;
        sourcePath: string;
        additionalSources?: string[];
        targetPath: string;
        fsType?: string;
        mountOptions?: string;
        nodeId?: string;
      },
    ) => request<MountItem>('/api/v1/mounts', token, { method: 'POST', body: JSON.stringify(payload) }),
  },

  pools: {
    list: (token: string) => request<PoolItem[]>('/api/v1/pools', token),
    create: (token: string, payload: { name: string; strategy: string }) =>
      request<PoolItem>('/api/v1/pools', token, { method: 'POST', body: JSON.stringify(payload) }),
  },

  alerts: {
    list: (token: string) => request<AlertItem[]>('/api/v1/alerts', token),
    ack: (token: string, id: string) => request(`/api/v1/alerts/${id}/ack`, token, { method: 'POST' }),
    resolve: (token: string, id: string) => request(`/api/v1/alerts/${id}/resolve`, token, { method: 'POST' }),
  },

  syncJobs: {
    list: (token: string) => request<SyncJobItem[]>('/api/v1/sync-jobs', token),
    create: (
      token: string,
      payload: { name: string; sourcePath: string; targetPath: string; schedule: string; nodeId?: string },
    ) => request<SyncJobItem>('/api/v1/sync-jobs', token, { method: 'POST', body: JSON.stringify(payload) }),
    run: (token: string, id: string) => request(`/api/v1/sync-jobs/${id}/runs`, token, { method: 'POST' }),
  },

  migrations: {
    list: (token: string) => request<MigrationItem[]>('/api/v1/migrations', token),
    create: (
      token: string,
      payload: { name: string; sourceNodeId?: string; targetNodeId?: string; notes?: string },
    ) => request<MigrationItem>('/api/v1/migrations', token, { method: 'POST', body: JSON.stringify(payload) }),
    start: (token: string, id: string) => request(`/api/v1/migrations/${id}/start`, token, { method: 'POST' }),
  },

  topology: {
    get: (token: string) => request<Record<string, unknown>>('/api/v1/topology', token),
  },

  storage: {
    forecast: (token: string, nodeId?: string) =>
      request<Forecast>(`/api/v1/storage/forecast${nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : ''}`, token),
    overview: (token: string, nodeId?: string) =>
      request<StorageOverview>(`/api/v1/storage/overview${nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : ''}`, token),
  },
};
