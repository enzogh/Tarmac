import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { IncomingMessage } from 'http';
import { parse } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_WORKSPACE_ID } from '../workspaces/default-workspace';
import { AgentTokenService } from './agent-token.service';
import { AgentsService } from './agents.service';
import {
  AgentLogPayload,
  CommandProgressPayload,
  CommandResultPayload,
  HeartbeatPayload,
  StateReportPayload,
} from './agents.types';

// One panel alert per node and message type per window: a malformed payload
// usually repeats on every report cycle (20s), and the log keeps the rest.
const INVALID_PAYLOAD_ALERT_COOLDOWN_MS = 30 * 60_000;

interface AgentWsMessage {
  type: string;
  payload?: unknown;
}

@Injectable()
export class AgentsWsServer implements OnModuleInit {
  private wss!: WebSocketServer;
  private readonly logger = new Logger(AgentsWsServer.name);
  private readonly invalidPayloadAlertAt = new Map<string, number>();

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly agentsService: AgentsService,
    private readonly agentTokenService: AgentTokenService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    const server = this.adapterHost.httpAdapter.getHttpServer();
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req: IncomingMessage, socket: any, head: Buffer) => {
      const { pathname, query } = parse(req.url || '', true);
      if (pathname !== '/agents-ws') return;

      const nodeId = String(query.nodeId ?? '');
      const token = String(query.token ?? '');

      void (async () => {
        if (!nodeId || !(await this.agentTokenService.verify(nodeId, token))) {
          socket.destroy();
          return;
        }

        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.attachClient(ws, nodeId);
        });
      })();
    });
  }

  private attachClient(ws: WebSocket, nodeId: string) {
    this.agentsService.register(nodeId, (_event, payload) => {
      const message: AgentWsMessage = {
        type: 'command',
        payload,
      };
      ws.send(JSON.stringify(message));
    });

    void this.agentTokenService.resendPendingRotationIfNeeded(nodeId);

    ws.on('message', async (raw) => {
      let msgType = 'unparsed';
      try {
        const msg = JSON.parse(raw.toString()) as AgentWsMessage;
        msgType = String(msg.type);
        // Every handler below is passed the handshake-verified `nodeId`
        // (never anything from msg.payload) - see AgentsService.onHeartbeat
        // et al. for why trusting a payload-supplied nodeId would let a
        // compromised agent write data under any other node/workspace.
        if (msg.type === 'agent.heartbeat' && msg.payload) {
          await this.agentsService.onHeartbeat(nodeId, msg.payload as HeartbeatPayload);
        }

        if (msg.type === 'agent.state_report' && msg.payload) {
          await this.agentsService.onStateReport(nodeId, msg.payload as StateReportPayload);
        }

        if (msg.type === 'command_result' && msg.payload) {
          await this.agentsService.onCommandResult(nodeId, msg.payload as CommandResultPayload);
        }

        if (msg.type === 'command_progress' && msg.payload) {
          await this.agentsService.onCommandProgress(nodeId, msg.payload as CommandProgressPayload);
        }

        if (msg.type === 'agent.log' && msg.payload) {
          await this.agentsService.onAgentLog(nodeId, msg.payload as AgentLogPayload);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown parse error';
        this.logger.warn(`Invalid agent WS payload (${msgType}) for node ${nodeId}: ${message}`);
        const cooldownKey = `${nodeId}:${msgType}`;
        if (Date.now() - (this.invalidPayloadAlertAt.get(cooldownKey) ?? 0) < INVALID_PAYLOAD_ALERT_COOLDOWN_MS) return;
        this.invalidPayloadAlertAt.set(cooldownKey, Date.now());
        await this.prisma.alert.create({
          data: {
            workspaceId: DEFAULT_WORKSPACE_ID,
            nodeId,
            severity: 'medium',
            message: `Invalid agent WS payload (${msgType}) for node ${nodeId}: ${message}`,
          },
        });
      }
    });

    ws.on('close', () => {
      this.agentsService.unregister(nodeId);
    });
  }
}
