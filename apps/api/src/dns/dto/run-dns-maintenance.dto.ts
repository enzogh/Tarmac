import { IsBoolean, IsOptional } from 'class-validator';

export class RunDnsMaintenanceDto {
  // true: upgrade PowerDNS; otherwise retry the tasks the agent gave up on.
  @IsOptional()
  @IsBoolean()
  upgrade?: boolean;
}
