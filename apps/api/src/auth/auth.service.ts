import { Injectable, Logger, OnModuleInit, UnauthorizedException } from '@nestjs/common';
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
    let user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user && this.shouldBootstrapDefaultAdmin() && dto.email === this.getDefaultAdminEmail()) {
      await this.ensureDefaultAdmin();
      user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    }

    if (!user) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
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
    return this.configService.get<string>('ADMIN_EMAIL', 'admin@tarmac.local');
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
}
