import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateMountDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(1)
  sourcePath!: string;

  @IsString()
  @MinLength(1)
  targetPath!: string;

  @IsOptional()
  @IsString()
  nodeId?: string;
}
