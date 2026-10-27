import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { GithubModule } from '../github/github.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [AuthModule, WorkspacesModule, GithubModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
