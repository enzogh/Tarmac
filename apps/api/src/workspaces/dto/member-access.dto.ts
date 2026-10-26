import { ArrayUnique, IsArray, IsEmail, IsIn, IsOptional } from 'class-validator';
import { API_KEY_SCOPES, ApiKeyScope } from '../../api-keys/api-key-token';

export const MEMBER_ROLES = ['owner', 'member'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

// "owner" administers the workspace; "member" gets `permissions`, in the
// API keys' scope vocabulary (see api-key-token.ts).
export class MemberAccessDto {
  @IsOptional()
  @IsIn(MEMBER_ROLES)
  role?: MemberRole;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(API_KEY_SCOPES, { each: true })
  permissions?: ApiKeyScope[];
}

export class InviteMemberDto extends MemberAccessDto {
  @IsEmail()
  email!: string;
}
