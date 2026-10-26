import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { SecretsAtRestService } from './secrets-at-rest.service';

@Global()
@Module({
  providers: [PrismaService, SecretsAtRestService],
  exports: [PrismaService],
})
export class PrismaModule {}
