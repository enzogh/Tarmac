import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsIP,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  VPN_ACCESS_SCOPES,
  VPN_PROFILE_MODES,
  VPN_TAG,
  VpnAccessScopeValue,
  VpnProfileModeValue,
} from './create-vpn-profile.dto';

export class UpdateVpnProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @IsOptional()
  @IsIn(VPN_PROFILE_MODES)
  mode?: VpnProfileModeValue;

  // Changing the entry node gives the client a new address and endpoint:
  // its config has to be downloaded and imported again.
  @IsOptional()
  @IsString()
  entryNodeId?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  exitNodeId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsIP(4, { each: true })
  dns?: string[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  expiresAt?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @Matches(VPN_TAG, { each: true, message: 'each tag must be 1-32 letters, digits, spaces, dots, dashes or underscores' })
  tags?: string[];

  @IsOptional()
  @IsIn(VPN_ACCESS_SCOPES)
  meshAccess?: VpnAccessScopeValue;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  meshNodeIds?: string[];

  @IsOptional()
  @IsIn(VPN_ACCESS_SCOPES)
  peerAccess?: VpnAccessScopeValue;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  peerProfileIds?: string[];
}
