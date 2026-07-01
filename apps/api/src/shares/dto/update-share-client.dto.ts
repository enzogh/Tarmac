import { IsIn, IsString } from 'class-validator';

export class UpdateShareClientDto {
  @IsString()
  @IsIn(['ro', 'rw', 'deny'])
  access!: 'ro' | 'rw' | 'deny';
}
