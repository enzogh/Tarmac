import { ArrayMinSize, ArrayMaxSize, IsArray, IsString } from 'class-validator';

export class BulkDeleteAlertsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @IsString({ each: true })
  ids!: string[];
}
