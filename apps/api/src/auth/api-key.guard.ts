import { ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import {
  API_KEY_TOKEN_PREFIX,
  ApiKeyResource as ApiKeyResourceName,
  ApiKeyScope,
  apiKeySecretMatches,
  parseApiKeyToken,
  scopeGrants,
} from '../api-keys/api-key-token';
import { requestContext } from '../common/request-context';
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
const API_RESOURCE_METADATA = 'tarmac:apiResource';
const SESSION_ONLY_METADATA = 'tarmac:sessionOnly';

// Opens a handler to API keys holding `scope`, overriding the one derived
// from @ApiKeyResource (e.g. a POST that only reads).
export const RequireApiScope = (scope: ApiKeyScope) => SetMetadata(API_SCOPE_METADATA, scope);

// Opens a whole controller to API keys: GET/HEAD need `<resource>:read`,
// every other method `<resource>:write`. Controllers without it (and without
// a @RequireApiScope handler) stay reachable with a user session only, even
// behind ApiKeyOrJwtGuard.
export const ApiKeyResource = (resource: ApiKeyResourceName) => SetMetadata(API_RESOURCE_METADATA, resource);

// Keeps one handler of an @ApiKeyResource controller session-only.
export const SessionOnly = () => SetMetadata(SESSION_ONLY_METADATA, true);

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

    const requiredScope = this.requiredScope(context, request.method);
    if (!requiredScope) {
      throw new ForbiddenException('This endpoint is not available to API keys');
    }
    if (!scopeGrants(key.scopes, requiredScope)) {
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
    // Lets the audit log attribute what this request changes to the key.
    const store = requestContext.get();
    if (store) store.apiKey = { id: key.id, name: key.name };
    return true;
  }

  private requiredScope(context: ExecutionContext, method: string): ApiKeyScope | undefined {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(SESSION_ONLY_METADATA, targets)) return undefined;
    const explicit = this.reflector.getAllAndOverride<ApiKeyScope | undefined>(API_SCOPE_METADATA, targets);
    if (explicit) return explicit;
    const resource = this.reflector.getAllAndOverride<ApiKeyResourceName | undefined>(API_RESOURCE_METADATA, targets);
    if (!resource) return undefined;
    const reads = method === 'GET' || method === 'HEAD';
    return `${resource}:${reads ? 'read' : 'write'}`;
  }
}
