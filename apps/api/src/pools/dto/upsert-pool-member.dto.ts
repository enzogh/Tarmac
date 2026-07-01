import { IsIn, IsString, MinLength } from 'class-validator';

export class UpsertPoolMemberDto {
  @IsString()
  @MinLength(1)
  nodeId!: string;

  @IsString()
  @IsIn(['primary', 'replica'])
  role!: 'primary' | 'replica';

  @IsString()
  @IsIn(['pending', 'active', 'error'])
  status!: 'pending' | 'active' | 'error';
}
