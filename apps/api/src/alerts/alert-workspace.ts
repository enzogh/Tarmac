import { PrismaClient } from '@prisma/client';
import { DEFAULT_WORKSPACE_ID } from '../workspaces/default-workspace';

/**
 * The workspace an alert raised by background work belongs to: the one of
 * the node it is about. Alerts used to be filed under the default workspace
 * whatever the node, so every other workspace's incidents showed up there.
 * Only platform-level failures tied to no node (API crash, a reconciliation
 * tick that blew up) still land in the default workspace.
 */
export async function alertWorkspaceId(
  prisma: Pick<PrismaClient, 'node'>,
  nodeId: string | null | undefined,
): Promise<string> {
  if (!nodeId) return DEFAULT_WORKSPACE_ID;
  const node = await prisma.node.findUnique({ where: { id: nodeId }, select: { workspaceId: true } });
  return node?.workspaceId ?? DEFAULT_WORKSPACE_ID;
}
