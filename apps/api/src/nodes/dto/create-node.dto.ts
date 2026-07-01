import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateNodeDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @IsIn(['controller', 'worker'])
  role!: string;

  @IsOptional()
  @IsString()
  @IsIn(['offline', 'online', 'degraded'])
  status?: string;
}
