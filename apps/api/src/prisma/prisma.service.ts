import { INestApplication, Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    // Agent token hashes never leave the API: many endpoints return whole
    // Node rows (directly or through `include: { node: true }`). The one place
    // that needs them, AgentTokenService, asks for them with an explicit
    // `select`, which takes precedence over this.
    super({ omit: { node: { agentTokenHash: true, agentTokenPreviousHash: true } } });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async enableShutdownHooks(app: INestApplication) {
    process.on('beforeExit', async () => {
      await app.close();
    });
  }
}
