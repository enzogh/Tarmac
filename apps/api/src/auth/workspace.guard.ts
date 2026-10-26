import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { scopeGrants } from '../api-keys/api-key-token';
import { PrismaService } from '../prisma/prisma.service';
import { declaredScope, type AuthenticatedApiKey } from './api-key.guard';

const WORKSPACE_HEADER = 'x-workspace-id';
const ALLOW_NO_WORKSPACE_METADATA = 'workspace:allowNoWorkspace';

// For the few handlers a signed-in user with no membership yet must still
// reach (listing their - empty - workspaces, creating their first one). They
// get a scope with no selected workspace, so they must never read
// workspace-scoped data.
export const AllowNoWorkspace = () => SetMetadata(ALLOW_NO_WORKSPACE_METADATA, true);

export interface WorkspaceScope {
  // Only controls WHICH workspaces this caller may select into (every
  // workspace, vs. just their own memberships) and whether platform-admin-
  // only endpoints (e.g. creating a workspace) are allowed. It does NOT mean
  // "unfiltered access to every workspace's data at once" - resource queries
  // always filter by workspaceId below, for admins and members alike.
  isPlatformAdmin: boolean;
  // The workspace this request acts on (resolved from X-Workspace-Id, or a
  // sensible default otherwise - see WorkspaceGuard). Only undefined in the
  // pathological case where zero Workspace rows exist at all.
  workspaceId?: string;
  // All workspace ids the caller may switch into (platform admins get every
  // workspace; members get only their own memberships).
  allowedWorkspaceIds: string[];
  // Workspace "gérant": a platform admin or an 'owner' membership of the
  // selected workspace. Gates workspace administration (API keys, members).
  isManager: boolean;
  // Set when the request authenticated with a workspace API key instead of
  // a user session (see ApiKeyOrJwtGuard) - there is no user behind it.
  apiKey?: { id: string; name: string; scopes: string[] };
  // A member's grants in the selected workspace ("<resource>:read|write").
  // Undefined means unrestricted: platform admins and owners.
  permissions?: string[];
}

interface RequestWithWorkspaceScope extends Request {
  user?: { userId?: string };
  apiKey?: AuthenticatedApiKey;
  workspaceScope?: WorkspaceScope;
}

// Mounted via `@UseGuards(JwtAuthGuard, WorkspaceGuard)` on every
// workspace-scoped controller, paired with `@CurrentWorkspace()` to read the
// resolved scope back out in the handler.
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithWorkspaceScope>();

    // An API key is bound to exactly one workspace: that's the only one it
    // may act on, whatever X-Workspace-Id says.
    if (request.apiKey) {
      const requested = firstHeaderValue(request.headers[WORKSPACE_HEADER]);
      if (requested && requested !== request.apiKey.workspaceId) {
        throw new ForbiddenException('This API key belongs to another workspace');
      }
      request.workspaceScope = {
        isPlatformAdmin: false,
        workspaceId: request.apiKey.workspaceId,
        allowedWorkspaceIds: [request.apiKey.workspaceId],
        isManager: false,
        apiKey: { id: request.apiKey.id, name: request.apiKey.name, scopes: request.apiKey.scopes },
      };
      return true;
    }

    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedException();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { isSuperuser: true },
    });
    if (!user) {
      throw new UnauthorizedException();
    }

    const requestedWorkspaceId = firstHeaderValue(request.headers[WORKSPACE_HEADER]);

    if (user.isSuperuser) {
      const workspaces = await this.prisma.workspace.findMany({
        select: { id: true, isDefault: true },
        orderBy: { createdAt: 'asc' },
      });
      const allWorkspaceIds = workspaces.map((w) => w.id);
      if (requestedWorkspaceId && !allWorkspaceIds.includes(requestedWorkspaceId)) {
        throw new ForbiddenException('Unknown workspace');
      }
      // No X-Workspace-Id header (e.g. a caller that predates the frontend
      // switcher) falls back to the Default workspace so single-tenant
      // behavior is unchanged rather than stamping an undefined workspaceId.
      const fallbackWorkspaceId = workspaces.find((w) => w.isDefault)?.id ?? allWorkspaceIds[0];
      request.workspaceScope = {
        isPlatformAdmin: true,
        workspaceId: requestedWorkspaceId ?? fallbackWorkspaceId,
        allowedWorkspaceIds: allWorkspaceIds,
        isManager: true,
      };
      return true;
    }

    const memberships = await this.prisma.workspaceMembership.findMany({
      where: { userId },
      select: { workspaceId: true, role: true, permissions: true },
    });
    const allowedWorkspaceIds = memberships.map((m) => m.workspaceId);
    if (allowedWorkspaceIds.length === 0) {
      const allowed = this.reflector.getAllAndOverride<boolean>(ALLOW_NO_WORKSPACE_METADATA, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed || requestedWorkspaceId) {
        throw new ForbiddenException('No workspace access');
      }
      request.workspaceScope = { isPlatformAdmin: false, allowedWorkspaceIds: [], isManager: false, permissions: [] };
      return true;
    }

    if (requestedWorkspaceId && !allowedWorkspaceIds.includes(requestedWorkspaceId)) {
      throw new ForbiddenException('Not a member of this workspace');
    }

    const workspaceId = requestedWorkspaceId ?? allowedWorkspaceIds[0];
    const membership = memberships.find((m) => m.workspaceId === workspaceId);
    const isManager = membership?.role === 'owner';
    const permissions = isManager ? undefined : (membership?.permissions ?? []);
    request.workspaceScope = { isPlatformAdmin: false, workspaceId, allowedWorkspaceIds, isManager, permissions };

    // Members only reach the areas their role grants, with the same scopes
    // and the same per-handler declarations as API keys.
    const required = permissions ? declaredScope(this.reflector, context, request.method) : undefined;
    if (permissions && required && !scopeGrants(permissions, required)) {
      const [resource, access] = required.split(':');
      const area = AREA_LABELS[resource] ?? resource;
      throw new ForbiddenException(
        access === 'write' && scopeGrants(permissions, `${resource}:read` as typeof required)
          ? `Votre rôle donne accès à « ${area} » en lecture seule : demandez à un administrateur du workspace pour modifier.`
          : `Votre rôle ne donne pas accès à « ${area} » dans ce workspace.`,
      );
    }
    return true;
  }
}

const AREA_LABELS: Record<string, string> = {
  nodes: 'Nœuds',
  storage: 'Stockage',
  network: 'Réseau privé',
  dns: 'DNS',
  vpn: 'VPN',
  alerts: 'Alertes',
  logs: 'Journal',
};

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value || undefined;
}

// For models with a direct `workspaceId` column: spread into a Prisma
// `where` clause. Always filters to the caller's currently-selected
// workspace (scope.workspaceId), for members AND platform admins alike -
// isPlatformAdmin only controls *which* workspaces a caller may select into
// (see WorkspaceGuard), never "see every workspace's data merged together".
// A platform admin who wants a different workspace's data switches into it
// (X-Workspace-Id) exactly like a member would; GET /workspaces is the one
// deliberate exception that lists across all of them.
export function scopeWhere(scope: WorkspaceScope): { workspaceId?: string } {
  return { workspaceId: scope.workspaceId };
}

// Same, for models scoped only via their (mandatory, cascade-deleted) Node
// relation - MetricSample, Disk, SmartReport, AgentLog, VlanMember, etc.
export function scopeWhereViaNode(scope: WorkspaceScope): { node?: { workspaceId: string } } {
  return { node: { workspaceId: scope.workspaceId as string } };
}

// Usage: `list(@CurrentWorkspace() scope: WorkspaceScope)`, then filter with
// `scopeWhere(scope)` / `scopeWhereViaNode(scope)` above.
export const CurrentWorkspace = createParamDecorator((_: unknown, context: ExecutionContext): WorkspaceScope => {
  const request = context.switchToHttp().getRequest<RequestWithWorkspaceScope>();
  if (!request.workspaceScope) {
    throw new Error('CurrentWorkspace used without WorkspaceGuard in the guard chain');
  }
  return request.workspaceScope;
});
