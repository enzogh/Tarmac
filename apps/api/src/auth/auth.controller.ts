import { Body, Controller, Get, HttpCode, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AUTH_COOKIE_MAX_AGE_MS, AUTH_COOKIE_NAME, authCookieOptions } from './auth-cookie';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SessionValidityService } from './session-validity.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly sessionValidity: SessionValidityService,
  ) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const { access_token } = await this.authService.login(dto);
    res.cookie(AUTH_COOKIE_NAME, access_token, {
      ...authCookieOptions(),
      maxAge: AUTH_COOKIE_MAX_AGE_MS,
    });
    return { success: true };
  }

  // Clearing the cookie alone would leave the token itself valid until it
  // expires (12 h): its id is recorded so the API refuses it from now on.
  @HttpCode(200)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[AUTH_COOKIE_NAME] as string | undefined;
    const session = token ? this.authService.verifyToken(token) : null;
    if (session?.jti && session.expiresAt) {
      await this.sessionValidity.revoke(session.jti, session.userId, new Date(session.expiresAt * 1000));
    }
    res.clearCookie(AUTH_COOKIE_NAME, authCookieOptions());
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  profile(@Req() req: { user?: { userId?: string } }) {
    return this.authService.getProfile(req.user?.userId);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('profile')
  updateProfile(
    @Req() req: { user?: { userId?: string } },
    @Body() dto: UpdateProfileDto,
  ) {
    return this.authService.updateProfile(req.user?.userId, dto);
  }

  // Sends to the caller's own alert address only, hence the tight throttle
  // rather than any target parameter.
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @Post('profile/test-email')
  sendTestEmail(@Req() req: { user?: { userId?: string } }) {
    return this.authService.sendTestEmail(req.user?.userId);
  }
}
