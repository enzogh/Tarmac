export interface HeartbeatPayload {
  nodeId: string;
  metrics: {
    cpu: number;
    ram: number;
    disk: number;
    networkRx?: number;
    networkTx?: number;
    ioRead?: number;
    ioWrite?: number;
  };
  overlay?: {
    publicKey?: string;
    endpoint?: string;
    listenPort?: number;
    sshPublicKey?: string;
    sshUser?: string;
  };
  linkMetrics?: Array<{
    targetPublicKey: string;
    targetVlanIp?: string;
    handshakeAgeSec?: number;
    txMbps?: number;
    rxMbps?: number;
    latencyMs?: number;
    packetLoss?: number;
  }>;
}

export interface StateReportPayload {
  nodeId: string;
  disks: Array<{
    name: string;
    mountPath: string;
    type: 'hdd' | 'ssd' | 'nvme';
    health: 'healthy' | 'warning' | 'critical' | 'unknown';
    capacityGb: number;
    usedGb: number;
  }>;
  smartReports: Array<{
    diskName: string;
    temperatureC: number;
    reallocatedSectors: number;
    pendingSectors: number;
    powerOnHours: number;
    overall: 'healthy' | 'warning' | 'critical' | 'unknown';
  }>;
}

export interface CommandPayload {
  type:
    | 'command.apply_export'
    | 'command.apply_mount'
    | 'command.apply_pool'
    | 'command.run_rsync'
    | 'command.stop_rsync'
    | 'command.apply_overlay'
    | 'command.list_directories'
    | 'command.apply_ssh_authorized_keys'
    | 'command.update_agent';
  payload: Record<string, unknown>;
}

export interface CommandResultPayload {
  command:
    | 'apply_export'
    | 'apply_mount'
    | 'apply_pool'
    | 'run_rsync'
    | 'stop_rsync'
    | 'apply_overlay'
    | 'list_directories'
    | 'apply_ssh_authorized_keys'
    | 'update_agent';
  resourceType:
    | 'share'
    | 'mount'
    | 'pool_member'
    | 'sync_job_run'
    | 'overlay'
    | 'directory_list'
    | 'migration'
    | 'agent';
  resourceId: string;
  success: boolean;
  message?: string;
  data?: {
    basePath: string;
    directories: string[];
  };
}

export interface CommandProgressPayload {
  command: 'run_rsync';
  resourceType: 'sync_job_run' | 'migration';
  resourceId: string;
  progress: number;
  message?: string;
}
