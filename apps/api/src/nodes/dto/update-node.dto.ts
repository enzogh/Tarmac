import { IsIn, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';

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
}
