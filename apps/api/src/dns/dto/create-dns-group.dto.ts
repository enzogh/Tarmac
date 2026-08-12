import { IsString, MinLength } from 'class-validator';

export class CreateDnsGroupDto {
  @IsString()
  @MinLength(2)
  name!: string;
}
