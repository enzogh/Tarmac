import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AgentsService } from './agents.service';

const GRACE_PERIOD_MS = 24 * 60 * 60 * 1000;

/**
 * Per-node agent tokens, hashed at rest. Nodes onboarded before this existed
 * have `agentTokenHash = null` and keep authenticating against the legacy
 * global AGENT_SHARED_TOKEN until their first rotation.
 */
@Injectable()
export class AgentTokenService {
  private readonly logger = new Logger(AgentTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentsService: AgentsService,
  ) {}

  generate(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  hash(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private matches(candidate: string, storedHex: string | null | undefined): boolean {
    if (!storedHex) return false;
    const candidateHash = Buffer.from(this.hash(candidate), 'hex');
    const stored = Buffer.from(storedHex, 'hex');
    return candidateHash.length === stored.length && crypto.timingSafeEqual(candidateHash, stored);
  }

  private legacyTokenMatches(candidate: string): boolean {
    return candidate === (process.env.AGENT_SHARED_TOKEN ?? 'agent-secret');
  }

  async verify(nodeId: string, presentedToken: string): Promise<boolean> {
    if (!nodeId || !presentedToken) return false;

    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      select: { agentTokenHash: true, agentTokenPreviousHash: true, agentTokenGraceUntil: true },
    });
    if (!node) return false;

    if (!node.agentTokenHash) {
      return this.legacyTokenMatches(presentedToken);
    }

    if (this.matches(presentedToken, node.agentTokenHash)) {
      if (node.agentTokenGraceUntil) {
        await this.prisma.node.update({
          where: { id: nodeId },
          data: { agentTokenPreviousHash: null, agentTokenGraceUntil: null },
        });
      }
      return true;
    }

    const graceActive = !!node.agentTokenGraceUntil && node.agentTokenGraceUntil.getTime() > Date.now();
    if (!graceActive) return false;

    if (node.agentTokenPreviousHash) {
      return this.matches(presentedToken, node.agentTokenPreviousHash);
    }
    // First-ever rotation of a legacy node: nothing to fall back to yet
    // except the global secret it was still using before this rotation.
    return this.legacyTokenMatches(presentedToken);
  }

  /**
   * Call after a node's connection is registered. If a rotation is still
   * pending confirmation (grace window open), re-issue it over this fresh
   * connection - covers the case where the node just reconnected with its
   * old/legacy credential because the original push never reached it.
   */
  async resendPendingRotationIfNeeded(nodeId: string): Promise<void> {
    const node = await this.prisma.node.findUnique({
      where: { id: nodeId },
      select: { agentTokenGraceUntil: true },
    });
    if (!node?.agentTokenGraceUntil || node.agentTokenGraceUntil.getTime() <= Date.now()) return;

    this.logger.log(`Node ${nodeId} reconnected mid-rotation, re-issuing agent token`);
    await this.rotate(nodeId);
  }

  async rotate(nodeId: string): Promise<{ rotated: boolean; delivered: boolean }> {
    const node = await this.prisma.node.findUnique({ where: { id: nodeId }, select: { agentTokenHash: true } });
    if (!node) return { rotated: false, delivered: false };

    const token = this.generate();

    await this.prisma.node.update({
      where: { id: nodeId },
      data: {
        agentTokenPreviousHash: node.agentTokenHash,
        agentTokenGraceUntil: new Date(Date.now() + GRACE_PERIOD_MS),
        agentTokenHash: this.hash(token),
        agentTokenRotatedAt: new Date(),
      },
    });

    const delivered = this.agentsService.sendCommand(nodeId, {
      type: 'command.rotate_token',
      payload: { token },
    });

    return { rotated: true, delivered };
  }

  async rotateAll(): Promise<Array<{ nodeId: string; delivered: boolean }>> {
    const nodes = await this.prisma.node.findMany({ select: { id: true } });
    const results: Array<{ nodeId: string; delivered: boolean }> = [];
    for (const node of nodes) {
      const { delivered } = await this.rotate(node.id);
      results.push({ nodeId: node.id, delivered });
    }
    return results;
  }

  @Cron(CronExpression.EVERY_HOUR)
  async clearExpiredGraceWindows() {
    try {
      const { count } = await this.prisma.node.updateMany({
        where: { agentTokenGraceUntil: { lt: new Date() } },
        data: { agentTokenPreviousHash: null, agentTokenGraceUntil: null },
      });
      if (count > 0) {
        this.logger.warn(`Expired agent-token grace window for ${count} node(s) without confirmed rotation`);
      }
    } catch (error) {
      this.logger.error('Failed to clear expired agent-token grace windows', error);
    }
  }
}
