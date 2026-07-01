import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateShareDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  path?: string;

  @IsOptional()
  @IsString()
  nodeId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['pending', 'active', 'error'])
  status?: string;
}
