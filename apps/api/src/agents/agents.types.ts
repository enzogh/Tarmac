export interface HeartbeatPayload {
  nodeId: string;
  version?: string;
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
    physicalDisks?: string[];
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
    | 'command.remove_mount'
    | 'command.apply_pool'
    | 'command.run_rsync'
    | 'command.stop_rsync'
    | 'command.apply_overlay'
    | 'command.list_directories'
    | 'command.list_remote_directories'
    | 'command.scan_directory_sizes'
    | 'command.run_traceroute'
    | 'command.apply_ssh_authorized_keys'
    | 'command.update_agent'
    | 'command.uninstall_agent'
    | 'command.rotate_token'
    | 'command.apply_dns_server_group'
    | 'command.apply_dns_zone'
    | 'command.apply_dns_zone_slave'
    | 'command.remove_dns_zone'
    | 'command.uninstall_dns_node'
    | 'command.dns_get_zone_keys'
    | 'command.dns_resolve_port_conflict'
    | 'command.setup_internal_dns'
    | 'command.remove_internal_dns'
    | 'command.ensure_internal_dns_route';
  payload: Record<string, unknown>;
}

export interface CommandResultPayload {
  command:
    | 'apply_export'
    | 'apply_mount'
    | 'remove_mount'
    | 'apply_pool'
    | 'run_rsync'
    | 'stop_rsync'
    | 'apply_overlay'
    | 'list_directories'
    | 'list_remote_directories'
    | 'scan_directory_sizes'
    | 'run_traceroute'
    | 'apply_ssh_authorized_keys'
    | 'update_agent'
    | 'uninstall_agent'
    | 'rotate_token'
    | 'apply_dns_server_group'
    | 'apply_dns_zone'
    | 'apply_dns_zone_slave'
    | 'remove_dns_zone'
    | 'dns_get_zone_keys'
    | 'dns_resolve_port_conflict';
  resourceType:
    | 'share'
    | 'mount'
    | 'mount_cleanup'
    | 'pool_member'
    | 'sync_job_run'
    | 'overlay'
    | 'directory_list'
    | 'directory_scan'
    | 'traceroute'
    | 'migration'
    | 'agent'
    | 'dns_server_group_member'
    | 'dns_zone'
    | 'dns_zone_slave'
    | 'dns_zone_keys';
  resourceId: string;
  success: boolean;
  message?: string;
  data?: {
    basePath?: string;
    directories?: string[];
    entries?: Array<{
      path: string;
      sizeBytes: number;
    }>;
    truncated?: boolean;
    targetIp?: string;
    hops?: Array<{
      hop: number;
      ip: string | null;
      latencyMs: number | null;
    }>;
    // Set by the agent on `apply_dns_server_group` when it can't bind port
    // 53 - surfaced to the user as a banner offering "kill & retry" or
    // "cancel and pick another node" (see DnsServerGroupMember.conflictDetail).
    portConflict?: {
      port: number;
      protocol: 'tcp' | 'udp';
      pid: number | null;
      processName: string | null;
    };
    // Set on `apply_dns_server_group` by whichever member is `primary`: the
    // TSIG key it generated for zone transfer, echoed back so Tarmac can
    // hand it to secondaries on their next reconcile tick.
    dnsTsigKeySecret?: string;
    // Set by `dns_get_zone_keys`.
    dns?: { dsRecords?: string[]; dnskeyRecords?: string[] };
  };
}

export interface AgentLogPayload {
  nodeId: string;
  level: string;
  message: string;
  timestamp?: string;
}

export interface CommandProgressPayload {
  command: 'run_rsync';
  resourceType: 'sync_job_run' | 'migration';
  resourceId: string;
  progress: number;
  message?: string;
}
