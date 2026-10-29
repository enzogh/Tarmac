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

  @IsIn(FW_MODES)
  publicMode!: FwMode;
}

export class CreateFirewallRuleDto {
  @IsIn(['mesh', 'public'])
  scope!: 'mesh' | 'public';

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

  @IsIn(['any', 'nodes', 'labels', 'cidrs'])
  sourceKind!: 'any' | 'nodes' | 'labels' | 'cidrs';

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
  @IsIn(['any', 'nodes', 'labels', 'cidrs'])
  sourceKind?: 'any' | 'nodes' | 'labels' | 'cidrs';

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
  @IsIn(['mesh', 'public'])
  scope!: 'mesh' | 'public';

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
