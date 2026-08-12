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
  isPlatformAdmin: boolean;
  // Present on both platform-admin and member scopes: the workspace the
  // request should act on. For a platform admin with no explicit
  // X-Workspace-Id header, this is undefined and callers must treat an
  // absent workspaceId as "no filter" (see isPlatformAdmin).
  workspaceId?: string;
  // All workspace ids the caller may switch into (platform admins get every
  // workspace; members get only their own memberships).
  allowedWorkspaceIds: string[];
}

interface RequestWithWorkspaceScope extends Request {
  user?: { userId?: string };
  workspaceScope?: WorkspaceScope;
}

// Not yet mounted on any controller - Phase 1 adds
// `@UseGuards(JwtAuthGuard, WorkspaceGuard)` + `@CurrentWorkspace()` to each
// resource controller and does the actual per-query filtering. This guard is
// written and unit-testable now so that wiring it up later is a small,
// reviewable diff instead of a from-scratch addition.
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
      const allWorkspaceIds = (await this.prisma.workspace.findMany({ select: { id: true } })).map((w) => w.id);
      request.workspaceScope = {
        isPlatformAdmin: true,
        workspaceId: requestedWorkspaceId ?? undefined,
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

// Usage (Phase 1, once mounted): `list(@CurrentWorkspace() scope: WorkspaceScope)`
// then filter with `scope.isPlatformAdmin && !scope.workspaceId ? {} : { workspaceId: scope.workspaceId }`.
export const CurrentWorkspace = createParamDecorator((_: unknown, context: ExecutionContext): WorkspaceScope => {
  const request = context.switchToHttp().getRequest<RequestWithWorkspaceScope>();
  if (!request.workspaceScope) {
    throw new Error('CurrentWorkspace used without WorkspaceGuard in the guard chain');
  }
  return request.workspaceScope;
});
