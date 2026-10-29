import { Injectable, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { IncomingMessage } from 'http';
import { Socket } from 'net';
import { parse } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import { scopeGrants, type ApiKeyResource } from '../api-keys/api-key-token';
import { AuthService } from '../auth/auth.service';
import { AUTH_COOKIE_NAME } from '../auth/auth-cookie';
import { SessionValidityService } from '../auth/session-validity.service';
import { allowedOrigins } from '../common/allowed-origins';
import { PrismaService } from '../prisma/prisma.service';

function extractCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

// The permission area each live event belongs to, so a member only receives
// what the matching REST endpoints would show them (journal entries and agent
// logs need "logs", firewall events need "firewall", ...).
function eventArea(type: string): ApiKeyResource {
  if (type === 'audit.new' || type === 'agent-log.new') return 'logs';
  if (type.startsWith('firewall.')) return 'firewall';
  if (type.startsWith('vpn.')) return 'vpn';
  if (type.startsWith('dns.')) return 'dns';
  return 'nodes';
}

interface LiveClient {
  workspaceId: string;
  userId: string;
  issuedAt?: number;
  jti?: string;
  // Undefined means unrestricted (platform admin, workspace owner).
  permissions?: string[];
}

// Browser-facing counterpart to AgentsWsServer: same "raw ws on the shared
// HTTP server's upgrade event" pattern, but authenticated with the admin's
// session cookie instead of an agent token, and used to push live updates
// (new audit-log entries, new agent-log lines, node heartbeats) instead of
// receiving agent telemetry.
//
// Each socket is scoped to the single workspace it was opened for
// (?workspaceId=...), and broadcast() only delivers to sockets of that
// workspace whose member may see the event's area.
@Injectable()
export class LiveWsServer implements OnModuleInit {
  private wss!: WebSocketServer;
  private readonly clients = new Map<WebSocket, LiveClient>();

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
    private readonly sessionValidity: SessionValidityService,
  ) {}

  onModuleInit() {
    const server = this.adapterHost.httpAdapter.getHttpServer();
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 });
    const origins = new Set(allowedOrigins());

    server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
      const { pathname, query } = parse(req.url || '', true);
      if (pathname !== '/live-ws') return;

      // Browsers always send Origin on a WebSocket handshake and attach the
      // session cookie whatever page opens it: without this check any other
      // site visited by a signed-in user could listen in.
      const origin = req.headers.origin;
      if (origin && !origins.has(origin)) {
        socket.destroy();
        return;
      }

      const token = extractCookie(req.headers.cookie, AUTH_COOKIE_NAME);
      const session = token ? this.authService.verifyToken(token) : null;
      const workspaceId = typeof query.workspaceId === 'string' ? query.workspaceId : '';
      if (!session || !workspaceId) {
        socket.destroy();
        return;
      }

      void (async () => {
        const access =
          (await this.sessionValidity.check(session.userId, session.issuedAt, session.jti)) === 'ok'
            ? await this.workspaceAccess(session.userId, workspaceId)
            : null;
        if (!access) {
          socket.destroy();
          return;
        }

        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.clients.set(ws, { workspaceId, userId: session.userId, issuedAt: session.issuedAt, jti: session.jti, permissions: access.permissions });
          const drop = () => this.clients.delete(ws);
          ws.on('close', drop);
          ws.on('error', drop);
        });
      })();
    });

    setInterval(() => void this.sweep(), 30_000).unref();
  }

  // A session revoked after the handshake (account disabled, access group
  // lost), a removed membership or a changed role takes effect within 30 s.
  private async sweep() {
    for (const [ws, client] of this.clients) {
      try {
        const status = await this.sessionValidity.check(client.userId, client.issuedAt, client.jti);
        const access = status === 'ok' ? await this.workspaceAccess(client.userId, client.workspaceId) : null;
        if (!access) {
          ws.close(4401, 'access revoked');
          continue;
        }
        client.permissions = access.permissions;
      } catch {
        // Keep the socket on a transient database error.
      }
    }
  }

  // Mirrors WorkspaceGuard: platform admins can watch any workspace,
  // everyone else only one they hold a membership in, with its permissions.
  private async workspaceAccess(userId: string, workspaceId: string): Promise<{ permissions?: string[] } | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { isSuperuser: true } });
    if (!user) return null;
    if (user.isSuperuser) {
      const exists = await this.prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
      return exists ? { permissions: undefined } : null;
    }
    const membership = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
      select: { role: true, permissions: true },
    });
    if (!membership) return null;
    return { permissions: membership.role === 'owner' ? undefined : membership.permissions };
  }

  broadcast(type: string, payload: unknown, workspaceId: string) {
    if (this.clients.size === 0) return;
    const required = `${eventArea(type)}:read` as const;
    let message: string | null = null;
    for (const [ws, client] of this.clients) {
      if (client.workspaceId !== workspaceId || ws.readyState !== WebSocket.OPEN) continue;
      if (client.permissions && !scopeGrants(client.permissions, required)) continue;
      message ??= JSON.stringify({ type, payload });
      ws.send(message);
    }
  }
}
