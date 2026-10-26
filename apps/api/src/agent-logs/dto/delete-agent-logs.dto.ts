import { IsDateString, IsOptional, IsString } from 'class-validator';

// Agent log lines matching the journal's filters; no `from` means the whole
// retained history.
export class DeleteAgentLogsDto {
  @IsOptional()
  @IsString()
  nodeId?: string;

  @IsOptional()
  @IsString()
  level?: string;

  @IsOptional()
  @IsDateString()
  from?: string;
}
