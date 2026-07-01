import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { AgentsService } from './agents.service';
import { CommandResultPayload, HeartbeatPayload, StateReportPayload } from './agents.types';

@WebSocketGateway({ namespace: '/agents', cors: { origin: '*' } })
export class AgentsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  constructor(private readonly agentsService: AgentsService) {}

  handleConnection(client: Socket) {
    const nodeId = String(client.handshake.query.nodeId ?? '');
    const token = String(client.handshake.query.token ?? '');
    if (!nodeId || token !== (process.env.AGENT_SHARED_TOKEN ?? 'agent-secret')) {
      client.disconnect();
      return;
    }

    client.data.nodeId = nodeId;
    this.agentsService.register(nodeId, (event, payload) => client.emit(event, payload));
  }

  handleDisconnect(client: Socket) {
    const nodeId = client.data.nodeId as string | undefined;
    if (nodeId) {
      this.agentsService.unregister(nodeId);
    }
  }

  @SubscribeMessage('agent.heartbeat')
  async onHeartbeat(@MessageBody() payload: HeartbeatPayload) {
    await this.agentsService.onHeartbeat(payload);
  }

  @SubscribeMessage('agent.state_report')
  async onStateReport(@MessageBody() payload: StateReportPayload) {
    await this.agentsService.onStateReport(payload);
  }

  @SubscribeMessage('command_result')
  async onCommandResult(
    @ConnectedSocket() _client: Socket,
    @MessageBody() payload: CommandResultPayload,
  ) {
    await this.agentsService.onCommandResult(payload);
  }
}
