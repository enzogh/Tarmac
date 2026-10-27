import { Module } from '@nestjs/common';
import { GithubDeployKeysService } from './github-deploy-keys.service';

@Module({
  providers: [GithubDeployKeysService],
  exports: [GithubDeployKeysService],
})
export class GithubModule {}
