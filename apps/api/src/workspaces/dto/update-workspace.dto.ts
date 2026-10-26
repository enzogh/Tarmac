import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateWorkspaceDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  // The /<slug>/dashboard URL segment. Safe to change: agents and every
  // internal lookup use the workspace id, and the old slug stays a redirect
  // alias (Workspace.previousSlugs).
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(48)
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: 'Le slug ne peut contenir que des minuscules, des chiffres et des tirets.' })
  slug?: string;

  // Authentik group name that auto-grants membership on SSO login. Set to an
  // empty string to clear it (falls back to manual-only membership grants).
  @IsOptional()
  @IsString()
  @MaxLength(200)
  ssoGroupClaim?: string;

  // Monday-morning summary emailed to the owner.
  @IsOptional()
  @IsBoolean()
  weeklyReportEnabled?: boolean;
}
