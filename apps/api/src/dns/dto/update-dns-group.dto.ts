import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateDnsGroupDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;
}
