import { IsArray, IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateMountDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(1)
  sourcePath!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  additionalSources?: string[];

  @IsString()
  @MinLength(1)
  targetPath!: string;

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
  @MinLength(1)
  remoteHost?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  remoteUser?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  remoteSshPort?: number;
}
