export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export type NodeItem = {
  id: string;
  name: string;
  role: string;
  status: 'offline' | 'online' | 'degraded';
  locationCity?: string | null;
  locationCountry?: string | null;
  locationCountryCode?: string | null;
  lastSeenAt?: string | null;
  overlayEndpoint?: string | null;
  overlaySshPublicKey?: string | null;
  overlaySshUser?: string | null;
  externalIp?: string | null;
  agentVersion?: string | null;
  agentVersionAt?: string | null;
  controlVersion?: string;
  agentUpToDate?: boolean | null;
  mutedUntil?: string | null;
};

export type SmartHistoryPoint = {
  collectedAt: string;
  temperatureC: number;
  reallocatedSectors: number;
  pendingSectors: number;
  powerOnHours: number;
  overall: 'healthy' | 'warning' | 'critical' | 'unknown';
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
  lastError?: string | null;
  nodeId?: string | null;
  remoteHost?: string | null;
  remoteUser?: string | null;
  remoteSshPort?: number | null;
  node?: { id: string; name: string; overlaySshPublicKey?: string | null; overlaySshUser?: string | null } | null;
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
  lastRunAt?: string | null;
  sourceHost?: string | null;
  sourceUser?: string | null;
  sourceSshPort?: number | null;
  node?: { id: string; name: string; overlaySshPublicKey?: string | null } | null;
  // Only present in the response right after create/rotate — the plaintext
  // is never persisted, so it can't be fetched again afterwards.
  triggerToken?: string;
};

export type SyncJobRunItem = {
  id: string;
  syncJobId: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  trigger: string;
  bytesTransferred: number;
  log?: string | null;
  startedAt: string;
  finishedAt?: string | null;
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
  sourceKind?: 'node' | 'seedbox' | 'storagebox' | null;
  targetKind?: 'node' | 'seedbox' | 'storagebox' | null;
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
      smartDiskName: string | null;
      smart: {
        temperatureC: number;
        reallocatedSectors: number;
        pendingSectors: number;
        powerOnHours: number;
        overall: 'healthy' | 'warning' | 'critical' | 'unknown';
        collectedAt: string;
      } | null;
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

export type AdminProfile = {
  id: string;
  email: string;
  createdAt: string;
  updatedAt: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
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
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    }).then(async (r) => {
      if (!r.ok) throw new Error('Login invalide');
      return r.json() as Promise<{ success: boolean }>;
    }),

  logout: () =>
    fetch(`${API_BASE}/api/v1/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    }),

  profile: {
    get: () => request<AdminProfile>('/api/v1/auth/profile'),
    update: (
      payload: {
        email?: string;
        currentPassword?: string;
        newPassword?: string;
      },
    ) =>
      request<AdminProfile>('/api/v1/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
  },

  nodes: {
    list: () => request<NodeItem[]>('/api/v1/nodes'),
    activity: (range: '1h' | '6h' | '24h' = '1h') =>
      request<NodeActivityItem[]>(`/api/v1/nodes/activity?range=${range}`),
    metrics: (id: string, range: '1h' | '6h' | '24h' = '1h') =>
      request<NodeMetricSample[]>(`/api/v1/nodes/${id}/metrics?range=${range}`),
    create: (payload: { name: string; role: string }) =>
      request<NodeItem>('/api/v1/nodes', { method: 'POST', body: JSON.stringify(payload) }),
    onboardingStart: (payload: NodeOnboardingStartPayload) =>
      request<NodeOnboardingStartResult>('/api/v1/nodes/onboarding/start', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    onboardingInstall: (onboardingId: string) =>
      request<NodeOnboardingInstallResult>(`/api/v1/nodes/onboarding/${encodeURIComponent(onboardingId)}/install`, {
        method: 'POST',
        body: JSON.stringify({ deployKeyConfirmed: true }),
      }),
    update: (
      id: string,
      payload: {
        name?: string;
        role?: string;
        locationCity?: string | null;
        locationCountry?: string | null;
        locationCountryCode?: string | null;
      },
    ) =>
      request<NodeItem>(`/api/v1/nodes/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    delete: (id: string) =>
      request<NodeItem & { agentUninstallQueued: boolean }>(`/api/v1/nodes/${id}`, { method: 'DELETE' }),
    smartHistory: (id: string, diskName: string) =>
      request<SmartHistoryPoint[]>(`/api/v1/nodes/${id}/disks/${encodeURIComponent(diskName)}/smart-history`),
    mute: (id: string, minutes: number) =>
      request<NodeItem>(`/api/v1/nodes/${id}/mute`, { method: 'POST', body: JSON.stringify({ minutes }) }),
    unmute: (id: string) => request<NodeItem>(`/api/v1/nodes/${id}/unmute`, { method: 'POST' }),
  },

  shares: {
    list: () => request<ShareItem[]>('/api/v1/shares'),
    create: (payload: { name: string; path: string; nodeId?: string }) =>
      request<ShareItem>('/api/v1/shares', { method: 'POST', body: JSON.stringify(payload) }),
  },

  mounts: {
    list: () => request<MountItem[]>('/api/v1/mounts'),
    create: (
      payload: {
        name: string;
        sourcePath: string;
        additionalSources?: string[];
        targetPath: string;
        fsType?: string;
        mountOptions?: string;
        nodeId?: string;
        remoteHost?: string;
        remoteUser?: string;
        remoteSshPort?: number;
      },
    ) => request<MountItem>('/api/v1/mounts', { method: 'POST', body: JSON.stringify(payload) }),
    update: (
      id: string,
      payload: {
        name?: string;
        sourcePath?: string;
        targetPath?: string;
        mountOptions?: string;
        remoteHost?: string;
        remoteUser?: string;
        remoteSshPort?: number;
      },
    ) => request<MountItem>(`/api/v1/mounts/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    delete: (id: string) =>
      request<void>(`/api/v1/mounts/${id}`, { method: 'DELETE' }),
    remount: (id: string) =>
      request<MountItem>(`/api/v1/mounts/${id}/remount`, { method: 'POST' }),
  },

  pools: {
    list: () => request<PoolItem[]>('/api/v1/pools'),
    create: (payload: { name: string; strategy: string }) =>
      request<PoolItem>('/api/v1/pools', { method: 'POST', body: JSON.stringify(payload) }),
    delete: (id: string) => request<void>(`/api/v1/pools/${id}`, { method: 'DELETE' }),
    addMember: (
      poolId: string,
      payload: { nodeId: string; role: 'primary' | 'replica'; status: 'pending' | 'active' | 'error' },
    ) =>
      request(`/api/v1/pools/${poolId}/members`, { method: 'POST', body: JSON.stringify(payload) }),
    removeMember: (poolId: string, nodeId: string) =>
      request<void>(`/api/v1/pools/${poolId}/members/${nodeId}`, { method: 'DELETE' }),
  },

  alerts: {
    list: () => request<AlertItem[]>('/api/v1/alerts'),
    ack: (id: string) => request(`/api/v1/alerts/${id}/ack`, { method: 'POST' }),
    resolve: (id: string) => request(`/api/v1/alerts/${id}/resolve`, { method: 'POST' }),
    remove: (id: string) => request(`/api/v1/alerts/${id}`, { method: 'DELETE' }),
  },

  syncJobs: {
    list: () => request<SyncJobItem[]>('/api/v1/sync-jobs'),
    create: (
      payload: {
        name: string;
        sourcePath: string;
        targetPath: string;
        schedule: string;
        nodeId?: string;
        sourceHost?: string;
        sourceUser?: string;
        sourceSshPort?: number;
      },
    ) => request<SyncJobItem>('/api/v1/sync-jobs', { method: 'POST', body: JSON.stringify(payload) }),
    update: (
      id: string,
      payload: {
        name?: string;
        sourcePath?: string;
        targetPath?: string;
        schedule?: string;
        nodeId?: string;
        sourceHost?: string;
        sourceUser?: string;
        sourceSshPort?: number;
      },
    ) => request<SyncJobItem>(`/api/v1/sync-jobs/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    run: (id: string) => request(`/api/v1/sync-jobs/${id}/runs`, { method: 'POST' }),
    runs: (id: string) => request<SyncJobRunItem[]>(`/api/v1/sync-jobs/${id}/runs`),
    delete: (id: string) => request<void>(`/api/v1/sync-jobs/${id}`, { method: 'DELETE' }),
    rotateTriggerToken: (id: string) =>
      request<{ triggerToken: string }>(`/api/v1/sync-jobs/${id}/trigger-token/rotate`, { method: 'POST' }),
  },

  migrations: {
    list: () => request<MigrationItem[]>('/api/v1/migrations'),
    create: (
      payload: {
        name: string;
        sourceNodeId?: string;
        targetNodeId?: string;
        sourcePath?: string;
        targetPath?: string;
        reason?: string;
        notes?: string;
        sourceKind?: 'node' | 'seedbox' | 'storagebox';
        targetKind?: 'node' | 'seedbox' | 'storagebox';
        sourceSeedboxHost?: string;
        sourceSeedboxUser?: string;
        sourceSeedboxPassword?: string;
        sourceSeedboxPort?: string;
        targetSeedboxHost?: string;
        targetSeedboxUser?: string;
        targetSeedboxPassword?: string;
        targetSeedboxPort?: string;
      },
    ) => request<MigrationItem>('/api/v1/migrations', { method: 'POST', body: JSON.stringify(payload) }),
    listDirectories: (nodeId: string, basePath = '/') =>
      request<{ basePath: string; directories: string[] }>(
        `/api/v1/migrations/directories?nodeId=${encodeURIComponent(nodeId)}&basePath=${encodeURIComponent(basePath)}`,
      ),
    scanDirectories: (nodeId: string, basePath = '/', maxEntries = 20) =>
      request<{ basePath: string; entries: DirectoryScanEntry[]; truncated: boolean }>(
        `/api/v1/migrations/directories/scan?nodeId=${encodeURIComponent(nodeId)}&basePath=${encodeURIComponent(basePath)}&maxEntries=${encodeURIComponent(String(maxEntries))}`,
      ),
    listRemoteDirectories: (
      payload: {
        nodeId: string;
        host: string;
        username: string;
        password?: string;
        port?: string;
        basePath?: string;
        endpointType?: 'seedbox' | 'storagebox';
      },
    ) =>
      request<{ basePath: string; directories: string[] }>('/api/v1/migrations/directories/remote', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    update: (
      id: string,
      payload: { name?: string; sourceNodeId?: string; targetNodeId?: string; notes?: string; status?: 'pending' | 'running' | 'completed' | 'failed'; progress?: number },
    ) => request<MigrationItem>(`/api/v1/migrations/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    start: (id: string) => request(`/api/v1/migrations/${id}/start`, { method: 'POST' }),
    stop: (id: string) => request<MigrationItem>(`/api/v1/migrations/${id}/stop`, { method: 'POST' }),
    retry: (id: string) => request<MigrationItem>(`/api/v1/migrations/${id}/retry`, { method: 'POST' }),
    remove: (id: string) => request<void>(`/api/v1/migrations/${id}`, { method: 'DELETE' }),
  },

  topology: {
    get: () => request<Record<string, unknown>>('/api/v1/topology'),
  },

  agents: {
    update: (
      nodeId: string,
      payload?: { ref?: string; repoUrl?: string; serviceName?: string },
    ) =>
      request<{ queued: boolean; message: string }>(
        `/api/v1/agents/${encodeURIComponent(nodeId)}/update`,
        {
          method: 'POST',
          body: JSON.stringify(payload ?? {}),
        },
      ),
  },

  storage: {
    forecast: (nodeId?: string) =>
      request<Forecast>(`/api/v1/storage/forecast${nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : ''}`),
    overview: (nodeId?: string) =>
      request<StorageOverview>(`/api/v1/storage/overview${nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : ''}`),
  },

  vlan: {
    getAll: () =>
      request<{ vlans: Vlan[] }>('/api/v1/vlan'),
    join: (nodeId: string, vlanName?: string) =>
      request<{ success: boolean; membership: VlanMember }>('/api/v1/vlan/join', {
        method: 'POST',
        body: JSON.stringify({ nodeId, vlanName }),
      }),
    getMembers: (vlanId: string) =>
      request<{ members: VlanMember[] }>(`/api/v1/vlan/${vlanId}/members`),
    getConnections: (vlanId: string) =>
      request<{ connections: VlanConnection[] }>(`/api/v1/vlan/${vlanId}/connections`),
    getStatus: (vlanId: string) =>
      request<VlanStatus>(`/api/v1/vlan/${vlanId}/status`),
    getTests: (vlanId: string) =>
      request<{ tests: VlanConnectionTest[] }>(`/api/v1/vlan/${vlanId}/tests`),
    runTest: (vlanId: string, initiatorNodeId: string, targetNodeId: string, testType: 'ping' | 'connectivity' | 'latency') =>
      request<{ success: boolean; test: VlanConnectionTest }>(`/api/v1/vlan/${vlanId}/test`, {
        method: 'POST',
        body: JSON.stringify({ initiatorNodeId, targetNodeId, testType }),
      }),
    heartbeat: (nodeId: string, vlanId?: string) =>
      request<{ success: boolean; membership: VlanMember | null }>('/api/v1/vlan/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ nodeId, vlanId }),
      }),
  },
};
