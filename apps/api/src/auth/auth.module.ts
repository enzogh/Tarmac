import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthentikService } from './authentik.service';
import { JwtStrategy } from './jwt.strategy';
import { SsoController } from './sso.controller';

@Module({
  imports: [
    ConfigModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');
        if (!secret) {
          throw new Error('JWT_SECRET must be set (refusing to start with an insecure default)');
        }
        return {
          secret,
          signOptions: { expiresIn: '12h' },
        };
      },
    }),
  ],
  controllers: [AuthController, SsoController],
  providers: [AuthService, AuthentikService, JwtStrategy],
  exports: [JwtModule, AuthService],
})
export class AuthModule {}
