import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreatePoolDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(2)
  strategy!: string;

  @IsOptional()
  @IsString()
  @IsIn(['pending', 'active', 'error'])
  status?: 'pending' | 'active' | 'error';
}
