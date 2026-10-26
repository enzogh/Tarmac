import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AUTH_COOKIE_NAME } from './auth-cookie';
import { getCandidateJwtSecrets } from './jwt-secrets';
import { SessionValidityService } from './session-validity.service';

function cookieExtractor(req: Request): string | null {
  return req?.cookies?.[AUTH_COOKIE_NAME] ?? null;
}

interface JwtPayload {
  sub: string;
  email: string;
  iat?: number;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly sessionValidity: SessionValidityService,
  ) {
    const candidateSecrets = getCandidateJwtSecrets(configService);

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor, ExtractJwt.fromAuthHeaderAsBearerToken()]),
      ignoreExpiration: false,
      secretOrKeyProvider: (_request: unknown, rawJwtToken: string, done: (err: Error | null, secret?: string) => void) => {
        for (const secret of candidateSecrets) {
          try {
            jwt.verify(rawJwtToken, secret);
            return done(null, secret);
          } catch {
            continue;
          }
        }
        done(new Error('invalid token signature'));
      },
    });
  }

  // A valid signature isn't enough: a disabled account, or one that left the
  // Authentik access group, loses its open sessions too (see
  // SessionValidityService and AuthentikAccessSyncService).
  async validate(payload: JwtPayload) {
    const status = await this.sessionValidity.check(payload.sub, payload.iat);
    if (status !== 'ok') {
      throw new UnauthorizedException(
        status === 'disabled' ? 'Ce compte a été désactivé.' : status === 'revoked' ? 'Votre accès à Tarmac a été retiré.' : 'Session invalide',
      );
    }
    return { userId: payload.sub, email: payload.email };
  }
}
