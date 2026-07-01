import { IsBoolean, IsIn, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateAlertRuleDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(2)
  metric!: string;

  @IsString()
  @IsIn(['gt', 'gte', 'lt', 'lte'])
  comparator!: 'gt' | 'gte' | 'lt' | 'lte';

  @IsNumber()
  threshold!: number;

  @IsString()
  @IsIn(['low', 'medium', 'high', 'critical'])
  severity!: 'low' | 'medium' | 'high' | 'critical';

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
