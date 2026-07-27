import { ConfigService } from '@nestjs/config';

// Rotating JWT_SECRET would otherwise invalidate every logged-in session
// instantly. During a rotation window (JWT_SECRET_PREVIOUS set), tokens
// signed with either secret verify - new logins always get the current one.
// Shared by the passport strategy (HTTP requests) and any consumer that
// needs to verify a token outside of passport (e.g. a raw WebSocket
// upgrade), so the rotation window behaves identically everywhere.
export function getCandidateJwtSecrets(configService: ConfigService): string[] {
  const currentSecret = configService.get<string>('JWT_SECRET');
  if (!currentSecret) {
    throw new Error('JWT_SECRET must be set (refusing to start with an insecure default)');
  }
  const previousSecret = configService.get<string>('JWT_SECRET_PREVIOUS');
  return [currentSecret, ...(previousSecret ? [previousSecret] : [])];
}
