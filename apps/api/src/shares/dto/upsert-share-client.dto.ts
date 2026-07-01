import { IsIn, IsString, MinLength } from 'class-validator';

export class UpsertShareClientDto {
  @IsString()
  @MinLength(1)
  clientId!: string;

  @IsString()
  @IsIn(['ro', 'rw', 'deny'])
  access!: 'ro' | 'rw' | 'deny';
}
