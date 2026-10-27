import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { promises as dnsPromises } from 'node:dns';
import { LiveWsServer } from '../live/live.ws';
import { extractExternalIp } from '../nodes/extract-external-ip';
import { PrismaService } from '../prisma/prisma.service';

const CHECK_INTERVAL_MS = 2 * 60_000;
const QUERY_TIMEOUT_MS = 4000;
// The primary NOTIFYs its secondaries on every change, so they normally
// catch up within seconds; this leaves room for a slow transfer or a retry
// before calling it a problem.
const SYNC_LAG_ALERT_MS = 30 * 60_000;

export type DnsZoneSyncMember = {
  nodeId: string;
  role: 'primary' | 'secondary';
  serial: number | null;
  // Secondary serving the primary's serial. Always true for the primary.
  ok: boolean;
  // When this secondary was first seen behind (or unreachable), kept across
  // checks so the lag duration and the alert are measured from the start.
  behindSince: string | null;
  error: string | null;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

/**
 * Checks that zone transfers actually propagate: asks every member of a
 * zone's group, on its public address, for the zone's SOA serial and
 * compares each secondary with the primary. The overlay link panel only
 * says the network between them is fine, not that the secondary is serving
 * the latest version of the zone.
 */
@Injectable()
export class DnsSyncCheckService implements OnModuleInit {
  private readonly logger = new Logger(DnsSyncCheckService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly live: LiveWsServer,
  ) {}

  onModuleInit() {
    setTimeout(() => {
      void this.tick();
      setInterval(() => {
        void this.tick();
      }, CHECK_INTERVAL_MS);
    }, 20_000);
  }

  private async tick() {
    const zones = await this.prisma.dnsZone.findMany({ where: { status: 'active' }, select: { id: true } });
    for (const zone of zones) {
      try {
        await this.checkZone(zone.id);
      } catch (error) {
        this.logger.warn(`Zone sync check failed for ${zone.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  async checkZone(zoneId: string) {
    const zone = await this.prisma.dnsZone.findUnique({
      where: { id: zoneId },
      include: { group: { include: { members: { include: { node: { select: { id: true, name: true, overlayEndpoint: true } } } } } } },
    });
    if (!zone) return null;
    const members = zone.group.members;
    if (!members.some((member) => member.role === 'secondary')) return null;

    const previous = new Map(
      ((zone.syncDetail as DnsZoneSyncMember[] | null) ?? []).map((entry) => [entry.nodeId, entry]),
    );
    const serials = await Promise.all(
      members.map(async (member) => {
        const ip = extractExternalIp(member.node.overlayEndpoint);
        if (!ip) return { serial: null, error: 'adresse publique inconnue' };
        const resolver = new dnsPromises.Resolver({ timeout: QUERY_TIMEOUT_MS, tries: 2 });
        resolver.setServers([ip]);
        try {
          const soa = await withTimeout(resolver.resolveSoa(zone.name), QUERY_TIMEOUT_MS * 2);
          return { serial: soa.serial, error: null };
        } catch (error) {
          const code = (error as { code?: string }).code;
          return {
            serial: null,
            error: code === 'EREFUSED' || code === 'ENOTFOUND' || code === 'ENODATA' ? 'zone absente sur ce serveur' : 'ne répond pas',
          };
        }
      }),
    );

    const primaryIndex = members.findIndex((member) => member.role === 'primary');
    const primarySerial = primaryIndex >= 0 ? serials[primaryIndex].serial : null;
    const now = new Date();
    const detail: DnsZoneSyncMember[] = members.map((member, index) => {
      const { serial, error } = serials[index];
      const isPrimary = member.role === 'primary';
      // Without the primary's serial there is nothing to compare against:
      // a secondary is only judged behind against a known reference.
      const ok = isPrimary || primarySerial === null || serial === primarySerial;
      const before = previous.get(member.nodeId);
      return {
        nodeId: member.nodeId,
        role: member.role,
        serial,
        ok: ok && (isPrimary || serial !== null),
        behindSince: ok && serial !== null ? null : (before?.behindSince ?? now.toISOString()),
        error,
      };
    });

    for (const entry of detail) {
      if (entry.role !== 'secondary' || !entry.behindSince) continue;
      // Alert once per episode: on the check where the lag crosses the bar.
      const since = new Date(entry.behindSince).getTime();
      const lagMs = now.getTime() - since;
      const lagAtLastCheck = zone.syncCheckedAt ? zone.syncCheckedAt.getTime() - since : -1;
      if (lagMs < SYNC_LAG_ALERT_MS || lagAtLastCheck >= SYNC_LAG_ALERT_MS) continue;
      const member = members.find((m) => m.nodeId === entry.nodeId)!;
      const minutes = Math.round(lagMs / 60_000);
      await this.prisma.alert.create({
        data: {
          workspaceId: zone.workspaceId,
          nodeId: entry.nodeId,
          severity: 'high',
          message: entry.error
            ? `Zone ${zone.name} : le secondaire ${member.node.name} ${entry.error} depuis ${minutes} min`
            : `Zone ${zone.name} : le secondaire ${member.node.name} sert le serial ${entry.serial} au lieu de ${primarySerial} depuis ${minutes} min (transfert AXFR bloqué ?)`,
        },
      });
    }

    await this.prisma.dnsZone.update({ where: { id: zoneId }, data: { syncCheckedAt: now, syncDetail: detail } });
    this.live.broadcast('dns.zone.sync', { zoneId, checkedAt: now.toISOString(), detail }, zone.workspaceId);
    return { checkedAt: now, detail };
  }
}
