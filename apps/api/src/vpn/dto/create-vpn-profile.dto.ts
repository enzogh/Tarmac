import {
  ArrayMaxSize,
  IsArray,
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

export const VPN_PROFILE_MODES = ['full', 'private'] as const;
export type VpnProfileModeValue = (typeof VPN_PROFILE_MODES)[number];

const WIREGUARD_KEY = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$/;

export class CreateVpnProfileDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsIn(VPN_PROFILE_MODES)
  mode?: VpnProfileModeValue;

  // The node clients connect to.
  @IsString()
  entryNodeId!: string;

  // Node the internet traffic leaves through (full mode). Omitted, null or
  // equal to entryNodeId = leave directly through the entry node.
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  exitNodeId?: string | null;

  // Omitted = 1.1.1.1/1.0.0.1 in full mode, none in private mode.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsIP(4, { each: true })
  dns?: string[];

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;

  // Bring your own key: only the public half is sent, the private key never
  // leaves the client and the downloaded config carries a placeholder.
  @IsOptional()
  @Matches(WIREGUARD_KEY, { message: 'publicKey must be a base64 WireGuard public key' })
  publicKey?: string;
}
