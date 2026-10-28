import { IsIn, IsIP, IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class StartNodeOnboardingDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @IsIn(['ovh', 'standard'])
  provider!: 'ovh' | 'standard';

  @IsIP()
  hostIp!: string;

  @IsString()
  @MinLength(1)
  sshUsername!: string;

  // Defaults to password for clients that predate key authentication.
  @IsOptional()
  @IsIn(['password', 'key'])
  authMethod?: 'password' | 'key';

  @ValidateIf((dto: StartNodeOnboardingDto) => (dto.authMethod ?? 'password') === 'password')
  @IsString()
  @MinLength(1)
  sshPassword?: string;

  // OpenSSH or PEM private key, as pasted or read from the user's file.
  @ValidateIf((dto: StartNodeOnboardingDto) => dto.authMethod === 'key')
  @IsString()
  @MinLength(1)
  sshPrivateKey?: string;

  @IsOptional()
  @IsString()
  sshKeyPassphrase?: string;

  // Only used with key authentication on hosts that need sudo (OVH) and
  // whose sudo asks for a password; without it sudo runs non-interactively.
  @IsOptional()
  @IsString()
  sudoPassword?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  controlPlaneWs?: string;
}
