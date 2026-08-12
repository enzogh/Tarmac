import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateWorkspaceDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  // Authentik group name that auto-grants membership on SSO login. Set to an
  // empty string to clear it (falls back to manual-only membership grants).
  @IsOptional()
  @IsString()
  ssoGroupClaim?: string;
}
