import { IsOptional, IsString } from 'class-validator';

export class ListRemoteDirectoriesDto {
  @IsString()
  nodeId!: string;

  @IsString()
  host!: string;

  @IsString()
  username!: string;

  @IsOptional()
  @IsString()
  password?: string;

  @IsOptional()
  @IsString()
  basePath?: string;

  @IsOptional()
  @IsString()
  port?: string;
}
