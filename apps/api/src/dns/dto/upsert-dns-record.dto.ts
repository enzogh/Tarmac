import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'CAA', 'SRV', 'PTR'] as const;
export type DnsRecordTypeValue = (typeof RECORD_TYPES)[number];

export class DnsRecordValueDto {
  @IsString()
  @MinLength(1)
  content!: string;

  // Set when this value targets one of the workspace's own fleet nodes -
  // drives the "which records point here" reverse lookup from a node.
  @IsOptional()
  @IsString()
  nodeId?: string;

  // MX/SRV only.
  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}

export class UpsertDnsRecordDto {
  // Relative label ("www", "@" for the zone apex).
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @IsIn(RECORD_TYPES)
  type!: DnsRecordTypeValue;

  @IsOptional()
  @IsInt()
  @Min(1)
  ttl?: number;

  // false (default): plain multi-value RRset (round-robin). true: rendered
  // as a PowerDNS Lua record (pickclosest(...)) over `values` for GeoDNS.
  @IsOptional()
  @IsBoolean()
  isGeo?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DnsRecordValueDto)
  values!: DnsRecordValueDto[];
}
