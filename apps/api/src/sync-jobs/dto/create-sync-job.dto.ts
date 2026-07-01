import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateSyncJobDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(1)
  sourcePath!: string;

  @IsString()
  @MinLength(1)
  targetPath!: string;

  @IsString()
  @MinLength(1)
  schedule!: string;

  @IsOptional()
  @IsString()
  nodeId?: string;
}
