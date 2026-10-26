import { PrismaService } from '../prisma/prisma.service';

export const DEFAULT_WORKSPACE_CREATION_LIMIT = 2;

// WORKSPACE_CREATION_LIMIT, the cap for users without a per-user override.
export function defaultWorkspaceLimit(): number {
  const parsed = Number.parseInt(process.env.WORKSPACE_CREATION_LIMIT ?? '', 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_WORKSPACE_CREATION_LIMIT;
}

// How many workspaces a non-admin may still create; null when they may not
// create any (not in the Authentik access group).
export async function workspaceCreationQuota(
  prisma: PrismaService,
  userId: string,
): Promise<{ used: number; limit: number } | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { canCreateWorkspaces: true, workspaceLimit: true },
  });
  if (!user?.canCreateWorkspaces) return null;
  const used = await prisma.workspace.count({ where: { createdById: userId } });
  return { used, limit: user.workspaceLimit ?? defaultWorkspaceLimit() };
}
