import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateAdminSettingsDto {
  // Null goes back to WORKSPACE_CREATION_LIMIT from the environment.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  defaultWorkspaceLimit?: number | null;
}

export class TransferWorkspaceDto {
  @IsString()
  userId!: string;
}

export class ConfigureGithubDto {
  @IsString()
  @MaxLength(200)
  repository!: string;

  // Omitted: keep the token already saved.
  @IsOptional()
  @IsString()
  @MaxLength(400)
  token?: string;
}
