import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { WorkspaceScope } from '../auth/workspace.guard';

type Id = string | null | undefined;

function requireWorkspaceId(scope: WorkspaceScope): string {
  // Prisma reads `workspaceId: undefined` as "no filter": without this, a
  // scope with no selected workspace would match nodes of every workspace.
  if (!scope.workspaceId) throw new ForbiddenException('Aucun workspace sélectionné.');
  return scope.workspaceId;
}

function distinct(ids: Id[]): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))];
}

/**
 * Every node id a request names (a mount's node, a migration's source and
 * target, a pool or DNS group member...) must belong to the caller's
 * workspace. Resource ids are not secrets - a former member still knows
 * them - and these nodes then receive root-level commands from the agent
 * channel, so this is checked on every write that references one.
 */
export async function assertNodesInWorkspace(prisma: PrismaService, scope: WorkspaceScope, ...nodeIds: Id[]): Promise<void> {
  const ids = distinct(nodeIds);
  if (ids.length === 0) return;
  const workspaceId = requireWorkspaceId(scope);
  const count = await prisma.node.count({ where: { id: { in: ids }, workspaceId } });
  if (count !== ids.length) throw new NotFoundException('Serveur introuvable dans ce workspace.');
}

export async function assertShareInWorkspace(prisma: PrismaService, scope: WorkspaceScope, shareId: Id): Promise<void> {
  if (!shareId) return;
  const workspaceId = requireWorkspaceId(scope);
  const share = await prisma.share.findFirst({ where: { id: shareId, workspaceId }, select: { id: true } });
  if (!share) throw new NotFoundException('Partage introuvable dans ce workspace.');
}
