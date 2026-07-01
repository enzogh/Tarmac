import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateShareDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(1)
  path!: string;

  @IsOptional()
  @IsString()
  nodeId?: string;
}
