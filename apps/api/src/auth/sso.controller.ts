import { Controller, Get, Logger, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Request, Response } from 'express';
import type { Client, TokenSet } from 'openid-client';
import { findInternalEmail } from '../mail/alert-recipients';
import { AUTH_COOKIE_MAX_AGE_MS, AUTH_COOKIE_NAME, authCookieOptions } from './auth-cookie';
import { AuthentikService } from './authentik.service';
import { AuthService } from './auth.service';
import { SessionValidityService } from './session-validity.service';

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
    private readonly sessionValidity: SessionValidityService,
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

      const internalEmail = await this.resolveInternalEmail(client, tokenSet, claims);

      const { user, alertAddressChanged } = await this.authService.findOrCreateSsoUser({
        sub: claims.sub,
        email,
        internalEmail,
        name: typeof claims.name === 'string' ? claims.name : null,
        avatarUrl: typeof claims.picture === 'string' ? claims.picture : null,
        isSuperuser: claims.is_superuser === true,
        canCreateWorkspaces: groups.includes(this.accessGroup()),
      });

      this.sessionValidity.forget(user.id);

      if (user.disabledAt) {
        this.logger.warn(`SSO login refused for ${email}: account disabled in Tarmac`);
        return res.redirect(this.loginRedirect({ sso: 'disabled' }));
      }

      await this.authService.syncWorkspaceMembershipsFromSso(user.id, groups);

      // The access group is what opens the application (platform admins
      // aside); which workspaces the user then sees depends only on their
      // memberships, and they may create a few of their own.
      if (!user.isSuperuser && !user.canCreateWorkspaces) {
        this.logger.warn(`SSO login refused for ${email}: not in access group "${this.accessGroup()}" (groups [${groups.join(', ')}])`);
        return res.redirect(this.loginRedirect({ sso: 'forbidden' }));
      }

      // Invitations sent to this address before the account existed.
      await this.authService.acceptPendingInvitations(user);

      if (alertAddressChanged) {
        this.authService.sendAlertAddressConfirmation(user);
      }

      const { access_token } = await this.authService.issueSession(user);
      res.cookie(AUTH_COOKIE_NAME, access_token, {
        ...authCookieOptions(),
        maxAge: AUTH_COOKIE_MAX_AGE_MS,
      });

      return silent
        ? res.redirect(this.loginRedirect({ sso: 'ready' }))
        : res.redirect(`${this.frontendUrl()}/workspaces`);
    } catch (error) {
      this.logger.warn(`Authentik SSO callback failed: ${error instanceof Error ? error.message : error}`);
      return res.redirect(this.loginRedirect({ sso: 'error', reason: 'callback_failed' }));
    }
  }

  // The internal (@intraced.fr) address is looked for in the ID token
  // first; userinfo is only asked when that comes up empty, since some
  // Authentik property mappings are configured not to go into the ID token.
  // Any failure there just means "no internal address", never a failed login.
  private async resolveInternalEmail(
    client: Client,
    tokenSet: TokenSet,
    claims: Record<string, unknown>,
  ): Promise<string | null> {
    const fromIdToken = findInternalEmail(claims);
    if (fromIdToken || !tokenSet.access_token) return fromIdToken;
    try {
      const userinfo = await client.userinfo(tokenSet.access_token);
      const fromUserinfo = findInternalEmail(userinfo as Record<string, unknown>);
      if (!fromUserinfo) {
        // Claim names only, never values: enough to tell "the Authentik
        // scope mapping doesn't send intranet_mail" apart from "it sends it
        // under another name or with has_intranet_mail=false".
        this.logger.log(
          `No internal email in SSO claims for ${claims.sub} - id_token keys: [${Object.keys(claims).join(', ')}], ` +
            `userinfo keys: [${Object.keys(userinfo).join(', ')}], has_intranet_mail=${String(userinfo.has_intranet_mail ?? claims.has_intranet_mail)}`,
        );
      }
      return fromUserinfo;
    } catch (error) {
      this.logger.debug(`Authentik userinfo lookup failed: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  private async startAuthorization(res: Response, silent: boolean) {
    if (!this.authentik.isConfigured) {
      return res.redirect(this.loginRedirect({ sso: 'error', reason: 'not_configured' }));
    }

    try {
      const client = await this.authentik.getClient();
      const redirectUri = this.configService.getOrThrow<string>('AUTHENTIK_REDIRECT_URI');
      const scope = this.configService.get<string>('AUTHENTIK_SCOPES', 'openid profile email tarmac');

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

  private accessGroup() {
    return this.configService.get<string>('AUTHENTIK_ACCESS_GROUP', 'tarmac');
  }

  private loginRedirect(params: Record<string, string>) {
    const search = new URLSearchParams(params).toString();
    return `${this.frontendUrl()}/login?${search}`;
  }

  private frontendUrl() {
    return this.configService.get<string>('FRONTEND_URL', 'https://tarmac.casterot.com').replace(/\/$/, '');
  }
}
