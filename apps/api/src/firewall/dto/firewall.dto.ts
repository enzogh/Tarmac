import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { FW_MODES, FW_PROTOCOLS, FwMode, FwProtocol } from '../firewall-policy';

const PORT = /^\d{1,5}(-\d{1,5})?$/;
const LABEL = /^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,31}$/u;

export class UpdateFirewallSettingsDto {
  @IsOptional()
  @IsIn(FW_MODES)
  meshMode?: FwMode;

  @IsOptional()
  @IsBoolean()
  publicPing?: boolean;

  @IsOptional()
  @IsBoolean()
  sshGuard?: boolean;

  @IsOptional()
  @IsBoolean()
  sshLimit?: boolean;
}

export class UpdateFirewallNodeDto {
  @IsIn(FW_MODES)
  publicMode!: FwMode;
}

export class BulkFirewallNodesDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  nodeIds!: string[];

  // At least one of the two.
  @IsOptional()
  @IsIn(FW_MODES)
  publicMode?: FwMode;

  @IsOptional()
  @IsIn(FW_MODES)
  outboundMode?: FwMode;
}

export class CreateFirewallRuleDto {
  @IsIn(['mesh', 'public', 'outbound'])
  scope!: 'mesh' | 'public' | 'outbound';

  @IsIn(['allow', 'deny'])
  action!: 'allow' | 'deny';

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsIn(['any', 'nodes', 'labels', 'cidrs', 'lists', 'countries'])
  sourceKind!: 'any' | 'nodes' | 'labels' | 'cidrs' | 'lists' | 'countries';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  sourceNodeIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(LABEL, { each: true })
  sourceLabels?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  sourceCidrs?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  sourceListIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @Matches(/^[A-Za-z]{2}$/, { each: true })
  sourceCountries?: string[];

  @IsIn(['any', 'nodes', 'labels'])
  targetKind!: 'any' | 'nodes' | 'labels';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  targetNodeIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(LABEL, { each: true })
  targetLabels?: string[];

  @IsIn(FW_PROTOCOLS)
  protocol!: FwProtocol;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15)
  @Matches(PORT, { each: true })
  ports?: string[];

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  expiresAt?: string | null;
}

export class UpdateFirewallRuleDto {
  @IsOptional()
  @IsIn(['allow', 'deny'])
  action?: 'allow' | 'deny';

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
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['any', 'nodes', 'labels', 'cidrs', 'lists', 'countries'])
  sourceKind?: 'any' | 'nodes' | 'labels' | 'cidrs' | 'lists' | 'countries';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  sourceNodeIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(LABEL, { each: true })
  sourceLabels?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  sourceCidrs?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  sourceListIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @Matches(/^[A-Za-z]{2}$/, { each: true })
  sourceCountries?: string[];

  @IsOptional()
  @IsIn(['any', 'nodes', 'labels'])
  targetKind?: 'any' | 'nodes' | 'labels';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  targetNodeIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(LABEL, { each: true })
  targetLabels?: string[];

  @IsOptional()
  @IsIn(FW_PROTOCOLS)
  protocol?: FwProtocol;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15)
  @Matches(PORT, { each: true })
  ports?: string[];

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsISO8601()
  expiresAt?: string | null;
}

export class TestFirewallDto {
  @IsIn(['mesh', 'public', 'outbound'])
  scope!: 'mesh' | 'public' | 'outbound';

  @IsString()
  targetNodeId!: string;

  @IsOptional()
  @IsString()
  sourceNodeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceIp?: string;

  @IsIn(['tcp', 'udp', 'icmp'])
  protocol!: 'tcp' | 'udp' | 'icmp';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  port?: number;
}

export class FirewallAddressListDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  cidrs!: string[];
}

export class UpdateFirewallAddressListDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(300)
  description?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  cidrs?: string[];
}
