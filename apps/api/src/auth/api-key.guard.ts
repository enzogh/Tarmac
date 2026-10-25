import { ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { API_KEY_TOKEN_PREFIX, ApiKeyScope, apiKeySecretMatches, parseApiKeyToken } from '../api-keys/api-key-token';
import { PrismaService } from '../prisma/prisma.service';

export interface AuthenticatedApiKey {
  id: string;
  name: string;
  workspaceId: string;
  scopes: string[];
}

interface RequestWithApiKey extends Request {
  apiKey?: AuthenticatedApiKey;
}

const API_SCOPE_METADATA = 'tarmac:apiScope';

// Opens a handler to API keys holding `scope`. Handlers without it stay
// reachable with a user session only, even behind ApiKeyOrJwtGuard.
export const RequireApiScope = (scope: ApiKeyScope) => SetMetadata(API_SCOPE_METADATA, scope);

// lastUsedAt is informational - writing it on every call of a busy
// integration would be one UPDATE per request for no benefit.
const LAST_USED_WRITE_INTERVAL_MS = 60_000;

/**
 * Drop-in replacement for JwtAuthGuard on controllers that also accept
 * workspace API keys (`Authorization: Bearer tmk_...`). Anything that isn't
 * an API key falls through to the regular session/JWT check unchanged.
 * Pair with WorkspaceGuard, which turns request.apiKey into a scope bound to
 * the key's own workspace.
 */
@Injectable()
export class ApiKeyOrJwtGuard extends AuthGuard('jwt') {
  private readonly lastUsedWrittenAt = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithApiKey>();
    const header = request.headers.authorization ?? '';
    const bearer = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    if (!bearer.startsWith(API_KEY_TOKEN_PREFIX)) {
      return (await super.canActivate(context)) as boolean;
    }

    const parsed = parseApiKeyToken(bearer);
    if (!parsed) throw new UnauthorizedException('Malformed API key');

    const key = await this.prisma.apiKey.findUnique({ where: { prefix: parsed.prefix } });
    if (!key || !apiKeySecretMatches(parsed.secret, key.secretHash)) {
      throw new UnauthorizedException('Invalid API key');
    }
    if (key.revokedAt) throw new UnauthorizedException('This API key has been revoked');
    if (key.expiresAt && key.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('This API key has expired');
    }

    const requiredScope = this.reflector.getAllAndOverride<ApiKeyScope | undefined>(API_SCOPE_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredScope) {
      throw new ForbiddenException('This endpoint is not available to API keys');
    }
    if (!key.scopes.includes(requiredScope)) {
      throw new ForbiddenException(`This API key lacks the "${requiredScope}" scope`);
    }

    const last = this.lastUsedWrittenAt.get(key.id) ?? 0;
    if (Date.now() - last >= LAST_USED_WRITE_INTERVAL_MS) {
      this.lastUsedWrittenAt.set(key.id, Date.now());
      await this.prisma.apiKey.update({
        where: { id: key.id },
        data: { lastUsedAt: new Date(), lastUsedIp: request.ip ?? null },
      });
    }

    request.apiKey = { id: key.id, name: key.name, workspaceId: key.workspaceId, scopes: key.scopes };
    return true;
  }
}
