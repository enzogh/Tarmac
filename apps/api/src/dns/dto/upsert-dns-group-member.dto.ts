import { IsIn, IsString, MinLength } from 'class-validator';

export class UpsertDnsGroupMemberDto {
  @IsString()
  @MinLength(1)
  nodeId!: string;

  @IsString()
  @IsIn(['primary', 'secondary'])
  role!: 'primary' | 'secondary';

  @IsString()
  @IsIn(['pending', 'active', 'error'])
  status!: 'pending' | 'active' | 'error';
}
