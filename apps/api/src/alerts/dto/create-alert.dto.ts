import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateAlertDto {
  @IsOptional()
  @IsString()
  ruleId?: string;

  @IsOptional()
  @IsString()
  nodeId?: string;

  @IsString()
  @MinLength(2)
  message!: string;

  @IsString()
  @IsIn(['low', 'medium', 'high', 'critical'])
  severity!: 'low' | 'medium' | 'high' | 'critical';
}
