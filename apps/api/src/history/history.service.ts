import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FirewallRule } from '@prisma/client';
import { ApiKeyScope, scopeGrants } from '../api-keys/api-key-token';
import { WorkspaceScope } from '../auth/workspace.guard';
import { DnsRecordSnapshot, DnsRecordsService } from '../dns/dns-records.service';
import { DnsZoneSnapshot, DnsZonesService } from '../dns/dns-zones.service';
import { UpdateFirewallSettingsDto } from '../firewall/dto/firewall.dto';
import { FirewallService } from '../firewall/firewall.service';
import { PrismaService } from '../prisma/prisma.service';

// Journal entries whose "before" state (AuditLog.snapshot) can be put back,
// and the permission that takes - the same as making the change itself.
const RESTORABLE: Record<string, ApiKeyScope> = {
  'firewall_rule.update': 'firewall:write',
  'firewall_rule.enable': 'firewall:write',
  'firewall_rule.disable': 'firewall:write',
  'firewall_rule.delete': 'firewall:write',
  'firewall_rule.restore': 'firewall:write',
  'firewall_list.update': 'firewall:write',
  'firewall_list.delete': 'firewall:write',
  'firewall_list.restore': 'firewall:write',
  'firewall.settings': 'firewall:write',
  'dns.record.upsert': 'dns:write',
  'dns.record.delete': 'dns:write',
  'dns.zone.delete': 'dns:write',
};

/**
 * "Restaurer l'état d'avant" from the Journal: each undoable change keeps
 * a snapshot of what it replaced; restoring goes back through the owning
 * service, so validation, audit and agent re-apply happen as for any edit.
 */
@Injectable()
export class HistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly firewall: FirewallService,
    private readonly dnsRecords: DnsRecordsService,
    private readonly dnsZones: DnsZonesService,
  ) {}

  async restore(auditLogId: string, scope: WorkspaceScope, actorUserId?: string) {
    const entry = await this.prisma.auditLog.findFirst({ where: { id: auditLogId, workspaceId: scope.workspaceId } });
    if (!entry) throw new NotFoundException('Entrée du journal introuvable');
    const required = RESTORABLE[entry.action];
    if (!required || !entry.snapshot) throw new BadRequestException('Cette action ne peut pas être annulée depuis le journal.');
    if (entry.restoredAt) throw new ConflictException('Cet état a déjà été restauré.');
    const granted = scope.apiKey?.scopes ?? scope.permissions;
    if (granted && !scopeGrants(granted, required)) {
      throw new ForbiddenException('Vous n’avez pas le droit de modifier cet élément.');
    }

    const actor = { scope, userId: actorUserId };
    const snapshot = entry.snapshot as unknown;
    let restored: string;
    if (entry.action.startsWith('firewall_rule.')) restored = await this.firewall.restoreRule(snapshot as FirewallRule, actor);
    else if (entry.action.startsWith('firewall_list.')) {
      restored = await this.firewall.restoreList(snapshot as { id: string; name: string; description: string | null; cidrs: string[] }, actor);
    } else if (entry.action === 'firewall.settings') restored = await this.firewall.restoreSettings(snapshot as UpdateFirewallSettingsDto, actor);
    else if (entry.action.startsWith('dns.record.')) restored = await this.dnsRecords.restoreRecord(snapshot as DnsRecordSnapshot, scope, actorUserId);
    else restored = await this.dnsZones.restoreZone(snapshot as DnsZoneSnapshot, scope, actorUserId);

    await this.prisma.auditLog.update({ where: { id: entry.id }, data: { restoredAt: new Date() } });
    return { restored };
  }
}
