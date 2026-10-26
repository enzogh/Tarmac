import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateNodeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  @IsIn(['controller', 'worker'])
  role?: string;

  @IsOptional()
  @IsString()
  @IsIn(['offline', 'online', 'degraded'])
  status?: string;

  @IsOptional()
  @IsString()
  locationCity?: string | null;

  @IsOptional()
  @IsString()
  locationCountry?: string | null;

  @IsOptional()
  @IsString()
  locationCountryCode?: string | null;

  @IsOptional()
  @IsNumber()
  locationLat?: number | null;

  @IsOptional()
  @IsNumber()
  locationLng?: number | null;

  @IsOptional()
  @IsNumber()
  graphX?: number | null;

  @IsOptional()
  @IsNumber()
  graphY?: number | null;

  // Custom <dnsHostname>.tarmac.local label - only meaningful once the
  // workspace has a node designated to run the internal DNS zone, but
  // editable regardless so it's ready whenever that happens.
  @IsOptional()
  @IsString()
  dnsHostname?: string | null;

  // See Node.smartMonitoringEnabled: lets a node whose SMART data is
  // meaningless (a VPS on virtualised storage) stop raising disk alerts.
  @IsOptional()
  @IsBoolean()
  smartMonitoringEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  labels?: string[];
}
