import { ArrayMinSize, ArrayUnique, IsArray, IsIn, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { API_KEY_SCOPES, ApiKeyScope } from '../api-key-token';

// Every field optional; the token itself never changes (rotate = new key).
export class UpdateApiKeyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(API_KEY_SCOPES, { each: true })
  scopes?: ApiKeyScope[];

  // undefined = unchanged, null = never expires.
  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;
}
