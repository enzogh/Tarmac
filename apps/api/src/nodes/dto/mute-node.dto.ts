import { IsInt, Max, Min } from 'class-validator';

export class MuteNodeDto {
  @IsInt()
  @Min(1)
  @Max(60 * 24 * 30)
  minutes!: number;
}
