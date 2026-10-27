import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateDnsZoneDto {
  @IsOptional()
  @IsBoolean()
  dnssecEnabled?: boolean;
}
