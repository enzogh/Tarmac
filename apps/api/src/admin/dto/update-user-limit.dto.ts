import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateUserLimitDto {
  // Null resets the user to WORKSPACE_CREATION_LIMIT (IsOptional lets it
  // through unvalidated).
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  workspaceLimit!: number | null;
}
