const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export type NodeItem = {
  id: string;
  name: string;
  role: string;
  status: 'offline' | 'online' | 'degraded';
  lastSeenAt?: string | null;
  overlayEndpoint?: string | null;
  externalIp?: string | null;
};

export type NodeOnboardingStartPayload = {
  name: string;
  role: 'controller' | 'worker';
  provider: 'ovh' | 'standard';
  hostIp: string;
  sshUsername: string;
  sshPassword: string;
  repoUrl?: string;
  repoRef?: string;
};

export type NodeOnboardingStartResult = {
  onboardingId: string;
  expiresAt: string;
  node: NodeItem;
  githubDeployKey: {
    title: string;
    publicKey: string;
    repoUrl: string;
  };
};

export type NodeOnboardingInstallResult = {
  success: boolean;
  nodeId: string;
  nodeName: string;
  output: string;
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
  notes?: string | null;
  sourceNodeId?: string | null;
  targetNodeId?: string | null;
  sourcePath?: string | null;
  targetPath?: string | null;
  reason?: string | null;
  sourceKind?: 'node' | 'seedbox' | null;
  targetKind?: 'node' | 'seedbox' | null;
  sourceSeedboxHost?: string | null;
  sourceSeedboxUser?: string | null;
  sourceSeedboxPort?: number | null;
  targetSeedboxHost?: string | null;
  targetSeedboxUser?: string | null;
  targetSeedboxPort?: number | null;
  sourceNode?: { id: string; name: string } | null;
  targetNode?: { id: string; name: string } | null;
  createdAt: string;
  updatedAt?: string;
};

export type DirectoryScanEntry = {
  path: string;
  sizeBytes: number;
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

export type NodeActivityItem = NodeItem & {
  metrics: {
    cpu: number;
    ram: number;
    disk: number;
    networkRx: number;
    networkTx: number;
    ioRead: number;
    ioWrite: number;
    sampledAt: string | null;
  };
  storage: {
    totalCapacityGb: number;
    totalUsedGb: number;
    usageRatio: number;
    diskCount: number;
    disks: Array<{
      id: string;
      name: string;
      mountPath: string;
      type: 'hdd' | 'ssd' | 'nvme';
      health: 'healthy' | 'warning' | 'critical' | 'unknown';
      capacityGb: number;
      usedGb: number;
      usageRatio: number;
      updatedAt: string;
      nodeName: string;
    }>;
  };
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

export type VlanMember = {
  id: string;
  vlanId: string;
  nodeId: string;
  vlanIp: string;
  vlanMac: string;
  joinedAt: string;
  lastHeartbeat: string;
  node?: NodeItem;
};

export type VlanConnection = {
  id: string;
  vlanId: string;
  sourceNodeId: string;
  targetNodeId: string;
  status: 'healthy' | 'degraded' | 'offline' | 'unknown';
  latencyMs?: number | null;
  packetLoss?: number | null;
  bandwidth?: number | null;
  lastCheckedAt?: string | null;
  sourceNode?: { id: string; name: string; vlanIp: string };
  targetNode?: { id: string; name: string; vlanIp: string };
};

export type VlanConnectionTest = {
  id: string;
  vlanId: string;
  initiatorNodeId: string;
  targetNodeId: string;
  testType: 'ping' | 'connectivity' | 'latency';
  status: 'pending' | 'success' | 'failed' | 'timeout';
  resultCode?: number | null;
  resultMessage?: string | null;
  latencyMs?: number | null;
  packetLoss?: number | null;
  startedAt: string;
  completedAt?: string | null;
  initiatorNode?: { id: string; name: string; vlanIp: string };
};

export type Vlan = {
  id: string;
  name: string;
  subnetCidr: string;
  description?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  members?: VlanMember[];
  connections?: VlanConnection[];
};

export type VlanStatus = {
  vlan: Vlan;
  memberCount: number;
  connectionStats: {
    total: number;
    healthy: number;
    degraded: number;
    offline: number;
  };
  recentFailures: VlanConnectionTest[];
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
    let message = `API error ${res.status}`;
    try {
      const payload = (await res.json()) as { message?: string | string[] };
      if (typeof payload.message === 'string') {
        message = payload.message;
      } else if (Array.isArray(payload.message) && payload.message.length > 0) {
        message = payload.message.join(', ');
      }
    } catch {
      // keep fallback message
    }
    throw new Error(message);
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
    activity: (token: string, range: '1h' | '6h' | '24h' = '1h') =>
      request<NodeActivityItem[]>(`/api/v1/nodes/activity?range=${range}`, token),
    metrics: (token: string, id: string, range: '1h' | '6h' | '24h' = '1h') =>
      request<NodeMetricSample[]>(`/api/v1/nodes/${id}/metrics?range=${range}`, token),
    create: (token: string, payload: { name: string; role: string }) =>
      request<NodeItem>('/api/v1/nodes', token, { method: 'POST', body: JSON.stringify(payload) }),
    onboardingStart: (token: string, payload: NodeOnboardingStartPayload) =>
      request<NodeOnboardingStartResult>('/api/v1/nodes/onboarding/start', token, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onboardingInstall: (token: string, onboardingId: string) =>
      request<NodeOnboardingInstallResult>(`/api/v1/nodes/onboarding/${encodeURIComponent(onboardingId)}/install`, token, {
        method: 'POST',
        body: JSON.stringify({ deployKeyConfirmed: true }),
      }),
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
    delete: (token: string, id: string) =>
      request<void>(`/api/v1/mounts/${id}`, token, { method: 'DELETE' }),
    remount: (token: string, id: string) =>
      request<MountItem>(`/api/v1/mounts/${id}/remount`, token, { method: 'POST' }),
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
      payload: {
        name: string;
        sourceNodeId?: string;
        targetNodeId?: string;
        sourcePath?: string;
        targetPath?: string;
        reason?: string;
        notes?: string;
        sourceKind?: 'node' | 'seedbox';
        targetKind?: 'node' | 'seedbox';
        sourceSeedboxHost?: string;
        sourceSeedboxUser?: string;
        sourceSeedboxPassword?: string;
        sourceSeedboxPort?: string;
        targetSeedboxHost?: string;
        targetSeedboxUser?: string;
        targetSeedboxPassword?: string;
        targetSeedboxPort?: string;
      },
    ) => request<MigrationItem>('/api/v1/migrations', token, { method: 'POST', body: JSON.stringify(payload) }),
    listDirectories: (token: string, nodeId: string, basePath = '/') =>
      request<{ basePath: string; directories: string[] }>(
        `/api/v1/migrations/directories?nodeId=${encodeURIComponent(nodeId)}&basePath=${encodeURIComponent(basePath)}`,
        token,
      ),
    scanDirectories: (token: string, nodeId: string, basePath = '/', maxEntries = 20) =>
      request<{ basePath: string; entries: DirectoryScanEntry[]; truncated: boolean }>(
        `/api/v1/migrations/directories/scan?nodeId=${encodeURIComponent(nodeId)}&basePath=${encodeURIComponent(basePath)}&maxEntries=${encodeURIComponent(String(maxEntries))}`,
        token,
      ),
    listRemoteDirectories: (
      token: string,
      payload: { nodeId: string; host: string; username: string; password?: string; port?: string; basePath?: string },
    ) =>
      request<{ basePath: string; directories: string[] }>('/api/v1/migrations/directories/remote', token, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    update: (
      token: string,
      id: string,
      payload: { name?: string; sourceNodeId?: string; targetNodeId?: string; notes?: string; status?: 'pending' | 'running' | 'completed' | 'failed'; progress?: number },
    ) => request<MigrationItem>(`/api/v1/migrations/${id}`, token, { method: 'PATCH', body: JSON.stringify(payload) }),
    start: (token: string, id: string) => request(`/api/v1/migrations/${id}/start`, token, { method: 'POST' }),
    stop: (token: string, id: string) => request<MigrationItem>(`/api/v1/migrations/${id}/stop`, token, { method: 'POST' }),
    retry: (token: string, id: string) => request<MigrationItem>(`/api/v1/migrations/${id}/retry`, token, { method: 'POST' }),
    remove: (token: string, id: string) => request<void>(`/api/v1/migrations/${id}`, token, { method: 'DELETE' }),
  },

  topology: {
    get: (token: string) => request<Record<string, unknown>>('/api/v1/topology', token),
  },

  agents: {
    update: (
      token: string,
      nodeId: string,
      payload?: { ref?: string; repoUrl?: string; serviceName?: string },
    ) =>
      request<{ queued: boolean; message: string }>(
        `/api/v1/agents/${encodeURIComponent(nodeId)}/update`,
        token,
        {
          method: 'POST',
          body: JSON.stringify(payload ?? {}),
        },
      ),
  },

  storage: {
    forecast: (token: string, nodeId?: string) =>
      request<Forecast>(`/api/v1/storage/forecast${nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : ''}`, token),
    overview: (token: string, nodeId?: string) =>
      request<StorageOverview>(`/api/v1/storage/overview${nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : ''}`, token),
  },

  vlan: {
    getAll: (token: string) =>
      request<{ vlans: Vlan[] }>('/api/v1/vlan', token),
    join: (token: string, nodeId: string, vlanName?: string) =>
      request<{ success: boolean; membership: VlanMember }>('/api/v1/vlan/join', token, {
        method: 'POST',
        body: JSON.stringify({ nodeId, vlanName }),
      }),
    getMembers: (token: string, vlanId: string) =>
      request<{ members: VlanMember[] }>(`/api/v1/vlan/${vlanId}/members`, token),
    getConnections: (token: string, vlanId: string) =>
      request<{ connections: VlanConnection[] }>(`/api/v1/vlan/${vlanId}/connections`, token),
    getStatus: (token: string, vlanId: string) =>
      request<VlanStatus>(`/api/v1/vlan/${vlanId}/status`, token),
    getTests: (token: string, vlanId: string) =>
      request<{ tests: VlanConnectionTest[] }>(`/api/v1/vlan/${vlanId}/tests`, token),
    runTest: (token: string, vlanId: string, initiatorNodeId: string, targetNodeId: string, testType: 'ping' | 'connectivity' | 'latency') =>
      request<{ success: boolean; test: VlanConnectionTest }>(`/api/v1/vlan/${vlanId}/test`, token, {
        method: 'POST',
        body: JSON.stringify({ initiatorNodeId, targetNodeId, testType }),
      }),
    heartbeat: (token: string, nodeId: string, vlanId?: string) =>
      request<{ success: boolean; membership: VlanMember | null }>('/api/v1/vlan/heartbeat', token, {
        method: 'POST',
        body: JSON.stringify({ nodeId, vlanId }),
      }),
  },
};
