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

  @IsOptional()
  @IsString()
  sourceKind?: 'node' | 'seedbox';

  @IsOptional()
  @IsString()
  targetKind?: 'node' | 'seedbox';

  @IsOptional()
  @IsString()
  sourceSeedboxHost?: string;

  @IsOptional()
  @IsString()
  sourceSeedboxUser?: string;

  @IsOptional()
  @IsString()
  sourceSeedboxPassword?: string;

  @IsOptional()
  @IsString()
  sourceSeedboxPort?: string;

  @IsOptional()
  @IsString()
  targetSeedboxHost?: string;

  @IsOptional()
  @IsString()
  targetSeedboxUser?: string;

  @IsOptional()
  @IsString()
  targetSeedboxPassword?: string;

  @IsOptional()
  @IsString()
  targetSeedboxPort?: string;
}
