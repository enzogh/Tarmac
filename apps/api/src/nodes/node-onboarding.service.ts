import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'crypto';
import { BlockList, isIPv4 } from 'net';
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
  workspaceId: string;
  // SSH host key seen at the first connection ("SHA256:..."): the install
  // step refuses a server presenting another one.
  hostKeyFingerprint: string;
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

// Addresses the control plane must not be pointed at by a workspace member:
// loopback, private and link-local ranges (the internal network this API
// runs on, cloud metadata endpoints), CGNAT, multicast and reserved space.
const NON_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b::', 96]] as const) {
  NON_PUBLIC.addSubnet(network, prefix, 'ipv6');
}

export function isPublicIp(ip: string): boolean {
  // An IPv4-mapped IPv6 address (::ffff:10.0.0.1) is judged as the IPv4
  // address it carries.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)?.[1];
  const address = mapped ?? ip;
  return !NON_PUBLIC.check(address, isIPv4(address) ? 'ipv4' : 'ipv6');
}

function fingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

type RemoteCommandResult = {
  code: number;
  stdout: string;
  stderr: string;
};

// The install runs in the background: a single request lasting the whole
// install (apt, clone, Go build: several minutes) was cut by the reverse
// proxy after 100 s (Cloudflare 524) while the server kept installing.
// The panel now starts it, then polls getInstallProgress for the phase,
// the percentage and the live log.
export type InstallPhaseId = 'ssh' | 'packages' | 'clone' | 'build' | 'service' | 'agent';
type InstallPhaseStatus = 'pending' | 'running' | 'done' | 'error';

type InstallPhase = {
  id: InstallPhaseId;
  label: string;
  status: InstallPhaseStatus;
  startedAt?: number;
  finishedAt?: number;
};

type InstallJob = {
  onboardingId: string;
  workspaceId: string;
  nodeId: string;
  nodeName: string;
  status: 'running' | 'succeeded' | 'failed';
  phases: InstallPhase[];
  // Log lines, absolute index = droppedLines + position; the panel asks
  // for the lines after the last index it has.
  lines: string[];
  droppedLines: number;
  // Unterminated output of the current command, waiting for its newline.
  partial: string;
  secrets: string[];
  startedAt: number;
  finishedAt?: number;
  error?: string;
  warning?: string;
};

const PHASES: Array<{ id: InstallPhaseId; label: string; weight: number; expectedMs: number }> = [
  { id: 'ssh', label: 'Connexion au serveur', weight: 3, expectedMs: 5_000 },
  { id: 'packages', label: 'Installation des paquets système', weight: 27, expectedMs: 90_000 },
  { id: 'clone', label: 'Téléchargement du code Tarmac', weight: 8, expectedMs: 20_000 },
  { id: 'build', label: 'Compilation de l’agent', weight: 45, expectedMs: 150_000 },
  { id: 'service', label: 'Démarrage du service', weight: 5, expectedMs: 10_000 },
  { id: 'agent', label: 'Connexion de l’agent à Tarmac', weight: 12, expectedMs: 20_000 },
];
const MAX_LOG_LINES = 4000;
const AGENT_CONNECT_TIMEOUT_MS = 3 * 60_000;
const JOB_RETENTION_MS = 60 * 60_000;
// Markers printed by install-agent-service.sh between its stages.
const SCRIPT_MARKERS: Array<{ pattern: RegExp; phase: InstallPhaseId }> = [
  { pattern: /^\[tarmac\] build/i, phase: 'build' },
  { pattern: /^\[tarmac\] service/i, phase: 'service' },
];
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

@Injectable()
export class NodeOnboardingService {
  private static readonly ONBOARDING_TTL_MS = 30 * 60 * 1000;
  private readonly sessions = new Map<string, NodeOnboardingSession>();
  private readonly jobs = new Map<string, InstallJob>();

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
    // Platform admins may onboard a server over the internal network; a
    // workspace member must not be able to make this API open SSH
    // connections into it.
    if (!scope.isPlatformAdmin && !isPublicIp(credentials.hostIp)) {
      throw new BadRequestException('Indiquez l’adresse IP publique du serveur : les adresses privées ou internes ne sont pas acceptées.');
    }

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

    const { publicKey: deployKeyPublic, hostKeyFingerprint } = await this.ensureRemoteDeployKey(credentials);

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
      workspaceId: scope.workspaceId as string,
      hostKeyFingerprint,
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
      hostKeyFingerprint,
      githubDeployKey: {
        title: `tarmac-${node.name}-${node.id.slice(0, 8)}`,
        publicKey: deployKeyPublic,
        repoUrl,
        registered: registration.registered,
        registrationError: registration.error,
      },
    };
  }

  // Starts the install in the background and returns at once; calling it
  // again while it runs returns the running install instead of starting a
  // second one, and after a failure starts a new attempt.
  startInstall(onboardingId: string, scope: WorkspaceScope) {
    const existing = this.jobs.get(onboardingId);
    if (existing && existing.workspaceId === scope.workspaceId && existing.status !== 'failed') {
      return this.describeJob(existing, 0);
    }
    const session = this.sessions.get(onboardingId);
    if (!session || session.workspaceId !== scope.workspaceId) {
      throw new NotFoundException('Session onboarding introuvable');
    }
    if (session.expiresAt.getTime() < Date.now()) {
      this.sessions.delete(onboardingId);
      throw new BadRequestException('Session onboarding expirée, recommencez');
    }

    const job: InstallJob = {
      onboardingId,
      workspaceId: session.workspaceId,
      nodeId: session.nodeId,
      nodeName: session.nodeName,
      status: 'running',
      phases: PHASES.map(({ id, label }) => ({ id, label, status: 'pending' })),
      lines: [],
      droppedLines: 0,
      partial: '',
      secrets: [session.agentToken, session.sshPassword, session.sudoPassword, session.sshKeyPassphrase].filter(
        (value): value is string => !!value && value.length >= 4,
      ),
      startedAt: Date.now(),
    };
    this.jobs.set(onboardingId, job);
    this.cleanupExpiredJobs();

    void this.runRemoteInstall(session, job)
      .then(async () => {
        this.sessions.delete(onboardingId);
        await this.waitForAgent(job);
        job.status = 'succeeded';
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Échec installation';
        const running = job.phases.find((phase) => phase.status === 'running');
        if (running) {
          running.status = 'error';
          running.finishedAt = Date.now();
        }
        job.error = this.redact(job, message);
        job.status = 'failed';
        this.appendLog(job, `\n✖ ${job.error}\n`);
      })
      .finally(() => {
        job.finishedAt = Date.now();
      });

    return this.describeJob(job, 0);
  }

  getInstallProgress(onboardingId: string, scope: WorkspaceScope, after: number) {
    const job = this.jobs.get(onboardingId);
    if (!job || job.workspaceId !== scope.workspaceId) {
      throw new NotFoundException('Installation introuvable');
    }
    return this.describeJob(job, after);
  }

  private describeJob(job: InstallJob, after: number) {
    const from = Math.max(0, after - job.droppedLines);
    const lines = job.lines.slice(from);
    return {
      onboardingId: job.onboardingId,
      nodeId: job.nodeId,
      nodeName: job.nodeName,
      status: job.status,
      percent: this.percent(job),
      phases: job.phases.map(({ id, label, status, startedAt, finishedAt }) => ({
        id,
        label,
        status,
        durationMs: startedAt ? (finishedAt ?? Date.now()) - startedAt : null,
      })),
      startedAt: new Date(job.startedAt).toISOString(),
      elapsedMs: (job.finishedAt ?? Date.now()) - job.startedAt,
      // Where these lines start; the next poll passes `cursor`.
      from: job.droppedLines + from,
      lines,
      cursor: job.droppedLines + job.lines.length,
      error: job.error ?? null,
      warning: job.warning ?? null,
    };
  }

  // Finished phases count in full; the running one advances with its
  // elapsed time against its usual duration, never past 95 %, so the bar
  // keeps moving on a slow server without ever claiming to be done.
  private percent(job: InstallJob): number {
    if (job.status === 'succeeded') return 100;
    const total = PHASES.reduce((sum, phase) => sum + phase.weight, 0);
    let done = 0;
    for (const phase of job.phases) {
      const spec = PHASES.find((item) => item.id === phase.id)!;
      if (phase.status === 'done') {
        done += spec.weight;
      } else if (phase.status === 'running' && phase.startedAt) {
        const elapsed = Date.now() - phase.startedAt;
        done += spec.weight * Math.min(0.95, 1 - Math.exp(-elapsed / spec.expectedMs));
      }
    }
    return Math.min(99, Math.round((done / total) * 100));
  }

  private setPhase(job: InstallJob, id: InstallPhaseId) {
    const now = Date.now();
    const index = job.phases.findIndex((phase) => phase.id === id);
    job.phases.forEach((phase, position) => {
      if (position < index && phase.status !== 'done') {
        phase.status = 'done';
        phase.startedAt ??= now;
        phase.finishedAt = now;
      }
    });
    const phase = job.phases[index];
    if (phase.status === 'pending') {
      phase.status = 'running';
      phase.startedAt = now;
    }
  }

  private finishPhase(job: InstallJob, id: InstallPhaseId) {
    const phase = job.phases.find((item) => item.id === id)!;
    phase.status = 'done';
    phase.startedAt ??= Date.now();
    phase.finishedAt = Date.now();
  }

  private redact(job: InstallJob, text: string): string {
    let result = text;
    for (const secret of job.secrets) result = result.split(secret).join('••••••');
    return result;
  }

  // Remote output arrives in arbitrary chunks: complete lines are kept,
  // apt/git progress rewritten with \r keeps only its last state.
  private appendLog(job: InstallJob, chunk: string, onLine?: (line: string) => void) {
    const text = job.partial + this.redact(job, chunk.replace(ANSI, ''));
    const parts = text.split('\n');
    job.partial = parts.pop() ?? '';
    for (const raw of parts) {
      const line = raw.split('\r').filter((segment) => segment.length > 0).pop() ?? '';
      job.lines.push(line);
      onLine?.(line);
    }
    if (job.lines.length > MAX_LOG_LINES) {
      const drop = job.lines.length - MAX_LOG_LINES;
      job.lines.splice(0, drop);
      job.droppedLines += drop;
    }
  }

  private flushLog(job: InstallJob) {
    if (job.partial) this.appendLog(job, '\n');
  }

  // The service being up says nothing about the agent reaching this
  // control plane (wrong URL, firewall): the install is only reported done
  // once the node has checked in.
  private async waitForAgent(job: InstallJob) {
    this.setPhase(job, 'agent');
    this.appendLog(job, '\n▸ Attente de la première connexion de l’agent…\n');
    const since = new Date(job.phases.find((phase) => phase.id === 'agent')!.startedAt! - 5_000);
    const deadline = Date.now() + AGENT_CONNECT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const node = await this.prisma.node.findUnique({ where: { id: job.nodeId }, select: { status: true, lastSeenAt: true } });
      if (node?.status === 'online' && node.lastSeenAt && node.lastSeenAt >= since) {
        this.finishPhase(job, 'agent');
        this.appendLog(job, '✔ Agent connecté à Tarmac.\n');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
    this.finishPhase(job, 'agent');
    job.warning =
      'Le service tourne sur le serveur, mais l’agent ne s’est pas encore connecté à Tarmac. Vérifiez que le serveur peut joindre ce panel (pare-feu, DNS) ; il apparaîtra en ligne dès sa première connexion.';
    this.appendLog(job, `⚠ ${job.warning}\n`);
  }

  private cleanupExpiredJobs() {
    const now = Date.now();
    for (const [id, job] of this.jobs.entries()) {
      if (job.finishedAt && now - job.finishedAt > JOB_RETENTION_MS) this.jobs.delete(id);
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

  private async ensureRemoteDeployKey(credentials: SshCredentials): Promise<{ publicKey: string; hostKeyFingerprint: string }> {
    const { client, hostKeyFingerprint } = await this.openSshConnection(credentials);
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
      return { publicKey, hostKeyFingerprint };
    } finally {
      client.end();
    }
  }

  private async runRemoteInstall(session: NodeOnboardingSession, job: InstallJob): Promise<void> {
    this.setPhase(job, 'ssh');
    this.appendLog(job, `▸ Connexion SSH à ${session.sshUsername}@${session.hostIp}…\n`);
    const { client } = await this.openSshConnection(session, session.hostKeyFingerprint);
    this.finishPhase(job, 'ssh');
    this.appendLog(job, '✔ Connecté, identité du serveur vérifiée.\n');
    try {
      const nodeIdQuoted = this.shellQuote(session.nodeId);
      const wsQuoted = this.shellQuote(session.controlPlaneWs);
      const tokenQuoted = this.shellQuote(session.agentToken);
      const repoUrlQuoted = this.shellQuote(session.repoUrl);
      const repoUrlHttpsQuoted = this.shellQuote(this.toHttpsRepoUrl(session.repoUrl));
      const repoRefQuoted = this.shellQuote(session.repoRef);
      const sshUserQuoted = this.shellQuote(session.sshUsername);

      const commandScripts: Array<{ phase: InstallPhaseId; label: string; script: string }> = [
        {
          phase: 'packages',
          label: 'Install packages',
          script: [
            'set -euo pipefail',
            'export DEBIAN_FRONTEND=noninteractive',
            'apt-get update -y',
            'apt-get install -y --no-install-recommends ca-certificates curl git golang-go rsync nfs-common cifs-utils sshpass wireguard-tools iproute2 util-linux',
          ].join('\n'),
        },
        {
          phase: 'clone',
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
          phase: 'build',
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
        this.setPhase(job, step.phase);
        const label = job.phases.find((phase) => phase.id === step.phase)!.label;
        this.appendLog(job, `\n▸ ${label}\n`);
        const onLine = (line: string) => {
          const marker = SCRIPT_MARKERS.find((item) => item.pattern.test(line));
          if (marker) this.setPhase(job, marker.phase);
        };
        const result = await this.execRemote(client, this.buildRemoteCommand(session, step.script), (chunk) =>
          this.appendLog(job, chunk, onLine),
        );
        this.flushLog(job);
        if (result.code !== 0) {
          const detail = this.describeRemoteFailure(session, result.stderr || result.stdout || '');
          const lastLines = detail.split('\n').slice(-6).join('\n');
          throw new Error(`${label} : échec (code ${result.code}).${lastLines ? `\n${lastLines}` : ''}`);
        }
      }
      this.finishPhase(job, 'build');
      this.finishPhase(job, 'service');
    } finally {
      client.end();
    }
  }

  // The host key is recorded at the first connection and must match on the
  // next one: whoever answers in between (a hijacked address) would
  // otherwise receive the SSH and sudo passwords.
  private openSshConnection(credentials: SshCredentials, expectedFingerprint?: string): Promise<{ client: Client; hostKeyFingerprint: string }> {
    let seen = '';
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
    config.hostVerifier = (key: Buffer) => {
      seen = fingerprint(key);
      return !expectedFingerprint || seen === expectedFingerprint;
    };
    return new Promise((resolve, reject) => {
      const client = new Client();
      client
        .on('ready', () => resolve({ client, hostKeyFingerprint: seen }))
        .on('error', (error: Error & { level?: string }) => {
          if (expectedFingerprint && seen && seen !== expectedFingerprint) {
            reject(
              new BadRequestException(
                'L’identité SSH du serveur a changé depuis la première étape. Par sécurité, l’installation est interrompue : recommencez l’ajout.',
              ),
            );
            return;
          }
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

  private execRemote(client: Client, command: string, onChunk?: (chunk: string) => void): Promise<RemoteCommandResult> {
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
            const text = data.toString('utf8');
            stdout += text;
            onChunk?.(text);
          });
        stream.stderr.on('data', (data: Buffer) => {
          const text = data.toString('utf8');
          stderr += text;
          onChunk?.(text);
        });
      });
    });
  }
}
