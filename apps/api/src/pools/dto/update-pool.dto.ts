import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdatePoolDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  strategy?: string;

  @IsOptional()
  @IsString()
  @IsIn(['pending', 'active', 'error'])
  status?: 'pending' | 'active' | 'error';
}
