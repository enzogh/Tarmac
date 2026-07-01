import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateAlertRuleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  metric?: string;

  @IsOptional()
  @IsString()
  @IsIn(['gt', 'gte', 'lt', 'lte'])
  comparator?: 'gt' | 'gte' | 'lt' | 'lte';

  @IsOptional()
  @IsNumber()
  threshold?: number;

  @IsOptional()
  @IsString()
  @IsIn(['low', 'medium', 'high', 'critical'])
  severity?: 'low' | 'medium' | 'high' | 'critical';

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  nodeId?: string;

  @IsOptional()
  @IsString()
  notificationChannelId?: string;
}
