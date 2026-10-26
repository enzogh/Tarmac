import { ArrayUnique, IsArray, IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { API_KEY_SCOPES, ApiKeyScope } from '../../api-keys/api-key-token';

export const MEMBER_ROLES = ['owner', 'member'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

// "owner" administers the workspace; "member" gets `permissions`, in the
// API keys' scope vocabulary (see api-key-token.ts), or follows a custom
// role of the workspace (customRoleId, whose permissions then win).
export class MemberAccessDto {
  @IsOptional()
  @IsIn(MEMBER_ROLES)
  role?: MemberRole;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(API_KEY_SCOPES, { each: true })
  permissions?: ApiKeyScope[];

  // Null detaches the member from its custom role (keeping `permissions`).
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  customRoleId?: string | null;
}

export class InviteMemberDto extends MemberAccessDto {
  @IsEmail()
  email!: string;
}

export class CustomRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  description?: string;

  @IsArray()
  @ArrayUnique()
  @IsIn(API_KEY_SCOPES, { each: true })
  permissions!: ApiKeyScope[];
}

export class UpdateCustomRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(API_KEY_SCOPES, { each: true })
  permissions?: ApiKeyScope[];
}

export class TransferOwnershipDto {
  @IsString()
  userId!: string;

  // Whether the previous owner stays an administrator (default) or becomes
  // an editor.
  @IsOptional()
  @IsBoolean()
  keepAdmin?: boolean;
}
