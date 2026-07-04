import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { User } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

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
      const ensured = await this.ensureDefaultAdmin();
      if (ensured) {
        this.logger.log(`Default admin ensured: ${email}`);
      }
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

  async getProfile(userId?: string) {
    if (!userId) {
      throw new UnauthorizedException('Session invalide');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, createdAt: true, updatedAt: true },
    });
    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable');
    }

    return user;
  }

  async updateProfile(userId: string | undefined, dto: UpdateProfileDto) {
    if (!userId) {
      throw new UnauthorizedException('Session invalide');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Utilisateur introuvable');
    }

    const nextEmail = dto.email?.trim().toLowerCase();
    const wantsEmailChange = typeof nextEmail === 'string' && nextEmail.length > 0 && nextEmail !== user.email;
    const wantsPasswordChange = typeof dto.newPassword === 'string' && dto.newPassword.length > 0;

    if (!wantsEmailChange && !wantsPasswordChange) {
      throw new BadRequestException('Aucune modification détectée');
    }

    if (wantsPasswordChange) {
      if (!dto.currentPassword) {
        throw new BadRequestException('Le mot de passe actuel est requis');
      }
      const currentPasswordOk = await this.verifyPassword(dto.currentPassword, user);
      if (!currentPasswordOk) {
        throw new UnauthorizedException('Mot de passe actuel invalide');
      }
    }

    const data: { email?: string; passwordHash?: string } = {};
    if (wantsEmailChange && nextEmail) {
      data.email = nextEmail;
    }
    if (wantsPasswordChange && dto.newPassword) {
      data.passwordHash = await bcrypt.hash(dto.newPassword, 10);
    }

    try {
      const updated = await this.prisma.user.update({
        where: { id: user.id },
        data,
        select: { id: true, email: true, createdAt: true, updatedAt: true },
      });
      return updated;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('Cet email est déjà utilisé');
      }
      throw error;
    }
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
    const defaultAdmin = await this.prisma.user.findUnique({ where: { email } });
    if (defaultAdmin) {
      await this.prisma.user.update({
        where: { id: defaultAdmin.id },
        data: { passwordHash },
      });
      return true;
    }

    const usersCount = await this.prisma.user.count();
    if (usersCount > 0) {
      return false;
    }

    await this.prisma.user.create({
      data: { email, passwordHash },
    });
    return true;
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
