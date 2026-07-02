import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import type { User } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    const shouldBootstrap = this.configService.get<string>('ENABLE_DEFAULT_ADMIN', 'true') !== 'false';

    if (!shouldBootstrap) {
      return;
    }

    try {
      const email = this.getDefaultAdminEmail();
      await this.ensureDefaultAdmin();
      this.logger.log(`Default admin ensured: ${email}`);
    } catch (error) {
      this.logger.warn(`Failed to ensure default admin: ${error instanceof Error ? error.message : error}`);
    }
  }

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();

    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user && this.shouldBootstrapDefaultAdmin() && email === this.getDefaultAdminEmail()) {
      await this.ensureDefaultAdmin();
      user = await this.prisma.user.findUnique({ where: { email } });
    }

    if (!user) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    const passwordOk = await this.verifyPassword(dto.password, user);
    if (!passwordOk) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    const access_token = await this.jwtService.signAsync({
      sub: user.id,
      email: user.email,
    });

    return { access_token };
  }

  private shouldBootstrapDefaultAdmin() {
    return this.configService.get<string>('ENABLE_DEFAULT_ADMIN', 'true') !== 'false';
  }

  private getDefaultAdminEmail() {
    const email = this.configService.get<string>('ADMIN_EMAIL', 'admin@tarmac.local');
    return email.trim().toLowerCase();
  }

  private getDefaultAdminPassword() {
    return this.configService.get<string>('ADMIN_PASSWORD', 'admin123');
  }

  private async ensureDefaultAdmin() {
    const email = this.getDefaultAdminEmail();
    const plainPassword = this.getDefaultAdminPassword();
    const passwordHash = await bcrypt.hash(plainPassword, 10);
    await this.prisma.user.upsert({
      where: { email },
      update: { passwordHash },
      create: { email, passwordHash },
    });
  }

  private async verifyPassword(plainPassword: string, user: User) {
    try {
      return await bcrypt.compare(plainPassword, user.passwordHash);
    } catch (error) {
      if (user.passwordHash === plainPassword) {
        const passwordHash = await bcrypt.hash(plainPassword, 10);
        await this.prisma.user.update({
          where: { id: user.id },
          data: { passwordHash },
        });
        this.logger.warn(`Recovered legacy plaintext password hash for user ${user.email}`);
        return true;
      }

      this.logger.warn(
        `Invalid password hash for user ${user.email}: ${error instanceof Error ? error.message : error}`,
      );
      return false;
    }
  }
}
