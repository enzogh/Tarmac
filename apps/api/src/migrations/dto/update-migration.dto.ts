import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateMigrationDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  sourceNodeId?: string;

  @IsOptional()
  @IsString()
  targetNodeId?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  @IsIn(['pending', 'running', 'completed', 'failed'])
  status?: 'pending' | 'running' | 'completed' | 'failed';

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress?: number;
}
