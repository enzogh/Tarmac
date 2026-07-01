import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateNodeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn(['controller', 'worker'])
  role?: string;

  @IsOptional()
  @IsString()
  @IsIn(['offline', 'online', 'degraded'])
  status?: string;
}
