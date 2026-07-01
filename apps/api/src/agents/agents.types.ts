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
  type: 'command.apply_export' | 'command.apply_mount' | 'command.apply_pool' | 'command.run_rsync';
  payload: Record<string, unknown>;
}

export interface CommandResultPayload {
  command: 'apply_export' | 'apply_mount' | 'apply_pool' | 'run_rsync';
  resourceType: 'share' | 'mount' | 'pool_member' | 'sync_job_run';
  resourceId: string;
  success: boolean;
  message?: string;
}
