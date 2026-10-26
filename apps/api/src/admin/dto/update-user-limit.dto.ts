import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateUserLimitDto {
  // Null resets the user to the platform default (IsOptional lets it
  // through unvalidated); absent leaves it unchanged.
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  workspaceLimit?: number | null;

  // Disables (or re-enables) the account in Tarmac, whatever Authentik says.
  @IsOptional()
  @IsBoolean()
  disabled?: boolean;
}
