// Pure firewall logic shared by the apply pipeline, the connection tester
// and the access matrix, so what the dashboard predicts is exactly what the
// agents enforce (see apps/agent/firewall.go for the chains themselves).

export type FwScope = 'mesh' | 'public';
export type FwMode = 'open' | 'observe' | 'enforce';
export type FwAction = 'allow' | 'deny';
export type FwProtocol = 'any' | 'tcp' | 'udp' | 'tcpudp' | 'icmp';
export type FwSourceKind = 'any' | 'nodes' | 'labels' | 'cidrs';
export type FwTargetKind = 'any' | 'nodes' | 'labels';

export const FW_MODES: FwMode[] = ['open', 'observe', 'enforce'];
export const FW_PROTOCOLS: FwProtocol[] = ['any', 'tcp', 'udp', 'tcpudp', 'icmp'];

export type PolicyNode = {
  id: string;
  name: string;
  vlanIp: string | null;
  labels: string[];
  publicMode: FwMode;
  // Ports sshd listens on, as last reported (22 when unknown).
  sshPorts: number[];
};

export type PolicyRule = {
  id: string;
  scope: FwScope;
  action: FwAction;
  name: string;
  enabled: boolean;
  sourceKind: FwSourceKind;
  sourceNodeIds: string[];
  sourceLabels: string[];
  sourceCidrs: string[];
  targetKind: FwTargetKind;
  targetNodeIds: string[];
  targetLabels: string[];
  protocol: FwProtocol;
  ports: string[];
  expiresAt: Date | null;
};

// A flow Tarmac itself needs (a sync job's SSH, an NFS mount, the internal
// DNS...). Always allowed, shown read-only in the dashboard.
export type SystemFlow = {
  id: string;
  scope: FwScope;
  kind: 'supervision' | 'dns' | 'nfs' | 'ssh' | 'vpn' | 'wireguard' | 'ssh-guard';
  label: string;
  detail: string;
  // 'all' = every node of the workspace (mesh) / the whole internet (public).
  sourceNodeIds: string[] | 'all';
  targetNodeId: string;
  protocol: FwProtocol;
  ports: string[];
};

export type PolicyContext = {
  meshMode: FwMode;
  publicPing: boolean;
  sshGuard: boolean;
  nodes: PolicyNode[];
  rules: PolicyRule[];
  system: SystemFlow[];
  now?: Date;
};

export type AgentRule = { id: string; sources: string[]; protocol: FwProtocol; ports: string[] };
export type AgentZone = { mode: FwMode; denies: AgentRule[]; allows: AgentRule[] };
export type AgentPayload = {
  revision: string;
  meshInterface: string;
  ping: boolean;
  mesh: AgentZone;
  public: AgentZone;
};

const PORT_PATTERN = /^(\d{1,5})(?:-(\d{1,5}))?$/;

export function parsePortRange(raw: string): { low: number; high: number } | null {
  const match = PORT_PATTERN.exec(raw.trim());
  if (!match) return null;
  const low = Number(match[1]);
  const high = match[2] ? Number(match[2]) : low;
  if (low < 1 || high > 65535 || high < low) return null;
  return { low, high };
}

export function isRuleLive(rule: PolicyRule, now: Date): boolean {
  return rule.enabled && (!rule.expiresAt || rule.expiresAt > now);
}

export function ruleTargets(rule: Pick<PolicyRule, 'targetKind' | 'targetNodeIds' | 'targetLabels'>, nodes: PolicyNode[]) {
  if (rule.targetKind === 'any') return nodes;
  if (rule.targetKind === 'nodes') {
    const ids = new Set(rule.targetNodeIds);
    return nodes.filter((node) => ids.has(node.id));
  }
  const labels = new Set(rule.targetLabels.map((label) => label.toLowerCase()));
  return nodes.filter((node) => node.labels.some((label) => labels.has(label.toLowerCase())));
}

/** Nodes a mesh rule's sources resolve to; null = any source. */
export function ruleSourceNodes(rule: PolicyRule, nodes: PolicyNode[]): PolicyNode[] | null {
  if (rule.sourceKind === 'any') return null;
  if (rule.sourceKind === 'nodes') {
    const ids = new Set(rule.sourceNodeIds);
    return nodes.filter((node) => ids.has(node.id));
  }
  if (rule.sourceKind === 'labels') {
    const labels = new Set(rule.sourceLabels.map((label) => label.toLowerCase()));
    return nodes.filter((node) => node.labels.some((label) => labels.has(label.toLowerCase())));
  }
  return [];
}

/**
 * The sources an agent must match for this rule, or null when the rule
 * can't apply (all of its source nodes are gone, a mesh rule naming CIDRs):
 * it must then be skipped - never widened to "any source".
 */
function agentSources(rule: PolicyRule, nodes: PolicyNode[]): string[] | null {
  if (rule.sourceKind === 'any') return [];
  if (rule.scope === 'public') {
    if (rule.sourceKind !== 'cidrs') return null;
    return rule.sourceCidrs.length > 0 ? rule.sourceCidrs : null;
  }
  const sourceNodes = ruleSourceNodes(rule, nodes) ?? [];
  const ips = sourceNodes.map((node) => node.vlanIp).filter((ip): ip is string => Boolean(ip));
  return ips.length > 0 ? ips.map((ip) => `${ip}/32`) : null;
}

function systemSources(flow: SystemFlow, nodes: PolicyNode[]): string[] | null {
  if (flow.sourceNodeIds === 'all') return [];
  const ids = new Set(flow.sourceNodeIds);
  const ips = nodes.filter((node) => ids.has(node.id) && node.vlanIp).map((node) => `${node.vlanIp}/32`);
  return ips.length > 0 ? ips : null;
}

export function buildAgentPayload(ctx: PolicyContext, nodeId: string, revision: string): AgentPayload {
  const now = ctx.now ?? new Date();
  const node = ctx.nodes.find((candidate) => candidate.id === nodeId);
  const zone = (mode: FwMode): AgentZone => ({ mode, denies: [], allows: [] });
  const payload: AgentPayload = {
    revision,
    meshInterface: 'tarmacwg0',
    ping: ctx.publicPing,
    mesh: zone(node?.vlanIp ? ctx.meshMode : 'open'),
    public: zone(node?.publicMode ?? 'open'),
  };
  if (!node) return payload;

  for (const flow of ctx.system) {
    if (flow.targetNodeId !== nodeId) continue;
    const sources = systemSources(flow, ctx.nodes);
    if (sources === null) continue;
    payload[flow.scope === 'mesh' ? 'mesh' : 'public'].allows.push({
      id: `sys:${flow.id}`.slice(0, 80),
      sources,
      protocol: flow.protocol,
      ports: flow.ports,
    });
  }
  for (const rule of ctx.rules) {
    if (!isRuleLive(rule, now)) continue;
    if (!ruleTargets(rule, ctx.nodes).some((target) => target.id === nodeId)) continue;
    const sources = agentSources(rule, ctx.nodes);
    if (sources === null) continue;
    const target = payload[rule.scope === 'mesh' ? 'mesh' : 'public'];
    (rule.action === 'deny' ? target.denies : target.allows).push({
      id: rule.id,
      sources,
      protocol: rule.protocol,
      ports: rule.ports,
    });
  }
  if (!node.vlanIp) payload.mesh = zone('open');
  return payload;
}

/** True when an apply would install nothing on the node. */
export function payloadIsEmpty(payload: AgentPayload): boolean {
  const zoneActive = (zone: AgentZone) => zone.mode !== 'open' || zone.denies.length > 0;
  return !zoneActive(payload.mesh) && !zoneActive(payload.public);
}

// ---------------------------------------------------------------------
// Evaluation (connection tester, matrix)
// ---------------------------------------------------------------------

export type Probe = { protocol: 'tcp' | 'udp' | 'icmp'; port?: number | null };

export function protocolMatches(rule: { protocol: FwProtocol; ports: string[] }, probe: Probe): boolean {
  if (rule.protocol === 'any') return true;
  if (rule.protocol === 'icmp') return probe.protocol === 'icmp';
  if (probe.protocol === 'icmp') return false;
  if (rule.protocol !== 'tcpudp' && rule.protocol !== probe.protocol) return false;
  if (rule.ports.length === 0) return true;
  if (!probe.port) return false;
  return rule.ports.some((raw) => {
    const range = parsePortRange(raw);
    return range !== null && probe.port! >= range.low && probe.port! <= range.high;
  });
}

function ipToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!/^\d{1,3}$/.test(part) || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

/** IPv4 CIDR or address membership (IPv6 compared literally). */
export function cidrContains(cidr: string, ip: string): boolean {
  const [base, lengthRaw] = cidr.split('/');
  if (ip.includes(':') || base.includes(':')) return base.toLowerCase() === ip.toLowerCase() && (!lengthRaw || lengthRaw === '128');
  const baseInt = ipToInt(base);
  const ipInt = ipToInt(ip);
  if (baseInt === null || ipInt === null) return false;
  const length = lengthRaw === undefined ? 32 : Number(lengthRaw);
  if (!Number.isInteger(length) || length < 0 || length > 32) return false;
  const block = 2 ** (32 - length);
  return Math.floor(baseInt / block) === Math.floor(ipInt / block);
}

export type Verdict = 'allowed' | 'blocked' | 'observed';
export type Evaluation = {
  verdict: Verdict;
  // What decided it, in plain French for the dashboard.
  reason: string;
  match: { type: 'rule' | 'system' | 'mode' | 'infrastructure'; id?: string; name?: string };
};

function sourceMatches(rule: PolicyRule, ctx: PolicyContext, source: { nodeId?: string; ip?: string }): boolean {
  if (rule.sourceKind === 'any') return true;
  if (rule.scope === 'public') {
    return rule.sourceKind === 'cidrs' && Boolean(source.ip) && rule.sourceCidrs.some((cidr) => cidrContains(cidr, source.ip!));
  }
  const nodes = ruleSourceNodes(rule, ctx.nodes) ?? [];
  return nodes.some((node) => node.id === source.nodeId);
}

export function evaluate(
  ctx: PolicyContext,
  request: { scope: FwScope; targetNodeId: string; sourceNodeId?: string; sourceIp?: string } & Probe,
): Evaluation {
  const now = ctx.now ?? new Date();
  const target = ctx.nodes.find((node) => node.id === request.targetNodeId);
  const mode = request.scope === 'mesh' ? ctx.meshMode : (target?.publicMode ?? 'open');
  const source = { nodeId: request.sourceNodeId, ip: request.sourceIp };

  if (request.scope === 'mesh' && request.protocol === 'icmp') {
    return {
      verdict: 'allowed',
      reason: 'Le ping entre serveurs reste toujours permis : Tarmac en a besoin pour surveiller les liens.',
      match: { type: 'infrastructure' },
    };
  }

  const live = ctx.rules.filter(
    (rule) =>
      rule.scope === request.scope &&
      isRuleLive(rule, now) &&
      ruleTargets(rule, ctx.nodes).some((node) => node.id === request.targetNodeId),
  );
  const deny = live.find((rule) => rule.action === 'deny' && sourceMatches(rule, ctx, source) && protocolMatches(rule, request));
  if (deny) {
    return {
      verdict: 'blocked',
      reason: `Bloqué par la règle « ${deny.name} ». Les blocages passent avant toute autorisation.`,
      match: { type: 'rule', id: deny.id, name: deny.name },
    };
  }
  if (mode === 'open') {
    return {
      verdict: 'allowed',
      reason:
        request.scope === 'mesh'
          ? 'Réseau privé en mode ouvert : tout ce qui n’est pas explicitement bloqué passe.'
          : 'Internet en mode ouvert sur ce serveur : tout ce qui n’est pas explicitement bloqué passe.',
      match: { type: 'mode' },
    };
  }
  if (request.scope === 'public' && request.protocol === 'icmp') {
    return ctx.publicPing
      ? { verdict: 'allowed', reason: 'Le serveur répond au ping depuis Internet (réglage général).', match: { type: 'infrastructure' } }
      : modeDefault(mode, 'Le ping depuis Internet est désactivé dans les réglages.');
  }
  const flow = ctx.system.find(
    (candidate) =>
      candidate.scope === request.scope &&
      candidate.targetNodeId === request.targetNodeId &&
      (candidate.sourceNodeIds === 'all' || (source.nodeId !== undefined && candidate.sourceNodeIds.includes(source.nodeId))) &&
      protocolMatches(candidate, request),
  );
  if (flow) {
    return {
      verdict: 'allowed',
      reason: `Autorisé automatiquement : ${flow.label} (${flow.detail}).`,
      match: { type: 'system', id: flow.id, name: flow.label },
    };
  }
  const allow = live.find((rule) => rule.action === 'allow' && sourceMatches(rule, ctx, source) && protocolMatches(rule, request));
  if (allow) {
    return {
      verdict: 'allowed',
      reason: `Autorisé par la règle « ${allow.name} ».`,
      match: { type: 'rule', id: allow.id, name: allow.name },
    };
  }
  return modeDefault(mode, 'Aucune règle n’autorise cette connexion.');
}

function modeDefault(mode: FwMode, why: string): Evaluation {
  return mode === 'observe'
    ? {
        verdict: 'observed',
        reason: `${why} En mode observation elle passe quand même, mais elle est journalisée : elle serait bloquée en mode appliqué.`,
        match: { type: 'mode' },
      }
    : { verdict: 'blocked', reason: `${why} En mode appliqué, tout ce qui n’est pas autorisé est bloqué.`, match: { type: 'mode' } };
}

// ---------------------------------------------------------------------
// Access matrix (mesh)
// ---------------------------------------------------------------------

export type MatrixCell = {
  sourceNodeId: string;
  targetNodeId: string;
  // open: everything gets through - partial: some services only -
  // blocked: nothing but supervision - observed: would be blocked.
  status: 'open' | 'partial' | 'blocked' | 'observed';
  allowed: string[];
  blocked: string[];
};

const WELL_KNOWN: Record<number, string> = {
  20: 'FTP',
  21: 'FTP',
  22: 'SSH',
  25: 'SMTP',
  53: 'DNS',
  80: 'HTTP',
  110: 'POP3',
  111: 'RPC',
  143: 'IMAP',
  443: 'HTTPS',
  465: 'SMTPS',
  587: 'SMTP',
  993: 'IMAPS',
  995: 'POP3S',
  2049: 'NFS',
  2375: 'Docker',
  2376: 'Docker',
  3000: 'HTTP',
  3306: 'MySQL',
  3389: 'RDP',
  5300: 'DNS interne',
  5432: 'PostgreSQL',
  5672: 'RabbitMQ',
  6379: 'Redis',
  6443: 'Kubernetes',
  8080: 'HTTP',
  8443: 'HTTPS',
  9000: 'HTTP',
  9090: 'Prometheus',
  9100: 'Node exporter',
  9200: 'Elasticsearch',
  11211: 'Memcached',
  27017: 'MongoDB',
  51820: 'WireGuard',
  51821: 'VPN Tarmac',
};

export function serviceName(port: number): string | null {
  return WELL_KNOWN[port] ?? null;
}

export function describeService(rule: { protocol: FwProtocol; ports: string[] }): string {
  if (rule.protocol === 'any') return 'Tout le trafic';
  if (rule.protocol === 'icmp') return 'Ping (ICMP)';
  const proto = rule.protocol === 'tcpudp' ? 'TCP/UDP' : rule.protocol.toUpperCase();
  if (rule.ports.length === 0) return `Tous les ports ${proto}`;
  return rule.ports
    .map((port) => {
      const name = /^\d+$/.test(port) ? serviceName(Number(port)) : null;
      return name ? `${name} (${port})` : `${port}/${proto.toLowerCase()}`;
    })
    .join(', ');
}

function coversEverything(rule: { protocol: FwProtocol; ports: string[] }) {
  return rule.protocol === 'any';
}

export function meshMatrix(ctx: PolicyContext): MatrixCell[] {
  const now = ctx.now ?? new Date();
  const members = ctx.nodes.filter((node) => node.vlanIp);
  const live = ctx.rules.filter((rule) => rule.scope === 'mesh' && isRuleLive(rule, now));
  const cells: MatrixCell[] = [];
  for (const target of members) {
    const targeting = live.filter((rule) => ruleTargets(rule, ctx.nodes).some((node) => node.id === target.id));
    for (const source of members) {
      if (source.id === target.id) continue;
      const fromSource = targeting.filter((rule) => sourceMatches(rule, ctx, { nodeId: source.id }));
      const denies = fromSource.filter((rule) => rule.action === 'deny');
      const blocked = denies.map((rule) => describeService(rule));
      if (denies.some(coversEverything)) {
        cells.push({ sourceNodeId: source.id, targetNodeId: target.id, status: 'blocked', allowed: [], blocked });
        continue;
      }
      if (ctx.meshMode === 'open') {
        cells.push({
          sourceNodeId: source.id,
          targetNodeId: target.id,
          status: denies.length > 0 ? 'partial' : 'open',
          allowed: denies.length > 0 ? ['Tout le reste'] : ['Tout le trafic'],
          blocked,
        });
        continue;
      }
      const flows = ctx.system.filter(
        (flow) =>
          flow.scope === 'mesh' &&
          flow.targetNodeId === target.id &&
          (flow.sourceNodeIds === 'all' || flow.sourceNodeIds.includes(source.id)),
      );
      const allows = fromSource.filter((rule) => rule.action === 'allow');
      const allowed = [...flows.map((flow) => flow.label), ...allows.map((rule) => describeService(rule))];
      const everything = allows.some(coversEverything) || flows.some(coversEverything);
      let status: MatrixCell['status'] = everything && denies.length === 0 ? 'open' : allowed.length > 0 ? 'partial' : 'blocked';
      if (status === 'blocked' && ctx.meshMode === 'observe') status = 'observed';
      cells.push({ sourceNodeId: source.id, targetNodeId: target.id, status, allowed: [...new Set(allowed)], blocked });
    }
  }
  return cells;
}

// ---------------------------------------------------------------------
// Internet exposure of a listening port
// ---------------------------------------------------------------------

export type Exposure = 'public' | 'restricted' | 'closed' | 'observed' | 'local';

const PRIVATE_V4 = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '100.64.0.0/10', '169.254.0.0/16'];

/** True for an address no internet client can reach directly. */
export function isPrivateAddress(address: string): boolean {
  if (address === '*') return false;
  if (address.includes(':')) {
    const lower = address.toLowerCase();
    return lower.startsWith('fe80:') || lower.startsWith('fc') || lower.startsWith('fd');
  }
  return PRIVATE_V4.some((cidr) => cidrContains(cidr, address));
}

/**
 * Who on the internet can open a connection to this port: anyone, only some
 * addresses (an allow naming CIDRs), nobody - or "observed" (open, but it
 * would be closed in enforce mode). `modeOverride` answers "and once I
 * switch to enforce?".
 */
export function publicExposure(
  ctx: PolicyContext,
  nodeId: string,
  listen: { protocol: 'tcp' | 'udp'; port: number; addresses: string[] },
  modeOverride?: FwMode,
): Exposure {
  if (listen.addresses.length > 0 && listen.addresses.every(isPrivateAddress)) return 'local';
  const now = ctx.now ?? new Date();
  const node = ctx.nodes.find((candidate) => candidate.id === nodeId);
  const mode = modeOverride ?? node?.publicMode ?? 'open';
  const probe: Probe = { protocol: listen.protocol, port: listen.port };
  const live = ctx.rules.filter(
    (rule) =>
      rule.scope === 'public' &&
      isRuleLive(rule, now) &&
      protocolMatches(rule, probe) &&
      ruleTargets(rule, ctx.nodes).some((target) => target.id === nodeId),
  );
  // Banning a few addresses doesn't make a port any less public: only a
  // block of every source closes it.
  if (live.some((rule) => rule.action === 'deny' && rule.sourceKind === 'any')) return 'closed';
  if (mode === 'open') return 'public';
  const allows = live.filter((rule) => rule.action === 'allow');
  if (managedBy(ctx, nodeId, listen) || allows.some((rule) => rule.sourceKind === 'any')) return 'public';
  if (allows.length > 0) return 'restricted';
  return mode === 'observe' ? 'observed' : 'closed';
}

/** The Tarmac flow keeping this port open from the internet, if any. */
export function managedBy(ctx: PolicyContext, nodeId: string, listen: { protocol: 'tcp' | 'udp'; port: number }): string | null {
  const probe: Probe = { protocol: listen.protocol, port: listen.port };
  return ctx.system.find((flow) => flow.scope === 'public' && flow.targetNodeId === nodeId && protocolMatches(flow, probe))?.label ?? null;
}
