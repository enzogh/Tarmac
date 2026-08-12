import { Controller, Get, Logger, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import { AUTH_COOKIE_MAX_AGE_MS, AUTH_COOKIE_NAME, authCookieOptions } from './auth-cookie';
import { AuthentikService } from './authentik.service';
import { AuthService } from './auth.service';

const SSO_STATE_COOKIE = 'tarmac_sso_state';
const SSO_STATE_TTL = '5m';
const SSO_STATE_MAX_AGE_MS = 5 * 60 * 1000;
const SILENT_AUTH_ERRORS = new Set(['login_required', 'interaction_required', 'consent_required']);

interface SsoStatePayload {
  typ: 'sso_state';
  state: string;
  nonce: string;
  codeVerifier: string;
  silent: boolean;
}

// Handles the Authentik OIDC flow. Two entry points share one callback:
//  - /login   forces an interactive Authentik sign-in (prompt unset).
//  - /silent  asks Authentik for a session with prompt=none, used by the
//             frontend on page load as a "whoami" check with no visible UI.
// State/nonce/PKCE verifier travel in a short-lived signed cookie rather
// than server-side storage, matching the rest of this API's stateless
// cookie-based session model.
@Controller('auth/sso')
export class SsoController {
  private readonly logger = new Logger(SsoController.name);

  constructor(
    private readonly authentik: AuthentikService,
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  @Get('login')
  async login(@Res() res: Response) {
    return this.startAuthorization(res, false);
  }

  @Get('silent')
  async silent(@Res() res: Response) {
    return this.startAuthorization(res, true);
  }

  @Get('callback')
  async callback(
    @Req() req: Request,
    @Query() query: Record<string, string | undefined>,
    @Res() res: Response,
  ) {
    const stateCookie = req.cookies?.[SSO_STATE_COOKIE] as string | undefined;
    res.clearCookie(SSO_STATE_COOKIE, authCookieOptions());

    let statePayload: SsoStatePayload | null = null;
    if (stateCookie) {
      try {
        const decoded = await this.jwtService.verifyAsync<SsoStatePayload>(stateCookie);
        statePayload = decoded.typ === 'sso_state' ? decoded : null;
      } catch {
        statePayload = null;
      }
    }

    if (!statePayload) {
      return res.redirect(this.loginRedirect({ sso: 'error', reason: 'state_missing' }));
    }
    const { silent } = statePayload;

    if (query.error) {
      if (silent && SILENT_AUTH_ERRORS.has(query.error)) {
        return res.redirect(this.loginRedirect({ sso: 'none' }));
      }
      this.logger.warn(`Authentik SSO error: ${query.error} - ${query.error_description ?? ''}`);
      return res.redirect(this.loginRedirect({ sso: 'error', reason: query.error }));
    }

    try {
      const client = await this.authentik.getClient();
      const redirectUri = this.configService.getOrThrow<string>('AUTHENTIK_REDIRECT_URI');
      const params = client.callbackParams(req);
      const tokenSet = await client.callback(redirectUri, params, {
        state: statePayload.state,
        nonce: statePayload.nonce,
        code_verifier: statePayload.codeVerifier,
      });

      const claims = tokenSet.claims();

      const email = typeof claims.email === 'string' ? claims.email : null;
      if (!email) {
        return res.redirect(this.loginRedirect({ sso: 'error', reason: 'no_email_claim' }));
      }

      // groups is read defensively (never thrown on) since a misconfigured
      // or absent claim must degrade to "no new workspace granted this
      // login", not an error - see AuthService.syncWorkspaceMembershipsFromSso.
      const groups = Array.isArray(claims.groups)
        ? claims.groups.filter((g): g is string => typeof g === 'string')
        : [];

      const user = await this.authService.findOrCreateSsoUser({
        sub: claims.sub,
        email,
        name: typeof claims.name === 'string' ? claims.name : null,
        avatarUrl: typeof claims.picture === 'string' ? claims.picture : null,
        isSuperuser: claims.is_superuser === true,
      });

      await this.authService.syncWorkspaceMembershipsFromSso(user.id, groups);

      // Preserves today's fail-closed behavior for genuinely unrecognized
      // identities while opening the door to legitimate workspace members
      // who aren't platform admins.
      if (!user.isSuperuser && !(await this.authService.hasAnyWorkspaceMembership(user.id))) {
        return res.redirect(this.loginRedirect({ sso: 'forbidden' }));
      }

      const { access_token } = await this.authService.issueSession(user);
      res.cookie(AUTH_COOKIE_NAME, access_token, {
        ...authCookieOptions(),
        maxAge: AUTH_COOKIE_MAX_AGE_MS,
      });

      return silent
        ? res.redirect(this.loginRedirect({ sso: 'ready' }))
        : res.redirect(`${this.frontendUrl()}/dashboard`);
    } catch (error) {
      this.logger.warn(`Authentik SSO callback failed: ${error instanceof Error ? error.message : error}`);
      return res.redirect(this.loginRedirect({ sso: 'error', reason: 'callback_failed' }));
    }
  }

  private async startAuthorization(res: Response, silent: boolean) {
    if (!this.authentik.isConfigured) {
      return res.redirect(this.loginRedirect({ sso: 'error', reason: 'not_configured' }));
    }

    try {
      const client = await this.authentik.getClient();
      const redirectUri = this.configService.getOrThrow<string>('AUTHENTIK_REDIRECT_URI');
      const scope = this.configService.get<string>('AUTHENTIK_SCOPES', 'openid profile email tarmac groups');

      const codeVerifier = this.authentik.generators.codeVerifier();
      const codeChallenge = this.authentik.generators.codeChallenge(codeVerifier);
      const nonce = this.authentik.generators.nonce();
      const state = this.authentik.generators.state();

      const statePayload: SsoStatePayload = { typ: 'sso_state', state, nonce, codeVerifier, silent };
      const stateToken = await this.jwtService.signAsync(statePayload, { expiresIn: SSO_STATE_TTL });

      res.cookie(SSO_STATE_COOKIE, stateToken, {
        ...authCookieOptions(),
        maxAge: SSO_STATE_MAX_AGE_MS,
      });

      const authorizationUrl = client.authorizationUrl({
        redirect_uri: redirectUri,
        scope,
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: silent ? 'none' : undefined,
      });

      return res.redirect(authorizationUrl);
    } catch (error) {
      this.logger.error(`Failed to start Authentik SSO flow: ${error instanceof Error ? error.message : error}`);
      return res.redirect(this.loginRedirect({ sso: 'error', reason: 'discovery_failed' }));
    }
  }

  private loginRedirect(params: Record<string, string>) {
    const search = new URLSearchParams(params).toString();
    return `${this.frontendUrl()}/login?${search}`;
  }

  private frontendUrl() {
    return this.configService.get<string>('FRONTEND_URL', 'https://tarmac.casterot.com').replace(/\/$/, '');
  }
}
