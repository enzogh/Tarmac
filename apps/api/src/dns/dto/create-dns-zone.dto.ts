import { IsBoolean, IsFQDN, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateDnsZoneDto {
  @IsString()
  @MinLength(1)
  groupId!: string;

  @IsFQDN()
  name!: string;

  @IsOptional()
  @IsBoolean()
  dnssecEnabled?: boolean;
}
