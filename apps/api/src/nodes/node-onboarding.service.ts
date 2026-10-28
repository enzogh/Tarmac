import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Client, ConnectConfig, utils as sshUtils } from 'ssh2';
import { AgentTokenService } from '../agents/agent-token.service';
import { WorkspaceScope } from '../auth/workspace.guard';
import { GithubDeployKeysService } from '../github/github-deploy-keys.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNodeDto } from './dto/create-node.dto';
import { StartNodeOnboardingDto } from './dto/start-node-onboarding.dto';
import { NodesService } from './nodes.service';

type OnboardingProvider = 'ovh' | 'standard';

type SshCredentials = {
  provider: OnboardingProvider;
  hostIp: string;
  sshUsername: string;
  authMethod: 'password' | 'key';
  sshPassword?: string;
  sshPrivateKey?: string;
  sshKeyPassphrase?: string;
  // Fed to `sudo -S` on OVH hosts; absent means sudo must not prompt.
  sudoPassword?: string;
};

type NodeOnboardingSession = SshCredentials & {
  onboardingId: string;
  createdAt: Date;
  expiresAt: Date;
  nodeId: string;
  nodeName: string;
  role: string;
  repoUrl: string;
  repoRef: string;
  controlPlaneWs: string;
  deployKeyPublic: string;
  agentToken: string;
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
    private readonly agentTokenService: AgentTokenService,
    private readonly prisma: PrismaService,
    private readonly githubDeployKeys: GithubDeployKeysService,
  ) {}

  async startOnboarding(dto: StartNodeOnboardingDto, scope: WorkspaceScope, actorUserId?: string) {
    const controlPlaneWs = dto.controlPlaneWs?.trim() || this.configService.get<string>('AGENT_CONTROL_PLANE_WS');
    if (!controlPlaneWs) {
      throw new BadRequestException('controlPlaneWs manquant');
    }

    const credentials = this.credentialsFrom(dto);

    const createNodeDto: CreateNodeDto = {
      name: dto.name,
      // Onboarded nodes are always workers.
      role: 'worker',
    };
    const node = await this.nodesService.create(createNodeDto, scope, actorUserId);

    const agentToken = this.agentTokenService.generate();
    await this.prisma.node.update({
      where: { id: node.id },
      data: { agentTokenHash: this.agentTokenService.hash(agentToken), agentTokenRotatedAt: new Date() },
    });

    const deployKeyPublic = await this.ensureRemoteDeployKey(credentials);

    // Added to the repository's deploy keys right away when the GitHub
    // integration is set up; otherwise (or if GitHub refuses) the user adds
    // it by hand, as before.
    const registration = await this.githubDeployKeys.registerNodeKey(node, deployKeyPublic);

    const onboardingId = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + NodeOnboardingService.ONBOARDING_TTL_MS);
    const repoUrl = await this.githubDeployKeys.nodeRepositoryUrl();
    // Nodes always run main: the branch agent updates follow.
    const repoRef = 'main';
    this.sessions.set(onboardingId, {
      onboardingId,
      createdAt: now,
      expiresAt,
      nodeId: node.id,
      nodeName: node.name,
      role: node.role,
      ...credentials,
      repoUrl,
      repoRef,
      controlPlaneWs,
      deployKeyPublic,
      agentToken,
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
        registered: registration.registered,
        registrationError: registration.error,
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

  private credentialsFrom(dto: StartNodeOnboardingDto): SshCredentials {
    const base = {
      provider: dto.provider,
      hostIp: dto.hostIp.trim(),
      sshUsername: dto.sshUsername.trim(),
    };
    if (dto.authMethod !== 'key') {
      if (!dto.sshPassword) {
        throw new BadRequestException('Mot de passe SSH manquant');
      }
      return { ...base, authMethod: 'password', sshPassword: dto.sshPassword, sudoPassword: dto.sshPassword };
    }

    // Keys pasted from a Windows editor or a web form may carry CRLF line
    // endings or surrounding blank lines, which ssh2 rejects.
    const sshPrivateKey = (dto.sshPrivateKey ?? '').replace(/\r\n?/g, '\n').trim() + '\n';
    const sshKeyPassphrase = dto.sshKeyPassphrase || undefined;
    const parsed = sshUtils.parseKey(sshPrivateKey, sshKeyPassphrase);
    if (parsed instanceof Error) {
      const message = parsed.message.toLowerCase();
      if (message.includes('passphrase') || message.includes('decrypt') || message.includes('bad decrypt')) {
        throw new BadRequestException(
          sshKeyPassphrase
            ? 'La phrase de passe ne permet pas de déchiffrer la clé privée.'
            : 'Cette clé privée est protégée par une phrase de passe : renseignez-la.',
        );
      }
      throw new BadRequestException(
        'Clé privée illisible. Collez la clé privée complète (bloc BEGIN … PRIVATE KEY), pas la clé publique.',
      );
    }
    const key = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!key?.isPrivateKey()) {
      throw new BadRequestException('Il faut la clé privée, pas la clé publique (.pub).');
    }
    return {
      ...base,
      authMethod: 'key',
      sshPrivateKey,
      sshKeyPassphrase,
      sudoPassword: dto.sudoPassword || undefined,
    };
  }

  private cleanupExpiredSessions() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.expiresAt.getTime() <= now) {
        this.sessions.delete(sessionId);
      }
    }
  }

  private toHttpsRepoUrl(repoUrl: string) {
    const trimmed = repoUrl.trim();
    if (trimmed.startsWith('https://github.com/')) {
      return trimmed;
    }
    const sshMatch = trimmed.match(/^git@github\.com:(.+)$/);
    if (sshMatch) {
      return `https://github.com/${sshMatch[1]}`;
    }
    const sshUrlMatch = trimmed.match(/^ssh:\/\/git@github\.com\/(.+)$/);
    if (sshUrlMatch) {
      return `https://github.com/${sshUrlMatch[1]}`;
    }
    return trimmed;
  }

  private shellQuote(value: string): string {
    return `'${value.replace(/'/g, `'\"'\"'`)}'`;
  }

  private buildRemoteCommand(credentials: SshCredentials, script: string): string {
    if (credentials.provider !== 'ovh') {
      return `bash -lc ${this.shellQuote(script)}`;
    }
    if (!credentials.sudoPassword) {
      // Key-only access: typical cloud images grant passwordless sudo.
      return `sudo -n bash -lc ${this.shellQuote(script)}`;
    }
    const escapedPassword = this.shellQuote(credentials.sudoPassword);
    return `printf '%s\\n' ${escapedPassword} | sudo -S -p '' bash -lc ${this.shellQuote(script)}`;
  }

  // Turns the raw sudo refusal into something the user can act on.
  private describeRemoteFailure(credentials: SshCredentials, output: string): string {
    const trimmed = output.trim();
    if (credentials.provider === 'ovh' && /sudo: (a password is required|.*incorrect password)/i.test(trimmed)) {
      return credentials.sudoPassword
        ? `Le mot de passe sudo de ${credentials.sshUsername} a été refusé.`
        : `sudo demande un mot de passe pour ${credentials.sshUsername} : renseignez le mot de passe sudo.`;
    }
    return trimmed;
  }

  private async ensureRemoteDeployKey(credentials: SshCredentials): Promise<string> {
    const client = await this.openSshConnection(credentials);
    try {
      const result = await this.execRemote(
        client,
        this.buildRemoteCommand(
          credentials,
          [
            'set -euo pipefail',
            'mkdir -p "$HOME/.ssh" "$HOME/.apps"',
            'chmod 700 "$HOME/.ssh"',
            'KEY="$HOME/.ssh/tarmac_deploy_ed25519"',
            'if [ -f "$KEY" ] && ssh-keygen -y -f "$KEY" >/dev/null 2>&1; then',
            '  :',
            'else',
            '  rm -f "$KEY" "$KEY.pub"',
            '  ssh-keygen -t ed25519 -N "" -C "tarmac-deploy" -f "$KEY" >/dev/null',
            'fi',
            'chmod 600 "$KEY"',
            'chmod 644 "$KEY.pub"',
            'cat "$KEY.pub"',
          ].join('\n'),
        ),
      );
      if (result.code !== 0) {
        throw new BadRequestException(
          this.describeRemoteFailure(credentials, result.stderr || result.stdout || '') ||
            'Impossible de générer la clé de déploiement sur le serveur.',
        );
      }
      const publicKey = (result.stdout || '').trim();
      if (!publicKey.startsWith('ssh-ed25519 ')) {
        throw new Error('invalid deploy public key generated on remote host');
      }
      return publicKey;
    } finally {
      client.end();
    }
  }

  private async runRemoteInstall(session: NodeOnboardingSession): Promise<string> {
    const client = await this.openSshConnection(session);
    const logs: string[] = [];
    try {
      const nodeIdQuoted = this.shellQuote(session.nodeId);
      const wsQuoted = this.shellQuote(session.controlPlaneWs);
      const tokenQuoted = this.shellQuote(session.agentToken);
      const repoUrlQuoted = this.shellQuote(session.repoUrl);
      const repoUrlHttpsQuoted = this.shellQuote(this.toHttpsRepoUrl(session.repoUrl));
      const repoRefQuoted = this.shellQuote(session.repoRef);
      const sshUserQuoted = this.shellQuote(session.sshUsername);

      const commandScripts: Array<{ label: string; script: string }> = [
        {
          label: 'Install packages',
          script: [
            'set -euo pipefail',
            'export DEBIAN_FRONTEND=noninteractive',
            'apt-get update -y',
            'apt-get install -y --no-install-recommends ca-certificates curl git golang-go rsync nfs-common cifs-utils sshpass wireguard-tools iproute2 util-linux',
          ].join('\n'),
        },
        {
          label: 'Clone repository',
          script: [
            'set -euo pipefail',
            'TARGET="$HOME/.apps/Tarmac"',
            'KEY="$HOME/.ssh/tarmac_deploy_ed25519"',
            `REPO_URL=${repoUrlQuoted}`,
            `REPO_URL_HTTPS=${repoUrlHttpsQuoted}`,
            `REPO_REF=${repoRefQuoted}`,
            'GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"',
            'export GIT_TERMINAL_PROMPT=0',
            'if [ -d "$TARGET/.git" ]; then',
            '  git -C "$TARGET" remote set-url origin "$REPO_URL"',
            '  if ! GIT_SSH_COMMAND="$GIT_SSH_COMMAND" git -C "$TARGET" fetch --depth 1 origin "$REPO_REF"; then',
            '    git -C "$TARGET" remote set-url origin "$REPO_URL_HTTPS"',
            '    git -C "$TARGET" fetch --depth 1 origin "$REPO_REF"',
            '  fi',
            '  git -C "$TARGET" checkout -f "$REPO_REF"',
            'else',
            '  rm -rf "$TARGET"',
            '  if ! GIT_SSH_COMMAND="$GIT_SSH_COMMAND" git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$TARGET"; then',
            '    git clone --depth 1 --branch "$REPO_REF" "$REPO_URL_HTTPS" "$TARGET"',
            '  fi',
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
            `REPO_URL_HTTPS=${repoUrlHttpsQuoted}`,
            `REPO_REF=${repoRefQuoted}`,
            'GIT_SSH_COMMAND="ssh -i $KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \\',
            'bash "$TARGET/apps/agent/scripts/install-agent-service.sh" \\',
            '  --node-id "$NODE_ID" \\',
            '  --control-plane-ws "$CONTROL_PLANE_WS" \\',
            '  --agent-token "$AGENT_TOKEN" \\',
            '  --ssh-user "$SSH_USER" \\',
            '  --agent-ref "$REPO_REF" \\',
            '  --repo-url "$REPO_URL" || \\',
            'bash "$TARGET/apps/agent/scripts/install-agent-service.sh" \\',
            '  --node-id "$NODE_ID" \\',
            '  --control-plane-ws "$CONTROL_PLANE_WS" \\',
            '  --agent-token "$AGENT_TOKEN" \\',
            '  --ssh-user "$SSH_USER" \\',
            '  --agent-ref "$REPO_REF" \\',
            '  --repo-url "$REPO_URL_HTTPS"',
            'systemctl is-active tarmac-agent.service',
          ].join('\n'),
        },
      ];

      for (const step of commandScripts) {
        const result = await this.execRemote(client, this.buildRemoteCommand(session, step.script));
        if (result.code !== 0) {
          throw new Error(
            `${step.label} failed (${result.code}): ${this.describeRemoteFailure(session, result.stderr || result.stdout || '')}`.trim(),
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

  private openSshConnection(credentials: SshCredentials): Promise<Client> {
    const config: ConnectConfig = {
      host: credentials.hostIp,
      port: 22,
      username: credentials.sshUsername,
      readyTimeout: 25_000,
      tryKeyboard: false,
      ...(credentials.authMethod === 'key'
        ? { privateKey: credentials.sshPrivateKey, passphrase: credentials.sshKeyPassphrase }
        : { password: credentials.sshPassword }),
    };
    return new Promise((resolve, reject) => {
      const client = new Client();
      client
        .on('ready', () => resolve(client))
        .on('error', (error: Error & { level?: string }) => {
          if (error.level === 'client-authentication') {
            reject(
              new BadRequestException(
                credentials.authMethod === 'key'
                  ? `Le serveur refuse cette clé pour ${credentials.sshUsername}. Vérifiez que sa clé publique figure dans ~/.ssh/authorized_keys.`
                  : `Identifiants SSH refusés pour ${credentials.sshUsername}.`,
              ),
            );
            return;
          }
          reject(error);
        })
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
