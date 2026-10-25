import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { WorkspaceScope } from '../auth/workspace.guard';
import { PrismaService } from '../prisma/prisma.service';
import { generateApiKeyToken } from './api-key-token';
import { CreateApiKeyDto } from './dto/create-api-key.dto';
import { UpdateApiKeyDto } from './dto/update-api-key.dto';

// Never selects secretHash - nothing outside the guard has a reason to see it.
const API_KEY_PUBLIC_SELECT = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  createdByUserId: true,
  lastUsedAt: true,
  lastUsedIp: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
} as const;

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogsService: AuditLogsService,
  ) {}

  // Keys are workspace administration: managers only (owner membership or
  // platform admin), and never another API key minting keys.
  private assertManager(scope: WorkspaceScope) {
    if (!scope.isManager || scope.apiKey) {
      throw new ForbiddenException('Seuls les gérants du workspace peuvent gérer les clés API.');
    }
  }

  async list(scope: WorkspaceScope) {
    this.assertManager(scope);
    const keys = await this.prisma.apiKey.findMany({
      where: { workspaceId: scope.workspaceId },
      select: API_KEY_PUBLIC_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    const creatorIds = [...new Set(keys.map((key) => key.createdByUserId).filter((id): id is string => !!id))];
    const creators = creatorIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, email: true, name: true } })
      : [];
    const creatorById = new Map(creators.map((user) => [user.id, user]));
    return keys.map((key) => ({
      ...key,
      createdBy: key.createdByUserId ? (creatorById.get(key.createdByUserId) ?? null) : null,
    }));
  }

  // The only time the full token exists outside the caller's hands.
  async create(dto: CreateApiKeyDto, scope: WorkspaceScope, actorUserId?: string) {
    this.assertManager(scope);
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("La date d'expiration doit être dans le futur.");
    }

    const { token, prefix, secretHash } = generateApiKeyToken();
    const key = await this.prisma.apiKey.create({
      data: {
        workspaceId: scope.workspaceId as string,
        name: dto.name.trim(),
        prefix,
        secretHash,
        scopes: dto.scopes,
        expiresAt,
        createdByUserId: actorUserId ?? null,
      },
      select: API_KEY_PUBLIC_SELECT,
    });

    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'api_key.create',
      resourceType: 'api_key',
      resourceId: key.id,
      details: { name: key.name, prefix, scopes: dto.scopes, expiresAt: expiresAt?.toISOString() ?? null },
    });

    return { ...key, token };
  }

  // Name, permissions and expiry change in place: integrations keep their
  // token, and a permission removed here is refused on the very next call.
  async update(id: string, dto: UpdateApiKeyDto, scope: WorkspaceScope, actorUserId?: string) {
    this.assertManager(scope);
    const key = await this.findOwned(id, scope);
    if (key.revokedAt) {
      throw new BadRequestException('Une clé révoquée ne peut plus être modifiée.');
    }
    const expiresAt = dto.expiresAt === undefined ? undefined : dto.expiresAt === null ? null : new Date(dto.expiresAt);
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException("La date d'expiration doit être dans le futur.");
    }

    const updated = await this.prisma.apiKey.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.scopes !== undefined ? { scopes: dto.scopes } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      },
      select: API_KEY_PUBLIC_SELECT,
    });

    const added = dto.scopes?.filter((value) => !key.scopes.includes(value)) ?? [];
    const removed = dto.scopes ? key.scopes.filter((value) => !dto.scopes!.includes(value as never)) : [];
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'api_key.update',
      resourceType: 'api_key',
      resourceId: id,
      details: {
        name: updated.name,
        prefix: key.prefix,
        ...(dto.name !== undefined && dto.name.trim() !== key.name ? { previousName: key.name } : {}),
        ...(added.length || removed.length ? { scopesAdded: added, scopesRemoved: removed } : {}),
        ...(expiresAt !== undefined ? { expiresAt: expiresAt?.toISOString() ?? null } : {}),
      },
    });
    return updated;
  }

  async revoke(id: string, scope: WorkspaceScope, actorUserId?: string) {
    this.assertManager(scope);
    const key = await this.findOwned(id, scope);
    if (key.revokedAt) return key;
    const updated = await this.prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
      select: API_KEY_PUBLIC_SELECT,
    });
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'api_key.revoke',
      resourceType: 'api_key',
      resourceId: id,
      details: { name: key.name, prefix: key.prefix },
    });
    return updated;
  }

  async remove(id: string, scope: WorkspaceScope, actorUserId?: string) {
    this.assertManager(scope);
    const key = await this.findOwned(id, scope);
    await this.prisma.apiKey.delete({ where: { id } });
    await this.auditLogsService.log({
      workspaceId: scope.workspaceId as string,
      actorUserId,
      action: 'api_key.delete',
      resourceType: 'api_key',
      resourceId: id,
      details: { name: key.name, prefix: key.prefix },
    });
    return { success: true };
  }

  private async findOwned(id: string, scope: WorkspaceScope) {
    const key = await this.prisma.apiKey.findFirst({
      where: { id, workspaceId: scope.workspaceId },
      select: API_KEY_PUBLIC_SELECT,
    });
    if (!key) throw new NotFoundException('Clé API introuvable');
    return key;
  }
}
