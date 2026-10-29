import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceScope } from '../src/auth/workspace.guard';
import { assertNodesInWorkspace, assertShareInWorkspace } from '../src/common/workspace-ownership';
import { isPublicIp } from '../src/nodes/node-onboarding.service';
import type { PrismaService } from '../src/prisma/prisma.service';

const NODES: Record<string, string> = { 'node-a1': 'ws-a', 'node-a2': 'ws-a', 'node-b1': 'ws-b' };

// Just enough of Prisma for the two helpers: count/findFirst filtered by
// id(s) and workspaceId, the way PostgreSQL would answer.
const prisma = {
  node: {
    count: async ({ where }: { where: { id: { in: string[] }; workspaceId: string } }) =>
      where.id.in.filter((id) => NODES[id] === where.workspaceId).length,
  },
  share: {
    findFirst: async ({ where }: { where: { id: string; workspaceId: string } }) =>
      where.id === 'share-a' && where.workspaceId === 'ws-a' ? { id: 'share-a' } : null,
  },
} as unknown as PrismaService;

const scopeA: WorkspaceScope = { isPlatformAdmin: false, workspaceId: 'ws-a', allowedWorkspaceIds: ['ws-a'], isManager: true };

test('nodes of the current workspace pass, empty values are ignored', async () => {
  await assertNodesInWorkspace(prisma, scopeA, 'node-a1', 'node-a2', 'node-a1', undefined, null, '');
  await assertNodesInWorkspace(prisma, scopeA);
});

test('a node of another workspace is refused, even mixed with own nodes', async () => {
  await assert.rejects(assertNodesInWorkspace(prisma, scopeA, 'node-b1'), /introuvable/);
  await assert.rejects(assertNodesInWorkspace(prisma, scopeA, 'node-a1', 'node-b1'), /introuvable/);
  await assert.rejects(assertNodesInWorkspace(prisma, scopeA, 'does-not-exist'), /introuvable/);
});

test('no selected workspace never matches every workspace', async () => {
  const noWorkspace: WorkspaceScope = { isPlatformAdmin: false, allowedWorkspaceIds: [], isManager: false };
  await assert.rejects(assertNodesInWorkspace(prisma, noWorkspace, 'node-a1'), /Aucun workspace/);
});

test('shares are checked the same way', async () => {
  await assertShareInWorkspace(prisma, scopeA, 'share-a');
  await assertShareInWorkspace(prisma, scopeA, undefined);
  await assert.rejects(assertShareInWorkspace(prisma, scopeA, 'share-b'), /introuvable/);
});

test('onboarding accepts public addresses only', () => {
  for (const ip of ['51.68.10.20', '8.8.8.8', '2001:41d0:8:1::1']) assert.equal(isPublicIp(ip), true, ip);
  for (const ip of ['10.0.0.5', '10.255.0.176', '127.0.0.1', '169.254.169.254', '172.16.3.4', '192.168.1.1', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1']) {
    assert.equal(isPublicIp(ip), false, ip);
  }
});
