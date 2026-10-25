import { IsOptional, IsString, ValidateIf } from 'class-validator';

export class SwitchVpnExitDto {
  // null (or the entry node's own id) = leave directly through the entry node.
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  exitNodeId!: string | null;
}
