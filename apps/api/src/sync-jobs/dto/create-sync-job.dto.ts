import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

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
