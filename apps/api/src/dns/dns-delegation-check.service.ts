import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { promises as dnsPromises } from 'node:dns';
import { WorkspaceScope } from '../auth/workspace.guard';
import { LiveWsServer } from '../live/live.ws';
import { extractExternalIp } from '../nodes/extract-external-ip';
import { PrismaService } from '../prisma/prisma.service';
import { DnsZonesService } from './dns-zones.service';

const PUBLIC_RESOLVER_IP = '1.1.1.1';
const CHECK_TIMEOUT_MS = 5000;
const CHECK_INTERVAL_MS = 60_000;

export type DnsDelegationNameserverResult = {
  host: string;
  expectedIp: string;
  nsVisible: boolean;
  resolvedIp: string | null;
  matches: boolean;
  ok: boolean;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('dns check timed out')), ms)),
  ]);
}

// Verifies a zone's delegation against the REAL public internet - distinct
// from DnsDelegationService.getDelegation, which only computes what Tarmac
// wants the delegation to look like from local DB state. Queries a public
// resolver directly (bypassing any local/OS cache) the same way this was
// done manually all session with `dig @one.one.one.one ...`. Confirmed
// empirically against the real intraced.fr zone that Node's dns.Resolver
// correctly returns the live-delegated NS set and resolves in-bailiwick
// nameserver glue (a case that surprised PowerDNS's own self-lookup
// earlier this session, but is unproblematic here since this queries the
// public internet, not the zone's own authoritative server).
@Injectable()
export class DnsDelegationCheckService implements OnModuleInit {
  private readonly logger = new Logger(DnsDelegationCheckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveWsServer,
    private readonly dnsZonesService: DnsZonesService,
  ) {}

  onModuleInit() {
    // Delay first tick to let DB connection settle, same as
    // ReconciliationService - but its own slower, independent loop: this
    // hits the public internet, not local agent state, so it doesn't
    // belong in the fast 15s reconciliation tick.
    setTimeout(() => {
      void this.tick();
      setInterval(() => {
        void this.tick();
      }, CHECK_INTERVAL_MS);
    }, 10_000);
  }

  private async tick() {
    const zones = await this.prisma.dnsZone.findMany({
      where: { status: 'active', delegationVerified: false },
      select: { id: true },
    });
    for (const zone of zones) {
      try {
        await this.runCheck(zone.id);
      } catch (error) {
        this.logger.warn(
          `Delegation check failed for zone ${zone.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  // Manual/immediate re-check trigger for an authenticated request - scoped
  // so a caller can only recheck a zone in their own workspace. The
  // periodic tick() above bypasses scope entirely since it's an internal
  // system loop, not acting on a specific user's behalf.
  async checkZone(id: string, scope: WorkspaceScope) {
    await this.dnsZonesService.assertZoneOwned(id, scope);
    return this.runCheck(id);
  }

  // Fire-and-forget entrypoint for AgentsService to call the instant a zone
  // first goes 'active' - no scope check, this runs as a direct reaction to
  // an agent command result, not a user request.
  async checkZoneUnscoped(id: string) {
    return this.runCheck(id);
  }

  private async runCheck(zoneId: string) {
    const zone = await this.prisma.dnsZone.findUnique({ where: { id: zoneId } });
    if (!zone) return null;

    const members = await this.prisma.dnsServerGroupMember.findMany({
      where: { groupId: zone.groupId },
      include: { node: true },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    const expected = members
      .map((member, index) => ({ host: `ns${index + 1}.${zone.name}`, ip: extractExternalIp(member.node.overlayEndpoint) }))
      .filter((entry): entry is { host: string; ip: string } => Boolean(entry.ip));

    const detail: DnsDelegationNameserverResult[] = await Promise.all(
      expected.map((entry) => this.checkOneNameserver(entry.host, entry.ip, zone.name)),
    );
    // An empty detail list (no members with a resolvable external IP yet)
    // must never count as "verified" - .every() on [] is vacuously true.
    const verified = detail.length > 0 && detail.every((entry) => entry.ok);
    const checkedAt = new Date();

    await this.prisma.dnsZone.update({
      where: { id: zoneId },
      data: { delegationVerified: verified, delegationCheckedAt: checkedAt, delegationDetail: detail },
    });

    this.live.broadcast(
      'dns.zone.delegation',
      { zoneId, verified, checkedAt: checkedAt.toISOString(), detail },
      zone.workspaceId,
    );

    return { verified, checkedAt, detail };
  }

  private async checkOneNameserver(
    host: string,
    expectedIp: string,
    parentZone: string,
  ): Promise<DnsDelegationNameserverResult> {
    const resolver = new dnsPromises.Resolver();
    resolver.setServers([PUBLIC_RESOLVER_IP]);

    const nsVisible = await withTimeout(resolver.resolveNs(parentZone), CHECK_TIMEOUT_MS)
      .then((names) => names.some((name) => name.toLowerCase() === host.toLowerCase()))
      .catch(() => false);

    const resolvedIp = await withTimeout(resolver.resolve4(host), CHECK_TIMEOUT_MS)
      .then((ips) => ips[0] ?? null)
      .catch(() => null);

    const matches = resolvedIp === expectedIp;
    return { host, expectedIp, nsVisible, resolvedIp, matches, ok: nsVisible && matches };
  }
}
