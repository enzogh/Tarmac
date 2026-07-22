import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AUTH_COOKIE_NAME } from './auth.controller';

function cookieExtractor(req: Request): string | null {
  return req?.cookies?.[AUTH_COOKIE_NAME] ?? null;
}

interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(configService: ConfigService) {
    const currentSecret = configService.get<string>('JWT_SECRET');
    if (!currentSecret) {
      throw new Error('JWT_SECRET must be set (refusing to start with an insecure default)');
    }
    const previousSecret = configService.get<string>('JWT_SECRET_PREVIOUS');
    const candidateSecrets = [currentSecret, ...(previousSecret ? [previousSecret] : [])];

    super({
      jwtFromRequest: ExtractJwt.fromExtractors([cookieExtractor, ExtractJwt.fromAuthHeaderAsBearerToken()]),
      ignoreExpiration: false,
      // Rotating JWT_SECRET would otherwise invalidate every logged-in session
      // instantly. During a rotation window (JWT_SECRET_PREVIOUS set), tokens
      // signed with either secret verify - new logins always get the current one.
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

  validate(payload: JwtPayload) {
    return { userId: payload.sub, email: payload.email };
  }
}
