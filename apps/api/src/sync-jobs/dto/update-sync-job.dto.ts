import { IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class UpdateSyncJobDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  sourcePath?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  targetPath?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  schedule?: string;

  @IsOptional()
  @IsString()
  nodeId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['pending', 'running', 'success', 'failed'])
  status?: 'pending' | 'running' | 'success' | 'failed';

  @IsOptional()
  @IsString()
  @MinLength(1)
  sourceHost?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  sourceUser?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  sourceSshPort?: number;
}
