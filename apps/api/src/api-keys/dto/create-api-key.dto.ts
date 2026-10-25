import { ArrayMinSize, ArrayUnique, IsArray, IsIn, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { API_KEY_SCOPES, ApiKeyScope } from '../api-key-token';

export class CreateApiKeyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(API_KEY_SCOPES, { each: true })
  scopes!: ApiKeyScope[];

  // Omitted = never expires (revocation is always available).
  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
