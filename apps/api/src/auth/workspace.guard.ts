import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

const WORKSPACE_HEADER = 'x-workspace-id';

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
}

interface RequestWithWorkspaceScope extends Request {
  user?: { userId?: string };
  workspaceScope?: WorkspaceScope;
}

// Mounted via `@UseGuards(JwtAuthGuard, WorkspaceGuard)` on every
// workspace-scoped controller, paired with `@CurrentWorkspace()` to read the
// resolved scope back out in the handler.
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithWorkspaceScope>();
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
      };
      return true;
    }

    const memberships = await this.prisma.workspaceMembership.findMany({
      where: { userId },
      select: { workspaceId: true },
    });
    const allowedWorkspaceIds = memberships.map((m) => m.workspaceId);
    if (allowedWorkspaceIds.length === 0) {
      throw new ForbiddenException('No workspace access');
    }

    if (requestedWorkspaceId && !allowedWorkspaceIds.includes(requestedWorkspaceId)) {
      throw new ForbiddenException('Not a member of this workspace');
    }

    request.workspaceScope = {
      isPlatformAdmin: false,
      workspaceId: requestedWorkspaceId ?? allowedWorkspaceIds[0],
      allowedWorkspaceIds,
    };
    return true;
  }
}

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
