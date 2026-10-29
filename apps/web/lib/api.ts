export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

// Carries the HTTP status alongside the message so callers (usePolling,
// [workspace]/layout.tsx) can tell "your session is actually invalid" (401)
// apart from a transient network blip, an aborted in-flight request from
// fast navigation, or a workspace-scope mismatch (403) - none of which mean
// the user is logged out, so none of them should bounce them to /login.
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export type NodeItem = {
  id: string;
  name: string;
  role: string;
  status: 'offline' | 'online' | 'degraded';
  locationCity?: string | null;
  locationCountry?: string | null;
  locationCountryCode?: string | null;
  locationLat?: number | null;
  locationLng?: number | null;
  graphX?: number | null;
  graphY?: number | null;
  lastSeenAt?: string | null;
  overlayEndpoint?: string | null;
  overlaySshPublicKey?: string | null;
  overlaySshUser?: string | null;
  externalIp?: string | null;
  agentVersion?: string | null;
  agentVersionAt?: string | null;
  controlVersion?: string | null;
  agentUpToDate?: boolean | null;
  // Last agent update asked from the dashboard and where it stands.
  agentUpdate?: AgentUpdateProgress | null;
  mutedUntil?: string | null;
  // False when this node's SMART readings are meaningless (virtualised
  // storage) and its operator has opted out of disk alerts for it.
  smartMonitoringEnabled?: boolean;
  overlayIsGateway?: boolean;
  // Takes over the region's gateway role while the primary is offline.
  overlayIsBackupGateway?: boolean;
  vlanIp?: string | null;
  // Custom <dnsHostname>.tarmac.local label - see InternalDnsService on the
  // API side. Null means a slug derived from `name` is used instead.
  dnsHostname?: string | null;
  // Shared labels (Node.labels on the API side).
  labels?: string[];
  // Hardware/OS reported by the agent, see lib/system-info.ts.
  systemInfo?: import('./system-info').NodeSystemInfo | null;
  // Status of this node's own local fallback resolver for *.tarmac.local
  // (only relevant on nodes that can't use systemd-resolved's split-DNS
  // routing) - null means never attempted / not applicable.
  internalDnsForwarderStatus?: 'active' | 'unreachable' | 'conflict' | 'error' | null;
  internalDnsForwarderConflict?: { port: number; protocol: string; pid?: number | null; processName?: string | null } | null;
};

export type AgentUpdateStatus = 'sent' | 'restarting' | 'done' | 'failed' | 'timeout';
export type AgentUpdateProgress = {
  status: AgentUpdateStatus;
  message: string | null;
  fromVersion: string | null;
  toVersion: string | null;
  startedAt: string | null;
  finishedAt: string | null;
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
  provider: 'ovh' | 'standard';
  hostIp: string;
  sshUsername: string;
} & (
  | { authMethod: 'password'; sshPassword: string }
  | { authMethod: 'key'; sshPrivateKey: string; sshKeyPassphrase?: string; sudoPassword?: string }
);

export type NodeOnboardingStartResult = {
  onboardingId: string;
  expiresAt: string;
  node: NodeItem;
  // SSH host key seen at the first connection ("SHA256:..."); the install
  // step is refused if the server presents another one.
  hostKeyFingerprint?: string;
  githubDeployKey: {
    title: string;
    publicKey: string;
    repoUrl: string;
    // Added to GitHub by Tarmac (GitHub integration set up by a superuser).
    registered?: boolean;
    registrationError?: string | null;
  };
};

export type GithubDeployKeyOverview = {
  configured: boolean;
  repository: string | null;
  tokenHint: string | null;
  verifiedAt: string | null;
  lastError: string | null;
  lastSyncAt: string | null;
  secretsKeyConfigured: boolean;
  reachable: boolean;
  nodes: Array<{
    id: string;
    name: string;
    status: string;
    workspace: { id: string; name: string };
    fingerprint: string | null;
    // unknown: the node's agent hasn't reported its key (older agent, or
    // a node not set up with a deploy key).
    keyStatus: 'on_github' | 'missing' | 'unknown';
    githubKey: { id: string; title: string | null } | null;
  }>;
  orphanKeys: Array<{ id: string; title: string; readOnly: boolean; createdAt: string | null; fingerprint: string | null }>;
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

export type DnsPortConflict = {
  port: number;
  protocol: 'tcp' | 'udp';
  pid: number | null;
  processName: string | null;
};

export type DnsServerTask = {
  status: 'requested' | 'running' | 'done' | 'failed' | string;
  attempts: number;
  error: string | null;
  updatedAt: string | null;
};

// A DNS server node's PowerDNS, as its agent reports it in each heartbeat.
export type DnsServerState = {
  pdnsVersion: string;
  backend: 'lmdb' | 'gsqlite3' | string;
  catalog: boolean;
  maxAttempts: number;
  tasks: Partial<Record<'lmdb' | 'upgrade', DnsServerTask>>;
};

export type DnsServerGroupMemberItem = {
  nodeId: string;
  role: 'primary' | 'secondary';
  status: 'pending' | 'active' | 'error';
  conflictDetail?: DnsPortConflict | null;
  node?: { dnsServerState?: DnsServerState | null };
};

export type DnsServerGroupItem = {
  id: string;
  name: string;
  status: 'pending' | 'active' | 'error';
  members: DnsServerGroupMemberItem[];
  zones?: Array<{
    id: string;
    name: string;
    status: 'pending' | 'active' | 'error';
    syncCheckedAt?: string | null;
    syncDetail?: DnsZoneSyncMember[] | null;
  }>;
};

// One group member's view of a zone, from the API's periodic SOA check.
export type DnsZoneSyncMember = {
  nodeId: string;
  role: 'primary' | 'secondary';
  serial: number | null;
  fingerprint?: string | null;
  // Same content as the primary; null when either agent couldn't be asked.
  contentMatches?: boolean | null;
  ok: boolean;
  behindSince: string | null;
  error: string | null;
};

export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'NS' | 'CAA' | 'SRV' | 'PTR';

export type DnsRecordValueItem = {
  id?: string;
  content: string;
  nodeId?: string | null;
  priority?: number | null;
};

export type DnsRecordItem = {
  id: string;
  name: string;
  type: DnsRecordType;
  ttl: number;
  isGeo: boolean;
  status: 'pending' | 'active' | 'error';
  values: DnsRecordValueItem[];
};

export type DnsZoneItem = {
  id: string;
  groupId: string;
  name: string;
  dnssecEnabled: boolean;
  status: 'pending' | 'active' | 'error';
  records: DnsRecordItem[];
  delegationVerified: boolean;
  delegationCheckedAt: string | null;
};

export type DnsDelegationNameserverResult = {
  host: string;
  expectedIp: string;
  nsVisible: boolean;
  resolvedIp: string | null;
  matches: boolean;
  ok: boolean;
};

export type DnsNodeRecordRef = {
  zoneId: string;
  zoneName: string;
  recordId: string;
  recordName: string;
  type: DnsRecordType;
  isGeo: boolean;
};

export type AlertItem = {
  id: string;
  message: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'acknowledged' | 'resolved';
  nodeId?: string | null;
  triggeredAt: string;
  acknowledgedAt?: string | null;
  resolvedAt?: string | null;
  node?: { id: string; name: string } | null;
  rule?: { id: string; name: string; metric: string; threshold: number } | null;
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

export type NodeSeriesPoint = { t: string; cpu: number; ram: number; disk: number; networkRx: number; networkTx: number };

// Every node's metrics over a range, pre-averaged into ~60 buckets.
export type NodeActivitySeries = {
  range: '1h' | '6h' | '24h';
  bucketSeconds: number;
  start: string;
  series: Record<string, NodeSeriesPoint[]>;
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

// Payload of a 'node.heartbeat' message on the /live-ws socket (see
// AgentsService.onHeartbeat) - a lean patch, not a full NodeActivityItem,
// for merging into cached activity data the instant a heartbeat lands.
export type NodeHeartbeatLiveEvent = {
  nodeId: string;
  system?: import('./system-info').NodeSystemInfo | null;
  status: 'offline' | 'online' | 'degraded';
  lastSeenAt: string;
  agentVersion: string | null;
  agentVersionAt: string | null;
  metrics: {
    cpu: number;
    ram: number;
    disk: number;
    networkRx: number;
    networkTx: number;
    ioRead: number;
    ioWrite: number;
  };
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

export type VlanRegion = 'europe' | 'north-america' | 'south-america' | 'asia' | 'oceania' | 'africa';

export type VlanMember = {
  id: string;
  vlanId: string;
  nodeId: string;
  vlanIp: string;
  vlanMac: string;
  joinedAt: string;
  lastHeartbeat: string;
  node?: NodeItem;
  region?: VlanRegion | null;
  // This node currently carries its region's cross-region traffic: the
  // primary gateway, or its backup while the primary is down.
  gatewayActive?: boolean;
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

export type VlanTraceHop = { hop: number; ip: string | null; latencyMs: number | null };

// Result of an on-demand ping/traceroute from the Diagnostics tab. Not
// stored by the API: it lives only in the page that ran it.
export type VlanConnectionTest = {
  id: string;
  vlanId: string;
  initiatorNodeId: string;
  targetNodeId: string;
  testType: 'ping' | 'traceroute';
  status: 'success' | 'failed';
  resultMessage?: string | null;
  latencyMs?: number | null;
  minMs?: number | null;
  maxMs?: number | null;
  packetLoss?: number | null;
  hops?: VlanTraceHop[] | null;
  startedAt: string;
  completedAt?: string | null;
  durationMs?: number;
  initiatorNode?: { id: string; name: string; vlanIp: string };
  targetNode?: { id: string; name: string; vlanIp: string };
};

export type VlanConnectionSample = {
  id: string;
  vlanId: string;
  sourceNodeId: string;
  targetNodeId: string;
  status: 'healthy' | 'degraded' | 'offline' | 'unknown';
  latencyMs?: number | null;
  packetLoss?: number | null;
  bandwidth?: number | null;
  createdAt: string;
};

export type VlanConnectionHistory = {
  samples: VlanConnectionSample[];
  // null when the range holds no sample at all.
  uptimePercent: number | null;
  // Regional gateways a segmented cross-region pair is routed through; the
  // samples are then the chained hops, not a direct tunnel.
  via?: Array<{ id: string; name: string }>;
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
};

export type VpnNodeRef = {
  id: string;
  name: string;
  status: 'offline' | 'online' | 'degraded';
  publicIp: string | null;
  locationCity?: string | null;
  locationCountry?: string | null;
  locationCountryCode?: string | null;
};

export type VpnProfileMode = 'full' | 'private';
export type VpnDeploymentStatus = 'active' | 'pending' | 'error' | 'disabled' | 'expired';
export type VpnAccessScope = 'all' | 'selected' | 'none';
// What a client may open connections to (replies always come back),
// enforced by its entry node's firewall.
export type VpnAccess = {
  mesh: VpnAccessScope;
  meshNodeIds: string[];
  peers: VpnAccessScope;
  peerProfileIds: string[];
};
export type VpnBulkAction =
  | 'enable'
  | 'disable'
  | 'delete'
  | 'add_tag'
  | 'remove_tag'
  | 'add_peers'
  | 'remove_peers'
  | 'set_mesh_access'
  | 'set_peer_access';
export type VpnBulkOptions = { tag?: string; peerIds?: string[]; scope?: VpnAccessScope; meshNodeIds?: string[] };

export type VpnProfile = {
  id: string;
  name: string;
  description: string | null;
  mode: VpnProfileMode;
  enabled: boolean;
  expiresAt: string | null;
  dns: string[];
  tags: string[];
  access: VpnAccess;
  clientIp: string;
  clientPublicKey: string;
  // False when the profile was created with the caller's own public key:
  // its config then carries a placeholder instead of the private key.
  hasPrivateKey: boolean;
  entryNode: VpnNodeRef;
  // Raw setting (null = leave directly through the entry node)...
  exitNodeId: string | null;
  // ...and the node traffic actually leaves through (null in private mode).
  exitNode: VpnNodeRef | null;
  // `warning`: deployed, but the entry node's agent is too old to enforce
  // the access rules.
  deployment: { status: VpnDeploymentStatus; message: string | null; warning?: string | null };
  session: {
    connected: boolean;
    lastHandshakeAt: string | null;
    endpoint: string | null;
    rxBytes: number;
    txBytes: number;
  };
  exitSwitchedAt: string | null;
  configChangedAt: string;
  createdByUserId: string | null;
  createdByApiKeyId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type VpnProfileWithConfig = VpnProfile & { config: string };

export type VpnProfilePayload = {
  name: string;
  description?: string | null;
  mode?: VpnProfileMode;
  entryNodeId: string;
  exitNodeId?: string | null;
  dns?: string[];
  expiresAt?: string | null;
  publicKey?: string;
  tags?: string[];
  meshAccess?: VpnAccessScope;
  meshNodeIds?: string[];
  peerAccess?: VpnAccessScope;
  peerProfileIds?: string[];
};

export type VpnGateway = VpnNodeRef & {
  vlanIp: string | null;
  // null = eligible, otherwise the reason (in French) it can't be used.
  entryEligibility: string | null;
  exitEligibility: string | null;
  clientSubnet: string | null;
  listenPort: number;
  entryProfiles: number;
  exitProfiles: number;
  connectedClients: number;
  apply: { status: 'active' | 'outdated' | 'error' | null; error: string | null; revision: string | null };
};

// Pushed on the live socket by the entry node's heartbeat (every ~5s).
export type VpnStatsLiveEvent = {
  nodeId: string;
  peers: Array<{ profileId: string; lastHandshakeAt: string | null; endpoint: string | null; rxBytes: number; txBytes: number }>;
};

// Mirrors API_KEY_RESOURCES in apps/api/src/api-keys/api-key-token.ts.
// --- Firewall ---------------------------------------------------------
export type FirewallMode = 'open' | 'observe' | 'enforce';
export type FirewallScope = 'mesh' | 'public';
export type FirewallProtocol = 'any' | 'tcp' | 'udp' | 'tcpudp' | 'icmp';
export type FirewallVerdict = 'allowed' | 'blocked' | 'observed';
export type FirewallExposure = 'public' | 'restricted' | 'closed' | 'observed' | 'local';
export type FirewallApplyStatus = 'off' | 'pending' | 'active' | 'error' | 'outdated' | 'offline';

export type FirewallListen = {
  protocol: 'tcp' | 'udp';
  port: number;
  addresses: string[];
  processes: string[];
  service: string | null;
  exposure: FirewallExposure;
  exposureIfEnforced: FirewallExposure;
  // Tarmac flow keeping it open (WireGuard, SSH guard, VPN, DNS), if any.
  managedBy: string | null;
};

export type FirewallNode = {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'degraded';
  vlanIp: string | null;
  labels: string[];
  locationCountryCode: string | null;
  locationCity: string | null;
  publicMode: FirewallMode;
  apply: { status: FirewallApplyStatus; message: string | null };
  // Whether this node's agent throttles SSH attempts (needs a recent agent).
  sshLimit: 'on' | 'off' | 'unsupported' | 'unknown';
  blocked24h: number;
  report: {
    uplinks: string[];
    docker: boolean;
    logging: boolean;
    reportedAt: string;
    listening: FirewallListen[];
  } | null;
};

export type FirewallRule = {
  id: string;
  scope: FirewallScope;
  action: 'allow' | 'deny';
  name: string;
  description: string | null;
  enabled: boolean;
  expired: boolean;
  inert: boolean;
  sourceKind: 'any' | 'nodes' | 'labels' | 'cidrs' | 'lists';
  sourceNodeIds: string[];
  sourceLabels: string[];
  sourceCidrs: string[];
  // Address lists (internet rules), see FirewallAddressList.
  sourceListIds: string[];
  targetKind: 'any' | 'nodes' | 'labels';
  targetNodeIds: string[];
  targetLabels: string[];
  protocol: FirewallProtocol;
  ports: string[];
  service: string;
  expiresAt: string | null;
  hitCount: number;
  lastHitAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FirewallRulePayload = Omit<
  FirewallRule,
  'id' | 'expired' | 'inert' | 'service' | 'hitCount' | 'lastHitAt' | 'createdAt' | 'updatedAt' | 'enabled' | 'description' | 'expiresAt'
> & { enabled?: boolean; description?: string | null; expiresAt?: string | null };

export type FirewallSystemFlow = {
  id: string;
  scope: FirewallScope;
  kind: 'supervision' | 'dns' | 'nfs' | 'ssh' | 'vpn' | 'wireguard' | 'ssh-guard';
  label: string;
  detail: string;
  sourceNodeIds: string[] | 'all';
  targetNodeId: string;
  protocol: FirewallProtocol;
  ports: string[];
  service: string;
};

export type FirewallMatrixCell = {
  sourceNodeId: string;
  targetNodeId: string;
  status: 'open' | 'partial' | 'blocked' | 'observed';
  allowed: string[];
  blocked: string[];
};

export type FirewallOverview = {
  settings: { meshMode: FirewallMode; publicPing: boolean; sshGuard: boolean; sshLimit: boolean; eventRetentionDays: number };
  nodes: FirewallNode[];
  rules: FirewallRule[];
  lists: FirewallAddressList[];
  system: FirewallSystemFlow[];
  matrix: FirewallMatrixCell[];
  labels: string[];
  stats: { blocked24h: number; observed24h: number; rules: number; protectedNodes: number };
};

/** A named set of internet addresses, usable as the source of internet rules. */
export type FirewallAddressList = {
  id: string;
  name: string;
  description: string | null;
  cidrs: string[];
  // Ids of the rules using it.
  usedBy: string[];
  updatedAt: string;
};

export type FirewallEvent = {
  id: string;
  nodeId: string;
  scope: FirewallScope;
  verdict: 'blocked' | 'observed';
  sourceIp: string;
  sourceNodeId: string | null;
  sources: string[];
  protocol: string;
  port: number | null;
  service: string | null;
  docker: boolean;
  ruleId: string | null;
  count: number;
  firstSeenAt: string;
  lastSeenAt: string;
  // Marked "seen, nothing to do": hidden by default, not counted as to review.
  dismissed: boolean;
};

export type FirewallTestRequest = {
  scope: FirewallScope;
  targetNodeId: string;
  sourceNodeId?: string;
  sourceIp?: string;
  protocol: 'tcp' | 'udp' | 'icmp';
  port?: number;
};

export type FirewallEvaluation = {
  verdict: FirewallVerdict;
  reason: string;
  match: { type: 'rule' | 'system' | 'mode' | 'infrastructure'; id?: string; name?: string };
};

export type FirewallTestResult = FirewallEvaluation & { mode: FirewallMode; ifEnforced: FirewallEvaluation | null };

export type ApiKeyResource = 'nodes' | 'storage' | 'network' | 'firewall' | 'dns' | 'vpn' | 'alerts' | 'logs';
export type ApiKeyScope = `${ApiKeyResource}:${'read' | 'write'}`;

export type ApiKeyItem = {
  id: string;
  name: string;
  prefix: string;
  scopes: ApiKeyScope[];
  createdByUserId: string | null;
  createdBy: { id: string; email: string; name?: string | null } | null;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

export type AuditActor = { id: string; name: string; email: string };

export type AuditLogItem = {
  id: string;
  actorUserId?: string | null;
  actor?: AuditActor | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  details?: unknown;
  createdAt: string;
};

export type AgentLogItem = {
  id: string;
  nodeId: string;
  level: string;
  message: string;
  createdAt: string;
};

export type PagedResult<T> = { items: T[]; nextCursor: string | null };

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
};

export type WorkspaceDetail = {
  id: string;
  name: string;
  slug: string;
  // Slugs it had before a rename, still redirecting to `slug`.
  previousSlugs: string[];
  ssoGroupClaim: string | null;
  isDefault: boolean;
  subnetIndex: number | null;
  // Owner: counted in their creation limit, receives the weekly report.
  createdById: string | null;
  weeklyReportEnabled: boolean;
  // Days the firewall Activity and the agents' logs are kept.
  firewallEventRetentionDays: number;
  agentLogRetentionDays: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceHealthStatus = 'empty' | 'ok' | 'warning' | 'critical';
export type WorkspaceHealth = {
  status: WorkspaceHealthStatus;
  nodesTotal: number;
  nodesOnline: number;
  alertsOpen: number;
  alertsSevere: number;
};

// list() additionally annotates each workspace with the caller's own role
// and member count - create()/update() return a plain WorkspaceDetail.
export type WorkspaceListItem = WorkspaceDetail & {
  memberCount: number;
  // The caller owns it (created it, or received it by transfer).
  isOwner: boolean;
  owner: { id: string; name?: string | null; email: string } | null;
  health: WorkspaceHealth;
  myRole: 'owner' | 'member' | null;
  // Everything for owners and platform admins; a member's grants otherwise.
  myPermissions: ApiKeyScope[];
};

export type WorkspaceRole = 'owner' | 'member';
export type MemberAccess = { role?: WorkspaceRole; permissions?: ApiKeyScope[]; customRoleId?: string | null };

export type WorkspaceCustomRole = {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  permissions: ApiKeyScope[];
  memberCount: number;
  invitationCount: number;
  createdAt: string;
  updatedAt: string;
};

export type WorkspaceInvitation = {
  id: string;
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  permissions: ApiKeyScope[];
  customRoleId: string | null;
  customRole: { id: string; name: string } | null;
  invitedBy: string | null;
  lastSentAt: string | null;
  expiresAt: string;
  expired: boolean;
  createdAt: string;
};

export type InviteResult =
  | { status: 'added'; membership: WorkspaceMember; emailed: boolean }
  | { status: 'invited'; invitation: WorkspaceInvitation & { emailed: boolean } };

export type WorkspaceMember = {
  id: string;
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  permissions: ApiKeyScope[];
  source: 'manual' | 'sso' | 'invitation';
  customRoleId: string | null;
  customRole: { id: string; name: string } | null;
  // Owner of the workspace (Workspace.createdById).
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
  user: { id: string; email: string; name?: string | null; avatarUrl?: string | null };
};

export type WorkspaceUserOption = {
  id: string;
  email: string;
  name?: string | null;
  isSuperuser: boolean;
};

// One row of the platform-admin user list (/admin).
export type AdminUser = {
  id: string;
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
  isSuperuser: boolean;
  // In the Authentik access group at their last login.
  canCreateWorkspaces: boolean;
  // Per-user override; null follows the platform default.
  workspaceLimit: number | null;
  effectiveLimit: number;
  createdCount: number;
  membershipCount: number;
  // Disabled from /admin: can't sign in, sessions cut.
  disabledAt: string | null;
  // Last confirmation of the access group by the Authentik sync.
  accessCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminUserList = { defaultLimit: number; users: AdminUser[] };

export type AdminUserDetail = {
  id: string;
  email: string;
  name?: string | null;
  isSuperuser: boolean;
  disabledAt: string | null;
  workspaces: {
    id: string;
    name: string;
    slug: string;
    isOwner: boolean;
    roleLabel: string | null;
    memberCount: number;
    nodeCount: number;
    joinedAt: string | null;
  }[];
  history: { id: string; action: string; details: Record<string, unknown> | null; createdAt: string; actor: string | null }[];
};

export type AccessSyncStatus = {
  configured: boolean;
  lastRunAt: string | null;
  ok: boolean | null;
  message: string | null;
  checked: number;
  revoked: string[];
  restored: string[];
};

export type AdminSettings = {
  defaultWorkspaceLimit: number;
  defaultWorkspaceLimitSource: 'admin' | 'environment';
  environmentWorkspaceLimit: number;
  defaultWorkspaceLimitUpdatedAt: string | null;
  accessSync: AccessSyncStatus;
  mail: { configured: boolean; from: string };
};

export type EmailTemplatePreview = {
  id: string;
  name: string;
  trigger: string;
  audience: string;
  subject: string;
  html: string;
  text: string;
};

export type AdminProfile = {
  id: string;
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
  isSuperuser: boolean;
  // Member of the Authentik access group: may sign in and create workspaces.
  canCreateWorkspaces: boolean;
  // Workspaces this user created vs. how many they may; null for platform
  // admins (no limit) and users who can't create any.
  workspaceQuota: { used: number; limit: number } | null;
  internalEmail?: string | null;
  alertEmailsEnabled: boolean;
  // Where alert emails actually go: the internal address found at the last
  // SSO login, or the sign-up address when there is none.
  alertEmail: {
    address: string | null;
    source: 'internal' | 'account';
    internalDomain: string;
    mailConfigured: boolean;
  };
  createdAt: string;
  updatedAt: string;
  workspaces: WorkspaceSummary[];
};

const CURRENT_WORKSPACE_STORAGE_KEY = 'tarmac.currentWorkspaceId';

// Read fresh on every request rather than cached in a module variable, so a
// switcher-driven change (see workspace-context.tsx) takes effect on the
// very next API call without needing to thread state through every caller.
export function getCurrentWorkspaceId(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(CURRENT_WORKSPACE_STORAGE_KEY);
}

export function setCurrentWorkspaceId(workspaceId: string | null) {
  if (typeof window === 'undefined') return;
  if (workspaceId) {
    window.localStorage.setItem(CURRENT_WORKSPACE_STORAGE_KEY, workspaceId);
  } else {
    window.localStorage.removeItem(CURRENT_WORKSPACE_STORAGE_KEY);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const workspaceId = getCurrentWorkspaceId();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
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
    throw new ApiError(message, res.status);
  }

  return res.json() as Promise<T>;
}

/**
 * Downloads an export (CSV / JSON) as a file. Goes through fetch rather than
 * a plain link so the request carries the workspace being viewed, like
 * every other call - a link can't send the X-Workspace-Id header.
 */
async function download(path: string, filename: string): Promise<void> {
  const workspaceId = getCurrentWorkspaceId();
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: workspaceId ? { 'X-Workspace-Id': workspaceId } : {},
  });
  if (!res.ok) throw new ApiError(res.status === 403 ? 'Vous n’avez pas accès à cet export.' : 'L’export a échoué. Réessayez dans un instant.', res.status);
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const today = () => new Date().toISOString().slice(0, 10);

function queryOf(params: Record<string, string | number | undefined>): string {
  return new URLSearchParams(
    Object.entries(params)
      .filter(([, value]) => value !== undefined && value !== '')
      .map(([key, value]) => [key, String(value)]),
  ).toString();
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

  sso: {
    silentUrl: () => `${API_BASE}/api/v1/auth/sso/silent`,
    loginUrl: () => `${API_BASE}/api/v1/auth/sso/login`,
  },

  profile: {
    get: () => request<AdminProfile>('/api/v1/auth/profile'),
    update: (
      payload: {
        email?: string;
        currentPassword?: string;
        newPassword?: string;
        alertEmailsEnabled?: boolean;
      },
    ) =>
      request<AdminProfile>('/api/v1/auth/profile', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    sendTestEmail: () =>
      request<{ sentTo: string; sentAt: string }>('/api/v1/auth/profile/test-email', { method: 'POST' }),
  },

  nodes: {
    list: () => request<NodeItem[]>('/api/v1/nodes'),
    activity: (range: '1h' | '6h' | '24h' = '1h') =>
      request<NodeActivityItem[]>(`/api/v1/nodes/activity?range=${range}`),
    activitySeries: (range: '1h' | '6h' | '24h' = '1h') =>
      request<NodeActivitySeries>(`/api/v1/nodes/activity/series?range=${range}`),
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
        locationLat?: number | null;
        locationLng?: number | null;
        graphX?: number | null;
        graphY?: number | null;
        dnsHostname?: string | null;
        smartMonitoringEnabled?: boolean;
        labels?: string[];
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

  dns: {
    groups: {
      list: () => request<DnsServerGroupItem[]>('/api/v1/dns/groups'),
      create: (payload: { name: string }) =>
        request<DnsServerGroupItem>('/api/v1/dns/groups', { method: 'POST', body: JSON.stringify(payload) }),
      delete: (id: string) => request<{ cleanupSent: boolean }>(`/api/v1/dns/groups/${id}`, { method: 'DELETE' }),
      addMember: (
        groupId: string,
        payload: { nodeId: string; role: 'primary' | 'secondary'; status: 'pending' | 'active' | 'error' },
      ) =>
        request<DnsServerGroupMemberItem>(`/api/v1/dns/groups/${groupId}/members`, {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      removeMember: (groupId: string, nodeId: string) =>
        request<{ cleanupSent: boolean }>(`/api/v1/dns/groups/${groupId}/members/${nodeId}`, { method: 'DELETE' }),
      runMaintenance: (groupId: string, nodeId: string, payload: { upgrade?: boolean }) =>
        request<{ sent: boolean }>(`/api/v1/dns/groups/${groupId}/members/${nodeId}/maintenance`, {
          method: 'POST',
          body: JSON.stringify(payload),
        }),
      resolvePortConflict: (groupId: string, nodeId: string) =>
        request<DnsServerGroupMemberItem>(`/api/v1/dns/groups/${groupId}/members/${nodeId}/resolve-port-conflict`, {
          method: 'POST',
        }),
    },
    zones: {
      list: (groupId?: string) =>
        request<DnsZoneItem[]>(`/api/v1/dns/zones${groupId ? `?groupId=${encodeURIComponent(groupId)}` : ''}`),
      create: (payload: { groupId: string; name: string; dnssecEnabled?: boolean }) =>
        request<DnsZoneItem>('/api/v1/dns/zones', { method: 'POST', body: JSON.stringify(payload) }),
      delete: (id: string) => request<void>(`/api/v1/dns/zones/${id}`, { method: 'DELETE' }),
      reapply: (id: string) => request<DnsZoneItem>(`/api/v1/dns/zones/${id}/reapply`, { method: 'POST' }),
      update: (id: string, payload: { dnssecEnabled?: boolean }) =>
        request<DnsZoneItem>(`/api/v1/dns/zones/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
      getDnssecKeys: (zoneId: string) =>
        request<{ dsRecords: string[]; dnskeyRecords: string[] }>(`/api/v1/dns/zones/${zoneId}/dnssec`),
      getDelegation: (zoneId: string) =>
        request<{
          nsHostnames: string[];
          glue: Array<{ host: string; ip: string }>;
          verified: boolean;
          checkedAt: string | null;
          detail: DnsDelegationNameserverResult[] | null;
        }>(`/api/v1/dns/zones/${zoneId}/delegation`),
      recheckDelegation: (zoneId: string) =>
        request<{ verified: boolean; checkedAt: string; detail: DnsDelegationNameserverResult[] }>(
          `/api/v1/dns/zones/${zoneId}/delegation/check`,
          { method: 'POST' },
        ),
      upsertRecord: (
        zoneId: string,
        payload: {
          name: string;
          type: DnsRecordType;
          ttl?: number;
          isGeo?: boolean;
          values: Array<{ content: string; nodeId?: string; priority?: number }>;
        },
      ) => request<DnsRecordItem>(`/api/v1/dns/zones/${zoneId}/records`, { method: 'POST', body: JSON.stringify(payload) }),
      deleteRecord: (zoneId: string, recordId: string) =>
        request<void>(`/api/v1/dns/zones/${zoneId}/records/${recordId}`, { method: 'DELETE' }),
    },
    recordsForNode: (nodeId: string) => request<DnsNodeRecordRef[]>(`/api/v1/dns/nodes/${nodeId}/records`),
    internal: {
      getStatus: () =>
        request<{
          internalDnsNodeId: string | null;
          internalDnsStatus: 'pending' | 'active' | 'error';
          internalDnsError: string | null;
          records: Array<{ name: string; content: string }>;
        }>('/api/v1/dns/internal'),
      retry: () => request<{ sent: boolean }>('/api/v1/dns/internal/retry', { method: 'POST' }),
      designate: (nodeId: string) =>
        request<{ nodeId: string; applySent: boolean }>(`/api/v1/dns/internal/${nodeId}`, { method: 'POST' }),
      clear: () => request<{ cleanupSent: boolean }>('/api/v1/dns/internal', { method: 'DELETE' }),
      resolveForwarderConflict: (nodeId: string) =>
        request<{ sent: boolean }>(`/api/v1/dns/internal/forwarder/${nodeId}/resolve-conflict`, { method: 'POST' }),
    },
  },

  alerts: {
    list: () => request<AlertItem[]>('/api/v1/alerts'),
    download: (params: { from?: string; to?: string; format: 'csv' | 'json' }) =>
      download(`/api/v1/alerts/export?${queryOf(params)}`, `alertes-${today()}.${params.format}`),
    ack: (id: string) => request(`/api/v1/alerts/${id}/ack`, { method: 'POST' }),
    resolve: (id: string) => request(`/api/v1/alerts/${id}/resolve`, { method: 'POST' }),
    remove: (id: string) => request(`/api/v1/alerts/${id}`, { method: 'DELETE' }),
    removeMany: (ids: string[]) =>
      request<{ count: number }>('/api/v1/alerts', { method: 'DELETE', body: JSON.stringify({ ids }) }),
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
    getHistory: (vlanId: string, sourceNodeId: string, targetNodeId: string, range: '1h' | '24h' | '7d' = '1h') =>
      request<VlanConnectionHistory>(
        `/api/v1/vlan/${vlanId}/history?source=${encodeURIComponent(sourceNodeId)}&target=${encodeURIComponent(targetNodeId)}&range=${range}`,
      ),
    runTest: (vlanId: string, initiatorNodeId: string, targetNodeId: string, testType: 'ping' | 'traceroute') =>
      request<{ success: boolean; test: VlanConnectionTest }>(`/api/v1/vlan/${vlanId}/test`, {
        method: 'POST',
        body: JSON.stringify({ initiatorNodeId, targetNodeId, testType }),
      }),
    setGateway: (vlanId: string, nodeId: string, role: 'primary' | 'backup' | null) =>
      request<{ success: boolean; nodeId: string; role: 'primary' | 'backup' | null; region: VlanRegion | null }>(
        `/api/v1/vlan/${vlanId}/members/${nodeId}/gateway`,
        {
          method: 'POST',
          body: JSON.stringify({ role }),
        },
      ),
    heartbeat: (nodeId: string, vlanId?: string) =>
      request<{ success: boolean; membership: VlanMember | null }>('/api/v1/vlan/heartbeat', {
        method: 'POST',
        body: JSON.stringify({ nodeId, vlanId }),
      }),
  },

  auditLogs: {
    list: (params: {
      before?: string;
      from?: string;
      limit?: number;
      actorUserId?: string;
      action?: string;
      resourceType?: string;
      q?: string;
    } = {}) => {
      const query = new URLSearchParams();
      if (params.before) query.set('before', params.before);
      if (params.from) query.set('from', params.from);
      if (params.limit) query.set('limit', String(params.limit));
      if (params.actorUserId) query.set('actorUserId', params.actorUserId);
      if (params.action) query.set('action', params.action);
      if (params.resourceType) query.set('resourceType', params.resourceType);
      if (params.q) query.set('q', params.q);
      return request<PagedResult<AuditLogItem> & { refs?: Record<string, string> }>(`/api/v1/audit-logs?${query.toString()}`);
    },
    facets: () => request<{ actions: string[]; resourceTypes: string[]; actors: AuditActor[] }>('/api/v1/audit-logs/facets'),
    download: (params: { from: string; to: string; format: 'csv' | 'json' }) =>
      download(`/api/v1/audit-logs/export?${queryOf(params)}`, `journal-actions-${today()}.${params.format}`),
    // Superusers only. Either `ids`, or everything matching the filters.
    remove: (payload: { ids?: string[]; from?: string; actorUserId?: string; resourceType?: string; q?: string }) =>
      request<{ deleted: number }>('/api/v1/audit-logs/delete', { method: 'POST', body: JSON.stringify(payload) }),
  },

  agentLogs: {
    list: (params: { nodeId?: string; level?: string; before?: string; from?: string; limit?: number } = {}) => {
      const query = new URLSearchParams();
      if (params.nodeId) query.set('nodeId', params.nodeId);
      if (params.level) query.set('level', params.level);
      if (params.before) query.set('before', params.before);
      if (params.from) query.set('from', params.from);
      if (params.limit) query.set('limit', String(params.limit));
      return request<PagedResult<AgentLogItem>>(`/api/v1/agent-logs?${query.toString()}`);
    },
    download: (params: { from: string; to: string; format: 'csv' | 'json'; nodeId?: string }) =>
      download(`/api/v1/agent-logs/export?${queryOf(params)}`, `journal-agents-${today()}.${params.format}`),
    // Superusers only. No `from` = the whole retained history.
    remove: (payload: { nodeId?: string; level?: string; from?: string }) =>
      request<{ deleted: number }>('/api/v1/agent-logs/delete', { method: 'POST', body: JSON.stringify(payload) }),
  },

  vpn: {
    gateways: () => request<VpnGateway[]>('/api/v1/vpn/gateways'),
    list: () => request<VpnProfile[]>('/api/v1/vpn/profiles'),
    get: (id: string) => request<VpnProfile>(`/api/v1/vpn/profiles/${id}`),
    create: (payload: VpnProfilePayload) =>
      request<VpnProfileWithConfig>('/api/v1/vpn/profiles', { method: 'POST', body: JSON.stringify(payload) }),
    update: (id: string, payload: Partial<VpnProfilePayload> & { enabled?: boolean }) =>
      request<VpnProfile>(`/api/v1/vpn/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    switchExit: (id: string, exitNodeId: string | null) =>
      request<VpnProfile>(`/api/v1/vpn/profiles/${id}/exit`, { method: 'POST', body: JSON.stringify({ exitNodeId }) }),
    rotateKeys: (id: string) =>
      request<VpnProfileWithConfig>(`/api/v1/vpn/profiles/${id}/rotate-keys`, { method: 'POST', body: '{}' }),
    remove: (id: string) => request<{ success: boolean }>(`/api/v1/vpn/profiles/${id}`, { method: 'DELETE' }),
    bulk: (ids: string[], action: VpnBulkAction, options: VpnBulkOptions = {}) =>
      request<{ count: number }>('/api/v1/vpn/profiles/bulk', {
        method: 'POST',
        body: JSON.stringify({ ids, action, ...options }),
      }),
    config: (id: string) =>
      request<{ filename: string; config: string; complete: boolean }>(`/api/v1/vpn/profiles/${id}/config`),
  },

  firewall: {
    overview: () => request<FirewallOverview>('/api/v1/firewall'),
    events: (params: { hours?: number; scope?: FirewallScope; verdict?: 'blocked' | 'observed'; nodeId?: string } = {}) => {
      const query = new URLSearchParams(
        Object.entries(params).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]),
      ).toString();
      return request<FirewallEvent[]>(`/api/v1/firewall/events${query ? `?${query}` : ''}`);
    },
    downloadEvents: (params: { hours?: number; scope?: FirewallScope; verdict?: 'blocked' | 'observed'; nodeId?: string; format: 'csv' | 'json' }) =>
      download(`/api/v1/firewall/events/export?${queryOf(params)}`, `pare-feu-activite-${today()}.${params.format}`),
    createList: (payload: { name: string; description?: string | null; cidrs: string[] }) =>
      request<FirewallAddressList>('/api/v1/firewall/lists', { method: 'POST', body: JSON.stringify(payload) }),
    updateList: (id: string, payload: { name?: string; description?: string | null; cidrs?: string[] }) =>
      request<FirewallAddressList>(`/api/v1/firewall/lists/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    removeList: (id: string) => request<{ success: boolean }>(`/api/v1/firewall/lists/${id}`, { method: 'DELETE' }),
    setEventDismissed: (id: string, dismissed: boolean) =>
      request<{ success: boolean }>(`/api/v1/firewall/events/${id}/dismiss`, { method: dismissed ? 'POST' : 'DELETE' }),
    timeline: (params: { hours?: number; scope?: FirewallScope; nodeId?: string } = {}) => {
      const query = new URLSearchParams(
        Object.entries(params).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => [key, String(value)]),
      ).toString();
      return request<Array<{ bucketStart: string; verdict: 'blocked' | 'observed'; count: number }>>(`/api/v1/firewall/events/timeline${query ? `?${query}` : ''}`);
    },
    test: (payload: FirewallTestRequest) =>
      request<FirewallTestResult>('/api/v1/firewall/test', { method: 'POST', body: JSON.stringify(payload) }),
    updateSettings: (payload: Partial<FirewallOverview['settings']>) =>
      request<FirewallOverview>('/api/v1/firewall/settings', { method: 'PATCH', body: JSON.stringify(payload) }),
    setNodesMode: (nodeIds: string[], publicMode: FirewallMode) =>
      request<FirewallOverview>('/api/v1/firewall/nodes', { method: 'PATCH', body: JSON.stringify({ nodeIds, publicMode }) }),
    createRule: (payload: FirewallRulePayload) =>
      request<FirewallRule>('/api/v1/firewall/rules', { method: 'POST', body: JSON.stringify(payload) }),
    updateRule: (id: string, payload: Partial<FirewallRulePayload>) =>
      request<FirewallRule>(`/api/v1/firewall/rules/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    removeRule: (id: string) => request<{ success: boolean }>(`/api/v1/firewall/rules/${id}`, { method: 'DELETE' }),
  },

  apiKeys: {
    list: () => request<ApiKeyItem[]>('/api/v1/api-keys'),
    create: (payload: { name: string; scopes: ApiKeyScope[]; expiresAt?: string }) =>
      request<ApiKeyItem & { token: string }>('/api/v1/api-keys', { method: 'POST', body: JSON.stringify(payload) }),
    update: (id: string, payload: { name?: string; scopes?: ApiKeyScope[]; expiresAt?: string | null }) =>
      request<ApiKeyItem>(`/api/v1/api-keys/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    revoke: (id: string) => request<ApiKeyItem>(`/api/v1/api-keys/${id}/revoke`, { method: 'POST' }),
    remove: (id: string) => request<{ success: boolean }>(`/api/v1/api-keys/${id}`, { method: 'DELETE' }),
  },

  admin: {
    listUsers: () => request<AdminUserList>('/api/v1/admin/users'),
    getUser: (id: string) => request<AdminUserDetail>(`/api/v1/admin/users/${id}`),
    updateUser: (id: string, payload: { workspaceLimit?: number | null; disabled?: boolean }) =>
      request<{ success: boolean }>(`/api/v1/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    settings: () => request<AdminSettings>('/api/v1/admin/settings'),
    updateSettings: (payload: { defaultWorkspaceLimit: number | null }) =>
      request<AdminSettings>('/api/v1/admin/settings', { method: 'PATCH', body: JSON.stringify(payload) }),
    runAccessSync: () => request<AccessSyncStatus>('/api/v1/admin/access-sync', { method: 'POST' }),
    emailTemplates: () => request<EmailTemplatePreview[]>('/api/v1/admin/email-templates'),
    sendTestEmail: (id: string) =>
      request<{ sentTo: string }>(`/api/v1/admin/email-templates/${encodeURIComponent(id)}/test`, { method: 'POST' }),
    github: () => request<GithubDeployKeyOverview>('/api/v1/admin/github'),
    configureGithub: (payload: { repository: string; token?: string }) =>
      request<GithubDeployKeyOverview>('/api/v1/admin/github', { method: 'PUT', body: JSON.stringify(payload) }),
    disconnectGithub: () => request<unknown>('/api/v1/admin/github', { method: 'DELETE' }),
    deleteGithubKey: (id: string) =>
      request<GithubDeployKeyOverview>(`/api/v1/admin/github/keys/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    transferWorkspace: (workspaceId: string, userId: string) =>
      request<{ success: boolean }>(`/api/v1/admin/workspaces/${workspaceId}/transfer`, { method: 'POST', body: JSON.stringify({ userId }) }),
  },

  workspaces: {
    list: () => request<WorkspaceListItem[]>('/api/v1/workspaces'),
    create: (payload: { name: string; slug?: string }) =>
      request<WorkspaceDetail>('/api/v1/workspaces', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    update: (
      id: string,
      payload: { name?: string; slug?: string; ssoGroupClaim?: string; weeklyReportEnabled?: boolean; firewallEventRetentionDays?: number; agentLogRetentionDays?: number },
    ) =>
      request<WorkspaceDetail>(`/api/v1/workspaces/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    listUsers: () => request<WorkspaceUserOption[]>('/api/v1/workspaces/users'),
    listMembers: (id: string) => request<WorkspaceMember[]>(`/api/v1/workspaces/${id}/members`),
    addMember: (id: string, userId: string) =>
      request<WorkspaceMember>(`/api/v1/workspaces/${id}/members/${userId}`, { method: 'POST' }),
    invite: (id: string, email: string, access?: MemberAccess) =>
      request<InviteResult>(`/api/v1/workspaces/${id}/invite`, {
        method: 'POST',
        body: JSON.stringify({ email, ...access }),
      }),
    updateMember: (id: string, userId: string, access: MemberAccess) =>
      request<WorkspaceMember>(`/api/v1/workspaces/${id}/members/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify(access),
      }),
    removeMember: (id: string, userId: string) =>
      request<{ success: boolean }>(`/api/v1/workspaces/${id}/members/${userId}`, { method: 'DELETE' }),
    delete: (id: string) => request<{ success: boolean }>(`/api/v1/workspaces/${id}`, { method: 'DELETE' }),
    invitations: (id: string) => request<WorkspaceInvitation[]>(`/api/v1/workspaces/${id}/invitations`),
    resendInvitation: (id: string, invitationId: string) =>
      request<WorkspaceInvitation>(`/api/v1/workspaces/${id}/invitations/${invitationId}/resend`, { method: 'POST' }),
    revokeInvitation: (id: string, invitationId: string) =>
      request<{ success: boolean }>(`/api/v1/workspaces/${id}/invitations/${invitationId}`, { method: 'DELETE' }),
    roles: (id: string) => request<WorkspaceCustomRole[]>(`/api/v1/workspaces/${id}/roles`),
    createRole: (id: string, payload: { name: string; description?: string; permissions: ApiKeyScope[] }) =>
      request<WorkspaceCustomRole>(`/api/v1/workspaces/${id}/roles`, { method: 'POST', body: JSON.stringify(payload) }),
    updateRole: (id: string, roleId: string, payload: { name?: string; description?: string; permissions?: ApiKeyScope[] }) =>
      request<WorkspaceCustomRole>(`/api/v1/workspaces/${id}/roles/${roleId}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    deleteRole: (id: string, roleId: string) =>
      request<{ success: boolean }>(`/api/v1/workspaces/${id}/roles/${roleId}`, { method: 'DELETE' }),
    transfer: (id: string, userId: string, keepAdmin = true) =>
      request<{ success: boolean }>(`/api/v1/workspaces/${id}/transfer`, { method: 'POST', body: JSON.stringify({ userId, keepAdmin }) }),
    weeklyReportPreview: (id: string) =>
      request<{ sentTo: string }>(`/api/v1/workspaces/${id}/weekly-report/preview`, { method: 'POST' }),
  },

  system: {
    version: () => request<{ version: string | null }>('/api/v1/system/version'),
  },
};
