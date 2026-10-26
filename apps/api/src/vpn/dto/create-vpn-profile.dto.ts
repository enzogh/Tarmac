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
export const VPN_ACCESS_SCOPES = ['all', 'selected', 'none'] as const;
export type VpnAccessScopeValue = (typeof VPN_ACCESS_SCOPES)[number];
export const VPN_TAG = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,31}$/u;

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

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @Matches(VPN_TAG, { each: true, message: 'each tag must be 1-32 letters, digits, spaces, dots, dashes or underscores' })
  tags?: string[];

  // Omitted = the whole private network (entry node included).
  @IsOptional()
  @IsIn(VPN_ACCESS_SCOPES)
  meshAccess?: VpnAccessScopeValue;

  // Nodes reachable when meshAccess is "selected".
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  meshNodeIds?: string[];

  // Omitted = isolated from the other VPN clients.
  @IsOptional()
  @IsIn(VPN_ACCESS_SCOPES)
  peerAccess?: VpnAccessScopeValue;

  // Profiles this client may open connections to when peerAccess is
  // "selected" (one-way: the other profile needs its own rule to initiate).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  peerProfileIds?: string[];

  // Bring your own key: only the public half is sent, the private key never
  // leaves the client and the downloaded config carries a placeholder.
  @IsOptional()
  @Matches(WIREGUARD_KEY, { message: 'publicKey must be a base64 WireGuard public key' })
  publicKey?: string;
}
