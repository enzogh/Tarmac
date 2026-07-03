import { IsIn, IsIP, IsOptional, IsString, MinLength } from 'class-validator';

export class StartNodeOnboardingDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @IsIn(['controller', 'worker'])
  role!: string;

  @IsString()
  @IsIn(['ovh', 'standard'])
  provider!: 'ovh' | 'standard';

  @IsIP()
  hostIp!: string;

  @IsString()
  @MinLength(1)
  sshUsername!: string;

  @IsString()
  @MinLength(1)
  sshPassword!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  repoUrl?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  repoRef?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  controlPlaneWs?: string;
}
