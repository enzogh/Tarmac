import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { AgentTokenService } from './agent-token.service';
import { AgentsService } from './agents.service';
import { CommandProgressPayload, CommandResultPayload, HeartbeatPayload, StateReportPayload } from './agents.types';

@WebSocketGateway({ namespace: '/agents', cors: { origin: '*' } })
export class AgentsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly agentTokenService: AgentTokenService,
  ) {}

  async handleConnection(client: Socket) {
    const nodeId = String(client.handshake.query.nodeId ?? '');
    const token = String(client.handshake.query.token ?? '');
    if (!nodeId || !(await this.agentTokenService.verify(nodeId, token))) {
      client.disconnect();
      return;
    }

    client.data.nodeId = nodeId;
    this.agentsService.register(nodeId, (event, payload) => client.emit(event, payload));
    void this.agentTokenService.resendPendingRotationIfNeeded(nodeId);
  }

  handleDisconnect(client: Socket) {
    const nodeId = client.data.nodeId as string | undefined;
    if (nodeId) {
      this.agentsService.unregister(nodeId);
    }
  }

  // Every handler is passed client.data.nodeId (the handshake-verified
  // identity), never anything from the message payload itself - same reason
  // as AgentsWsServer (the actual transport the Go agent uses); this
  // socket.io gateway is kept in sync defensively even though it appears
  // unused in practice.
  @SubscribeMessage('agent.heartbeat')
  async onHeartbeat(@ConnectedSocket() client: Socket, @MessageBody() payload: HeartbeatPayload) {
    await this.agentsService.onHeartbeat(client.data.nodeId as string, payload);
  }

  @SubscribeMessage('agent.state_report')
  async onStateReport(@ConnectedSocket() client: Socket, @MessageBody() payload: StateReportPayload) {
    await this.agentsService.onStateReport(client.data.nodeId as string, payload);
  }

  @SubscribeMessage('command_result')
  async onCommandResult(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CommandResultPayload,
  ) {
    await this.agentsService.onCommandResult(client.data.nodeId as string, payload);
  }

  @SubscribeMessage('command_progress')
  async onCommandProgress(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: CommandProgressPayload,
  ) {
    await this.agentsService.onCommandProgress(client.data.nodeId as string, payload);
  }
}
