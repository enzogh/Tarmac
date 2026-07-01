import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateNotificationChannelDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn(['email', 'webhook', 'slack'])
  type?: 'email' | 'webhook' | 'slack';

  @IsOptional()
  @IsString()
  @MinLength(3)
  target?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
