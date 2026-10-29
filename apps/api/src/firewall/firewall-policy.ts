// Pure firewall logic shared by the apply pipeline, the connection tester
// and the access matrix, so what the dashboard predicts is exactly what the
// agents enforce (see apps/agent/firewall.go for the chains themselves).

// outbound: connections the servers open to the internet (the rule's
// target = those servers, its source* fields = the remote end).
export type FwScope = 'mesh' | 'public' | 'outbound';
export type FwMode = 'open' | 'observe' | 'enforce';
export type FwAction = 'allow' | 'deny';
export type FwProtocol = 'any' | 'tcp' | 'udp' | 'tcpudp' | 'icmp';
export type FwSourceKind = 'any' | 'nodes' | 'labels' | 'cidrs' | 'lists' | 'countries';
export type FwTargetKind = 'any' | 'nodes' | 'labels';

export const FW_MODES: FwMode[] = ['open', 'observe', 'enforce'];
export const FW_PROTOCOLS: FwProtocol[] = ['any', 'tcp', 'udp', 'tcpudp', 'icmp'];

export type PolicyNode = {
  id: string;
  name: string;
  vlanIp: string | null;
  labels: string[];
  publicMode: FwMode;
  outboundMode?: FwMode;
  // Ports sshd listens on, as last reported (22 when unknown).
  sshPorts: number[];
  // Optional protections its agent supports (its last report); undefined =
  // unknown, treated as supporting everything (tests, fresh nodes).
  features?: string[];
};

/** Whether a node's agent can apply a protection added after the firewall itself. */
export function nodeSupports(node: Pick<PolicyNode, 'features'> | undefined, feature: string): boolean {
  return !node?.features || node.features.includes(feature);
}

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
  // Address lists (public rules), see PolicyContext.lists.
  sourceListIds: string[];
  // ISO country codes (sourceKind countries).
  sourceCountries?: string[];
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
  // Throttle new SSH connections from the internet (see the agent's TARMAC-FW-SSH).
  sshLimit: boolean;
  nodes: PolicyNode[];
  rules: PolicyRule[];
  system: SystemFlow[];
  // Named sets of internet addresses that public rules can use as source.
  lists?: AddressList[];
  now?: Date;
};

export type AddressList = { id: string; name: string; cidrs: string[] };

/**
 * The internet addresses a public rule names: its own CIDRs, or the union
 * of its address lists as they are now. Empty for any other kind.
 */
export function ruleCidrs(rule: Pick<PolicyRule, 'sourceKind' | 'sourceCidrs' | 'sourceListIds'>, lists: AddressList[] = []): string[] {
  if (rule.sourceKind === 'cidrs') return rule.sourceCidrs;
  if (rule.sourceKind !== 'lists') return [];
  const wanted = new Set(rule.sourceListIds);
  return [...new Set(lists.filter((list) => wanted.has(list.id)).flatMap((list) => list.cidrs))];
}

// countries: matched by the agent against country address sets, instead of
// sources (never both).
export type AgentRule = { id: string; sources: string[]; countries?: string[]; protocol: FwProtocol; ports: string[] };
export type AgentZone = { mode: FwMode; denies: AgentRule[]; allows: AgentRule[] };
export type AgentPayload = {
  revision: string;
  meshInterface: string;
  ping: boolean;
  mesh: AgentZone;
  public: AgentZone;
  outbound: AgentZone;
  // Absent when off; exempt = addresses an SSH rule explicitly allows.
  sshLimit?: { ports: string[]; exempt: string[] };
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
function agentSources(rule: PolicyRule, ctx: PolicyContext): string[] | null {
  if (rule.sourceKind === 'any') return [];
  if (rule.scope === 'public' || rule.scope === 'outbound') {
    // An empty list (or every list deleted) must skip the rule, never widen
    // it to the whole internet.
    const cidrs = ruleCidrs(rule, ctx.lists);
    return cidrs.length > 0 ? cidrs : null;
  }
  const nodes = ctx.nodes;
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
    // An agent that predates outbound filtering would ignore it: say open.
    outbound: zone(nodeSupports(node, 'outbound') ? (node?.outboundMode ?? 'open') : 'open'),
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
    if (rule.scope === 'outbound' && !nodeSupports(node, 'outbound')) continue;
    if (rule.sourceKind === 'countries') {
      // An older agent would read a country rule as "any source": it must
      // never receive one.
      const countries = rule.sourceCountries ?? [];
      if (countries.length === 0 || rule.scope === 'mesh' || !nodeSupports(node, 'countries')) continue;
      const target = payload[rule.scope === 'outbound' ? 'outbound' : 'public'];
      (rule.action === 'deny' ? target.denies : target.allows).push({ id: rule.id, sources: [], countries, protocol: rule.protocol, ports: rule.ports });
      continue;
    }
    const sources = agentSources(rule, ctx);
    if (sources === null) continue;
    const target = payload[rule.scope];
    (rule.action === 'deny' ? target.denies : target.allows).push({
      id: rule.id,
      sources,
      protocol: rule.protocol,
      ports: rule.ports,
    });
  }
  if (!node.vlanIp) payload.mesh = zone('open');
  if (ctx.sshLimit) payload.sshLimit = sshLimitFor(ctx, node, now);
  return payload;
}

/**
 * The SSH ports to throttle on a node, and the addresses never throttled:
 * those a live internet rule explicitly allows to reach SSH ("SSH from the
 * office"), so a known admin address is never slowed down.
 */
export function sshLimitFor(ctx: PolicyContext, node: PolicyNode, now: Date): { ports: string[]; exempt: string[] } {
  const exempt = new Set<string>();
  for (const rule of ctx.rules) {
    if (rule.scope !== 'public' || rule.action !== 'allow' || rule.sourceKind === 'any' || !isRuleLive(rule, now)) continue;
    if (!ruleTargets(rule, ctx.nodes).some((target) => target.id === node.id)) continue;
    if (!node.sshPorts.some((port) => protocolMatches(rule, { protocol: 'tcp', port }))) continue;
    for (const cidr of ruleCidrs(rule, ctx.lists)) exempt.add(cidr);
  }
  return { ports: node.sshPorts.map(String), exempt: [...exempt] };
}

/** True when an apply would install nothing on the node. */
export function payloadIsEmpty(payload: AgentPayload): boolean {
  const zoneActive = (zone: AgentZone) => zone.mode !== 'open' || zone.denies.length > 0;
  return !zoneActive(payload.mesh) && !zoneActive(payload.public) && !zoneActive(payload.outbound) && !payload.sshLimit;
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

/** IPv6 address as a 128-bit integer; null when it isn't one. */
function ipv6ToBigInt(raw: string): bigint | null {
  let ip = raw.trim().replace(/^\[|\]$/g, '');
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  if (!ip.includes(':') || (ip.match(/::/g) ?? []).length > 1) return null;
  // An IPv4 tail (::ffff:192.0.2.1) counts as the last two groups.
  const lastColon = ip.lastIndexOf(':');
  const tail = ip.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = ipToInt(tail);
    if (v4 === null) return null;
    ip = `${ip.slice(0, lastColon + 1)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }
  const [head, rest] = ip.includes('::') ? ip.split('::') : [ip, null];
  const left = head ? head.split(':') : [];
  const right = rest ? rest.split(':') : [];
  const missing = 8 - left.length - right.length;
  if (rest === null ? missing !== 0 : missing < 1) return null;
  const groups = [...left, ...Array<string>(rest === null ? 0 : missing).fill('0'), ...right];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  return value;
}

/** Whether `ip` falls inside `cidr` (a bare address counts as a single host), IPv4 or IPv6. */
export function cidrContains(cidr: string, ip: string): boolean {
  const [base, lengthRaw] = cidr.trim().split('/');
  if (ip.includes(':') || base.includes(':')) {
    const baseInt = ipv6ToBigInt(base);
    const ipInt = ipv6ToBigInt(ip);
    if (baseInt === null || ipInt === null) return false;
    const length = lengthRaw === undefined ? 128 : Number(lengthRaw);
    if (!Number.isInteger(length) || length < 0 || length > 128) return false;
    const shift = BigInt(128 - length);
    return baseInt >> shift === ipInt >> shift;
  }
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
  // The tester doesn't know which country an address belongs to.
  if (rule.sourceKind === 'countries') return false;
  if (rule.scope === 'public' || rule.scope === 'outbound') {
    return Boolean(source.ip) && ruleCidrs(rule, ctx.lists).some((cidr) => cidrContains(cidr, source.ip!));
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
  const mode =
    request.scope === 'mesh' ? ctx.meshMode : request.scope === 'outbound' ? (target?.outboundMode ?? 'open') : (target?.publicMode ?? 'open');
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
  const result = evaluateRules(ctx, request, live, mode, source);
  // Country rules can't be checked here: say so rather than overpromise.
  const byCountry = live.filter((rule) => rule.sourceKind === 'countries' && protocolMatches(rule, request));
  if (byCountry.length > 0 && result.match.type !== 'infrastructure') {
    result.reason += ` À noter : ${byCountry.length === 1 ? `la règle par pays « ${byCountry[0].name} » peut` : `${byCountry.length} règles par pays peuvent`} aussi s’appliquer selon le pays de l’adresse, que ce test ne connaît pas.`;
  }
  return result;
}

function evaluateRules(
  ctx: PolicyContext,
  request: { scope: FwScope; targetNodeId: string } & Probe,
  live: PolicyRule[],
  mode: FwMode,
  source: { nodeId?: string; ip?: string },
): Evaluation {
  if (request.scope === 'outbound' && mode !== 'open' && (request.protocol === 'icmp' || ((request.port === 53 || request.port === 123) && request.protocol === 'udp') || (request.port === 53 && request.protocol === 'tcp'))) {
    return {
      verdict: 'allowed',
      reason: 'Le ping, le DNS et la mise à l’heure restent toujours permis vers Internet.',
      match: { type: 'infrastructure' },
    };
  }
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
          : request.scope === 'outbound'
            ? 'Trafic sortant non filtré sur ce serveur : tout ce qui n’est pas explicitement bloqué passe.'
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
  return modeDefault(
    mode,
    request.scope === 'outbound'
      ? 'Aucune règle n’autorise cette connexion sortante (les processus root, eux, restent toujours libres).'
      : 'Aucune règle n’autorise cette connexion.',
  );
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
// Unique local (fc00::/7) and link-local (fe80::/10).
const PRIVATE_V6 = ['fc00::/7', 'fe80::/10'];

/** True for an address no internet client can reach directly. */
export function isPrivateAddress(address: string): boolean {
  if (address === '*') return false;
  return (address.includes(':') ? PRIVATE_V6 : PRIVATE_V4).some((cidr) => cidrContains(cidr, address));
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
