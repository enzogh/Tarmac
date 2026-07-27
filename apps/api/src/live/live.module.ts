import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LiveWsServer } from './live.ws';

@Module({
  imports: [AuthModule],
  providers: [LiveWsServer],
  exports: [LiveWsServer],
})
export class LiveModule {}
