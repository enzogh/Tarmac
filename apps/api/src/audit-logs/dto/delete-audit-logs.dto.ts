import { ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsOptional, IsString } from 'class-validator';

// Either explicit entries (`ids`), or everything matching the journal's
// filters - the same ones the list takes, so "what I see" is what goes.
export class DeleteAuditLogsDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  ids?: string[];

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsString()
  actorUserId?: string;

  @IsOptional()
  @IsString()
  resourceType?: string;

  @IsOptional()
  @IsString()
  q?: string;
}
