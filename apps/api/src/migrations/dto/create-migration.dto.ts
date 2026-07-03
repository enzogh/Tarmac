import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateMigrationDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  shareId?: string;

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
  sourcePath?: string;

  @IsOptional()
  @IsString()
  targetPath?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
