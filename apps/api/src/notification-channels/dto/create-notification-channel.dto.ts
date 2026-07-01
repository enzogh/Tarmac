import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateNotificationChannelDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @IsIn(['email', 'webhook', 'slack'])
  type!: 'email' | 'webhook' | 'slack';

  @IsString()
  @MinLength(3)
  target!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}
