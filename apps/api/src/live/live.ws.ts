import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { IncomingMessage } from 'http';
import { Socket } from 'net';
import { parse } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import { AuthService } from '../auth/auth.service';
import { AUTH_COOKIE_NAME } from '../auth/auth.controller';

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
// (new audit-log entries, new agent-log lines) instead of receiving agent
// telemetry.
@Injectable()
export class LiveWsServer implements OnModuleInit {
  private wss!: WebSocketServer;
  private readonly logger = new Logger(LiveWsServer.name);
  private readonly clients = new Set<WebSocket>();

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly authService: AuthService,
  ) {}

  onModuleInit() {
    const server = this.adapterHost.httpAdapter.getHttpServer();
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
      const { pathname } = parse(req.url || '', true);
      if (pathname !== '/live-ws') return;

      const token = extractCookie(req.headers.cookie, AUTH_COOKIE_NAME);
      const session = token ? this.authService.verifyToken(token) : null;
      if (!session) {
        socket.destroy();
        return;
      }

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        this.clients.add(ws);
        ws.on('close', () => this.clients.delete(ws));
        ws.on('error', () => this.clients.delete(ws));
      });
    });
  }

  broadcast(type: string, payload: unknown) {
    if (this.clients.size === 0) return;
    const message = JSON.stringify({ type, payload });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }
}
