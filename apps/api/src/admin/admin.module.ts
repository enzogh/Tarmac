import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [AuthModule, WorkspacesModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
