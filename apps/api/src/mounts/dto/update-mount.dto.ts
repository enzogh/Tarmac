import { IsArray, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateMountDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  sourcePath?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  additionalSources?: string[];

  @IsOptional()
  @IsString()
  @MinLength(1)
  targetPath?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  fsType?: string;

  @IsOptional()
  @IsString()
  mountOptions?: string;

  @IsOptional()
  @IsString()
  nodeId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['pending', 'active', 'error'])
  status?: string;
}
