import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID, generateKeyPairSync } from 'crypto';
import { Client, ConnectConfig } from 'ssh2';
import { CreateNodeDto } from './dto/create-node.dto';
import { StartNodeOnboardingDto } from './dto/start-node-onboarding.dto';
import { NodesService } from './nodes.service';

type OnboardingProvider = 'ovh' | 'standard';

type NodeOnboardingSession = {
  onboardingId: string;
  createdAt: Date;
  expiresAt: Date;
  nodeId: string;
  nodeName: string;
  role: string;
  provider: OnboardingProvider;
  hostIp: string;
  sshUsername: string;
  sshPassword: string;
  repoUrl: string;
  repoRef: string;
  controlPlaneWs: string;
  deployKeyPublic: string;
  deployKeyPrivate: string;
};

type RemoteCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

@Injectable()
export class NodeOnboardingService {
  private static readonly ONBOARDING_TTL_MS = 30 * 60 * 1000;
  private readonly sessions = new Map<string, NodeOnboardingSession>();

  constructor(
    private readonly nodesService: NodesService,
    private readonly configService: ConfigService,
  ) {}

  async startOnboarding(dto: StartNodeOnboardingDto, actorUserId?: string) {
    const controlPlaneWs = dto.controlPlaneWs?.trim() || this.configService.get<string>('AGENT_CONTROL_PLANE_WS');
    if (!controlPlaneWs) {
      throw new BadRequestException('controlPlaneWs manquant');
    }

    const createNodeDto: CreateNodeDto = {
      name: dto.name,
      role: dto.role,
    };
    const node = await this.nodesService.create(createNodeDto, actorUserId);

    const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const deployKeyPublic = this.toOpenSshPublicKey(publicKey);

    const onboardingId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + NodeOnboardingService.ONBOARDING_TTL_MS);
    const repoUrl = this.normalizeRepoUrl(dto.repoUrl);
    const repoRef = dto.repoRef?.trim() || 'main';
    this.sessions.set(onboardingId, {
      onboardingId,
      createdAt: now,
      expiresAt,
      nodeId: node.id,
      nodeName: node.name,
      role: node.role,
      provider: dto.provider,
      hostIp: dto.hostIp.trim(),
      sshUsername: dto.sshUsername.trim(),
      sshPassword: dto.sshPassword,
      repoUrl,
      repoRef,
      controlPlaneWs,
      deployKeyPublic,
      deployKeyPrivate: privateKey,
    });

    this.cleanupExpiredSessions();

    return {
      onboardingId,
      expiresAt: expiresAt.toISOString(),
      node,
      githubDeployKey: {
        title: `tarmac-${node.name}-${node.id.slice(0, 8)}`,
        publicKey: deployKeyPublic,
        repoUrl,
      },
    };
  }

  async completeOnboarding(onboardingId: string) {
    const session = this.sessions.get(onboardingId);
    if (!session) {
      throw new NotFoundException('Session onboarding introuvable');
    }
    if (session.expiresAt.getTime() < Date.now()) {
      this.sessions.delete(onboardingId);
      throw new BadRequestException('Session onboarding expirée, recommencez');
    }

    try {
      const result = await this.runRemoteInstall(session);
      this.sessions.delete(onboardingId);
      return {
        success: true,
        nodeId: session.nodeId,
        nodeName: session.nodeName,
        output: result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Échec installation';
      throw new InternalServerErrorException(message);
    }
  }

  private cleanupExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt.getTime() <= now) {
        this.sessions.delete(sessionId);
      }
    }
  }

  private normalizeRepoUrl(raw?: string) {
    const trimmed = raw?.trim();
    if (!trimmed) return 'git@github.com:enzogh/Tarmac.git';
    if (trimmed.startsWith('git@')) return trimmed;
    if (trimmed.startsWith('https://github.com/')) {
      return `git@github.com:${trimmed.replace('https://github.com/', '').replace(/\.git$/, '')}.git`;
    }
    return trimmed;
  }

  private toOpenSshPublicKey(spkiPem: string): string {
    const lines = spkiPem
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => !line.startsWith('-----') && line.length > 0);
    const derBase64 = lines.join('');
    const der = Buffer.from(derBase64, 'base64');
    // Extract raw ed25519 key from SPKI wrapper.
    const rawKey = der.subarray(der.length - 32);
    const type = Buffer.from('ssh-ed25519');
    const keyBody = Buffer.concat([
      this.packSshBuffer(type),
      this.packSshBuffer(rawKey),
    ]).toString('base64');
    return `ssh-ed25519 ${keyBody}`;
  }

  private packSshBuffer(content: Buffer): Buffer {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(content.length, 0);
    return Buffer.concat([length, content]);
  }

  private shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`;
  }

  private buildRemoteCommand(session: NodeOnboardingSession, script: string): string {
    if (session.provider !== 'ovh') {
      return `bash -lc ${this.shellQuote(script)}`;
    }
    const escapedPassword = this.shellQuote(session.sshPassword);
    return `printf '%s\\n' ${escapedPassword} | sudo -S -p '' bash -lc ${this.shellQuote(script)}`;
  }

  private async runRemoteInstall(session: NodeOnboardingSession): Promise<string> {
    const client = await this.openSshConnection(session);
    const logs: string[] = [];
    try {
      const privateKeyBase64 = Buffer.from(session.deployKeyPrivate, 'utf8').toString('base64');
      const publicKeyBase64 = Buffer.from(session.deployKeyPublic, 'utf8').toString('base64');
      const nodeIdQuoted = this.shellQuote(session.nodeId);
      const wsQuoted = this.shellQuote(session.controlPlaneWs);
      const tokenQuoted = this.shellQuote(this.configService.get<string>('AGENT_SHARED_TOKEN') ?? '');
      const repoUrlQuoted = this.shellQuote(session.repoUrl);
      const repoRefQuoted = this.shellQuote(session.repoRef);
      const sshUserQuoted = this.shellQuote(session.sshUsername);

      if (tokenQuoted === "''") {
        throw new Error('AGENT_SHARED_TOKEN est manquant côté API');
      }

      const commandScripts: Array<{ label: string; script: string }> = [
        {
          label: 'Install packages',
          script: [
            'set -euo pipefail',
            'export DEBIAN_FRONTEND=noninteractive',
            'apt-get update -y',
            'apt-get install -y --no-install-recommends ca-certificates curl git golang-go nfs-common cifs-utils wireguard-tools iproute2 util-linux',
          ].join('\n'),
        },
        {
          label: 'Write deploy key',
          script: [
            'set -euo pipefail',
            'mkdir -p "$HOME/.ssh" "$HOME/.apps"',
            'chmod 700 "$HOME/.ssh"',
            `printf '%s' ${this.shellQuote(privateKeyBase64)} | base64 -d > "$HOME/.ssh/tarmac_deploy_ed25519"`,
            `printf '%s' ${this.shellQuote(publicKeyBase64)} | base64 -d > "$HOME/.ssh/tarmac_deploy_ed25519.pub"`,
            'chmod 600 "$HOME/.ssh/tarmac_deploy_ed25519"',
            'chmod 644 "$HOME/.ssh/tarmac_deploy_ed25519.pub"',
          ].join('\n'),
        },
        {
          label: 'Clone repository',
          script: [
            'set -euo pipefail',
            'TARGET="$HOME/.apps/Tarmac"',
            'KEY="$HOME/.ssh/tarmac_deploy_ed25519"',
            `REPO_URL=${repoUrlQuoted}`,
            `REPO_REF=${repoRefQuoted}`,
            'GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"',
            'if [ -d "$TARGET/.git" ]; then',
            '  git -C "$TARGET" remote set-url origin "$REPO_URL"',
            '  GIT_SSH_COMMAND="$GIT_SSH_COMMAND" git -C "$TARGET" fetch --depth 1 origin "$REPO_REF"',
            '  git -C "$TARGET" checkout -f "$REPO_REF"',
            'else',
            '  rm -rf "$TARGET"',
            '  GIT_SSH_COMMAND="$GIT_SSH_COMMAND" git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$TARGET"',
            'fi',
          ].join('\n'),
        },
        {
          label: 'Install and start agent',
          script: [
            'set -euo pipefail',
            'TARGET="$HOME/.apps/Tarmac"',
            'KEY="$HOME/.ssh/tarmac_deploy_ed25519"',
            `NODE_ID=${nodeIdQuoted}`,
            `CONTROL_PLANE_WS=${wsQuoted}`,
            `AGENT_TOKEN=${tokenQuoted}`,
            `SSH_USER=${sshUserQuoted}`,
            `REPO_URL=${repoUrlQuoted}`,
            `REPO_REF=${repoRefQuoted}`,
            'GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \\',
            'bash "$TARGET/apps/agent/scripts/install-agent-service.sh" \\',
            '  --node-id "$NODE_ID" \\',
            '  --control-plane-ws "$CONTROL_PLANE_WS" \\',
            '  --agent-token "$AGENT_TOKEN" \\',
            '  --ssh-user "$SSH_USER" \\',
            '  --agent-ref "$REPO_REF" \\',
            '  --repo-url "$REPO_URL"',
            'systemctl is-active tarmac-agent.service',
          ].join('\n'),
        },
      ];

      for (const step of commandScripts) {
        const result = await this.execRemote(client, this.buildRemoteCommand(session, step.script));
        if (result.code !== 0) {
          throw new Error(
            `${step.label} failed (${result.code}): ${(result.stderr || result.stdout || '').trim()}`.trim(),
          );
        }
        const compactOutput = (result.stdout || result.stderr).trim();
        if (compactOutput) {
          logs.push(`[${step.label}] ${compactOutput}`);
        } else {
          logs.push(`[${step.label}] ok`);
        }
      }
    } finally {
      client.end();
    }
    return logs.join('\n');
  }

  private openSshConnection(session: NodeOnboardingSession): Promise<Client> {
    const config: ConnectConfig = {
      host: session.hostIp,
      port: 22,
      username: session.sshUsername,
      password: session.sshPassword,
      readyTimeout: 25_000,
      tryKeyboard: false,
    };
    return new Promise((resolve, reject) => {
      const client = new Client();
      client
        .on('ready', () => resolve(client))
        .on('error', (error: Error) => reject(error))
        .connect(config);
    });
  }

  private execRemote(client: Client, command: string): Promise<RemoteCommandResult> {
    return new Promise((resolve, reject) => {
      client.exec(command, (error, stream) => {
        if (error) {
          reject(error);
          return;
        }
        let stdout = '';
        let stderr = '';
        let code = 0;
        stream
          .on('close', (exitCode?: number) => {
            code = typeof exitCode === 'number' ? exitCode : 0;
            resolve({ code, stdout, stderr });
          })
          .on('data', (data: Buffer) => {
            stdout += data.toString('utf8');
          });
        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString('utf8');
        });
      });
    });
  }
}
