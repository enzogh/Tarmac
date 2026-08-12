import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { IncomingMessage } from 'http';
import { Socket } from 'net';
import { parse } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import { AuthService } from '../auth/auth.service';
import { AUTH_COOKIE_NAME } from '../auth/auth-cookie';
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

// Browser-facing counterpart to AgentsWsServer: same "raw ws on the shared
// HTTP server's upgrade event" pattern, but authenticated with the admin's
// session cookie instead of an agent token, and used to push live updates
// (new audit-log entries, new agent-log lines, node heartbeats) instead of
// receiving agent telemetry.
@Injectable()
export class LiveWsServer implements OnModuleInit {
  private wss!: WebSocketServer;
  private readonly logger = new Logger(LiveWsServer.name);
  // Each connected browser is scoped to the single workspace it opened the
  // socket for (?workspaceId=... at connect time, same idea as the
  // X-Workspace-Id header on every REST call - see workspace.guard.ts).
  // broadcast() only delivers to clients currently watching the matching
  // workspace. Without this, any event pushed here goes out to literally
  // every connected browser regardless of which workspace they're looking
  // at - that was the case here until this fix (audit.new/agent-log.new
  // were broadcast completely unscoped, a real cross-tenant data leak).
  private readonly clients = new Map<WebSocket, string>();

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    const server = this.adapterHost.httpAdapter.getHttpServer();
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
      const { pathname, query } = parse(req.url || '', true);
      if (pathname !== '/live-ws') return;

      const token = extractCookie(req.headers.cookie, AUTH_COOKIE_NAME);
      const session = token ? this.authService.verifyToken(token) : null;
      const workspaceId = typeof query.workspaceId === 'string' ? query.workspaceId : '';
      if (!session || !workspaceId) {
        socket.destroy();
        return;
      }

      void (async () => {
        if (!(await this.canAccessWorkspace(session.userId, workspaceId))) {
          socket.destroy();
          return;
        }

        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.clients.set(ws, workspaceId);
          ws.on('close', () => this.clients.delete(ws));
          ws.on('error', () => this.clients.delete(ws));
        });
      })();
    });
  }

  // Mirrors WorkspaceGuard's authorization (see auth/workspace.guard.ts):
  // platform admins can watch any workspace, everyone else only one they
  // hold a membership in.
  private async canAccessWorkspace(userId: string, workspaceId: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { isSuperuser: true } });
    if (!user) return false;
    if (user.isSuperuser) return true;
    const membership = await this.prisma.workspaceMembership.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    return !!membership;
  }

  broadcast(type: string, payload: unknown, workspaceId: string) {
    if (this.clients.size === 0) return;
    const message = JSON.stringify({ type, payload });
    for (const [client, clientWorkspaceId] of this.clients) {
      if (clientWorkspaceId === workspaceId && client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }
}
