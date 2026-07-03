import { IsBoolean } from 'class-validator';

export class CompleteNodeOnboardingDto {
  @IsBoolean()
  deployKeyConfirmed!: boolean;
}
