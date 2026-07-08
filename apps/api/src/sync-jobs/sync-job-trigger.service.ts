import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Per-SyncJob secret allowing an external script (e.g. qBittorrent's "run
 * external program on completion") to start a run over plain HTTP without an
 * interactive JWT session. Only the sha256 hash is stored at rest, mirroring
 * AgentTokenService. Unlike agent tokens, rotation has no grace window: the
 * secret only lives in one external config file the operator controls, so an
 * immediate cutover on rotation is acceptable and keeps this simpler.
 */
@Injectable()
export class SyncJobTriggerService {
  constructor(private readonly prisma: PrismaService) {}

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

  async verify(syncJobId: string, presentedToken: string | undefined): Promise<boolean> {
    if (!syncJobId || !presentedToken) return false;

    const job = await this.prisma.syncJob.findUnique({
      where: { id: syncJobId },
      select: { triggerTokenHash: true },
    });
    if (!job) return false;

    return this.matches(presentedToken, job.triggerTokenHash);
  }

  async rotate(syncJobId: string): Promise<string> {
    const token = this.generate();
    await this.prisma.syncJob.update({
      where: { id: syncJobId },
      data: { triggerTokenHash: this.hash(token), triggerTokenRotatedAt: new Date() },
    });
    return token;
  }
}
