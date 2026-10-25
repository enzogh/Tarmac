import { IsOptional, Matches } from 'class-validator';

export class RotateVpnKeysDto {
  // Same bring-your-own-key option as on creation.
  @IsOptional()
  @Matches(/^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw480]=$/, { message: 'publicKey must be a base64 WireGuard public key' })
  publicKey?: string;
}
