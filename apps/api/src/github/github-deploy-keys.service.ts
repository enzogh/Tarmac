import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { openSecret, sealSecret, secretsKeyConfigured } from '../common/secret-box';
import { PrismaService } from '../prisma/prisma.service';
import { GithubDeployKey, matchDeployKeys, normalizePublicKey, publicKeyFingerprint } from './deploy-key-match';

const SETTING = 'github.deploy-keys';
const SYNC_INTERVAL_MS = 15 * 60_000;
const GITHUB_API = 'https://api.github.com';

type StoredConfig = {
  repository: string;
  token: string; // sealed
  tokenHint: string;
  verifiedAt: string | null;
  lastError: string | null;
  lastSyncAt: string | null;
};

export type DeployKeyNodeStatus = 'on_github' | 'missing' | 'unknown';

class GithubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// What GitHub's answer means for someone configuring the integration.
function describeGithubError(error: unknown): string {
  if (error instanceof GithubError) {
    if (error.status === 401) return 'GitHub refuse le jeton (révoqué, expiré ou mal copié).';
    if (error.status === 403) return 'Le jeton n’a pas le droit de gérer les deploy keys : il lui faut la permission « Administration » en lecture et écriture sur ce dépôt.';
    if (error.status === 404) return 'Dépôt introuvable avec ce jeton : vérifiez le nom du dépôt et que le jeton y a accès.';
    return `GitHub a répondu ${error.status} : ${error.message}`;
  }
  return error instanceof Error ? `GitHub injoignable : ${error.message}` : 'GitHub injoignable.';
}

/**
 * Deploy keys of the Tarmac repository on GitHub, managed for the nodes:
 * each node clones and updates its agent with its own read-only key. Keys
 * are added when a node is onboarded and removed when it's deleted; nodes
 * that existed before are linked to the keys already on GitHub from the
 * public key their agent reports. Configured by platform superusers only.
 */
@Injectable()
export class GithubDeployKeysService implements OnModuleInit {
  private readonly logger = new Logger(GithubDeployKeysService.name);

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    setTimeout(() => {
      void this.syncQuietly();
      setInterval(() => void this.syncQuietly(), SYNC_INTERVAL_MS);
    }, 60_000);
  }

  private async loadConfig(): Promise<StoredConfig | null> {
    const setting = await this.prisma.platformSetting.findUnique({ where: { key: SETTING } });
    const value = setting?.value as StoredConfig | null | undefined;
    return value?.repository && value.token ? value : null;
  }

  private async saveConfig(config: StoredConfig, actorUserId?: string) {
    const value = config as unknown as Prisma.InputJsonObject;
    await this.prisma.platformSetting.upsert({
      where: { key: SETTING },
      create: { key: SETTING, value, updatedById: actorUserId },
      update: { value, ...(actorUserId ? { updatedById: actorUserId } : {}) },
    });
  }

  private async request<T>(token: string, method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${GITHUB_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Tarmac',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (!response.ok) {
      let message = text.slice(0, 300);
      try {
        const parsed = JSON.parse(text) as { message?: string; errors?: Array<{ message?: string }> };
        message = [parsed.message, ...(parsed.errors ?? []).map((e) => e.message)].filter(Boolean).join(' — ');
      } catch {
        // not JSON
      }
      throw new GithubError(response.status, message);
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private async listKeys(config: StoredConfig): Promise<GithubDeployKey[]> {
    const token = openSecret(config.token);
    const keys: GithubDeployKey[] = [];
    for (let page = 1; page <= 20; page++) {
      const batch = await this.request<GithubDeployKey[]>(token, 'GET', `/repos/${config.repository}/keys?per_page=100&page=${page}`);
      keys.push(...batch);
      if (batch.length < 100) break;
    }
    return keys;
  }

  async status() {
    const config = await this.loadConfig();
    return {
      configured: !!config,
      repository: config?.repository ?? null,
      tokenHint: config?.tokenHint ?? null,
      verifiedAt: config?.verifiedAt ?? null,
      lastError: config?.lastError ?? null,
      lastSyncAt: config?.lastSyncAt ?? null,
      secretsKeyConfigured: secretsKeyConfigured(),
    };
  }

  // "owner/name", from that or from a GitHub URL (https or ssh).
  static normalizeRepository(raw: string): string | null {
    const trimmed = raw.trim().replace(/\.git$/, '').replace(/\/+$/, '');
    const match =
      /^(?:https?:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(trimmed);
    return match ? `${match[1]}/${match[2]}` : null;
  }

  async configure(input: { repository: string; token?: string }, actorUserId?: string) {
    const repository = GithubDeployKeysService.normalizeRepository(input.repository);
    if (!repository) throw new BadRequestException('Dépôt invalide : indiquez « propriétaire/nom », par exemple enzogh/Tarmac.');
    const existing = await this.loadConfig();
    const token = input.token?.trim() || (existing ? openSecret(existing.token) : '');
    if (!token) throw new BadRequestException('Jeton GitHub manquant.');

    const config: StoredConfig = {
      repository,
      token: sealSecret(token),
      tokenHint: `…${token.slice(-4)}`,
      verifiedAt: null,
      lastError: null,
      lastSyncAt: existing?.lastSyncAt ?? null,
    };
    try {
      await this.listKeys(config);
    } catch (error) {
      throw new BadRequestException(describeGithubError(error));
    }
    config.verifiedAt = new Date().toISOString();
    await this.saveConfig(config, actorUserId);
    await this.audit(actorUserId, 'admin.github.configure', { repository, tokenChanged: !!input.token?.trim() });
    return this.sync();
  }

  async disconnect(actorUserId?: string) {
    await this.prisma.platformSetting.deleteMany({ where: { key: SETTING } });
    await this.audit(actorUserId, 'admin.github.disconnect', {});
    return this.status();
  }

  /**
   * Links every node to its key on GitHub and adds the keys GitHub lacks.
   * Keys on GitHub that no node holds are only listed: they may belong to
   * something else (a CI, a developer), so removing one is left to a
   * superuser.
   */
  async sync() {
    const config = await this.loadConfig();
    if (!config) return this.overview(null, []);
    let keys: GithubDeployKey[];
    try {
      keys = await this.listKeys(config);
    } catch (error) {
      config.lastError = describeGithubError(error);
      await this.saveConfig(config);
      return this.overview(config, null);
    }

    const nodes = await this.prisma.node.findMany({
      where: { deployKeyPublic: { not: null } },
      select: { id: true, name: true, deployKeyPublic: true, githubDeployKeyId: true },
    });
    const match = matchDeployKeys(nodes, keys);
    for (const [nodeId, keyId] of match.linked) {
      const node = nodes.find((n) => n.id === nodeId);
      if (node?.githubDeployKeyId !== keyId) {
        await this.prisma.node.update({ where: { id: nodeId }, data: { githubDeployKeyId: keyId } });
      }
    }
    let lastError: string | null = null;
    // Two nodes on one host report the same key: added once.
    const added = new Map<string, string>();
    for (const nodeId of match.missing) {
      const node = nodes.find((n) => n.id === nodeId)!;
      const material = normalizePublicKey(node.deployKeyPublic)!;
      try {
        const keyId = added.get(material) ?? (await this.addKey(config, this.keyTitle(node), material)).id;
        added.set(material, keyId);
        await this.prisma.node.update({ where: { id: nodeId }, data: { githubDeployKeyId: keyId } });
        this.logger.log(`Deploy key of node ${node.name} added to ${config.repository}`);
      } catch (error) {
        lastError = describeGithubError(error);
      }
    }
    config.lastError = lastError;
    config.lastSyncAt = new Date().toISOString();
    await this.saveConfig(config);
    return this.overview(config, added.size > 0 ? await this.listKeys(config).catch(() => keys) : keys);
  }

  private async syncQuietly() {
    try {
      await this.sync();
    } catch (error) {
      this.logger.warn(`GitHub deploy key sync failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private keyTitle(node: { id: string; name: string }) {
    return `tarmac-${node.name}-${node.id.slice(0, 8)}`.slice(0, 100);
  }

  // Adds a read-only key, or returns the one GitHub already has for it.
  private async addKey(config: StoredConfig, title: string, publicKey: string): Promise<{ id: string; created: boolean }> {
    const token = openSecret(config.token);
    try {
      const key = await this.request<GithubDeployKey>(token, 'POST', `/repos/${config.repository}/keys`, {
        title,
        key: publicKey,
        read_only: true,
      });
      return { id: String(key.id), created: true };
    } catch (error) {
      // 422 "key is already in use": on this repository it can be linked;
      // on another one GitHub refuses it for good.
      if (error instanceof GithubError && error.status === 422) {
        const existing = (await this.listKeys(config)).find((key) => normalizePublicKey(key.key) === publicKey);
        if (existing) return { id: String(existing.id), created: false };
      }
      throw error;
    }
  }

  async overview(config: StoredConfig | null = null, keys: GithubDeployKey[] | null = null) {
    const nodes = await this.prisma.node.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        status: true,
        deployKeyPublic: true,
        githubDeployKeyId: true,
        workspace: { select: { id: true, name: true } },
      },
    });
    const byId = new Map((keys ?? []).map((key) => [String(key.id), key]));
    const match = keys ? matchDeployKeys(nodes, keys) : null;
    return {
      ...(await this.status()),
      reachable: keys !== null,
      nodes: nodes.map((node) => {
        const material = normalizePublicKey(node.deployKeyPublic);
        const linkedId = match?.linked.get(node.id) ?? node.githubDeployKeyId;
        const status: DeployKeyNodeStatus = !material ? 'unknown' : match ? (match.linked.has(node.id) ? 'on_github' : 'missing') : node.githubDeployKeyId ? 'on_github' : 'missing';
        return {
          id: node.id,
          name: node.name,
          status: node.status,
          workspace: node.workspace,
          fingerprint: material ? publicKeyFingerprint(material) : null,
          keyStatus: status,
          githubKey: linkedId && byId.get(linkedId) ? { id: linkedId, title: byId.get(linkedId)!.title } : linkedId ? { id: linkedId, title: null } : null,
        };
      }),
      orphanKeys: (match?.orphans ?? []).map((key) => ({
        id: String(key.id),
        title: key.title,
        readOnly: key.read_only,
        createdAt: key.created_at ?? null,
        fingerprint: normalizePublicKey(key.key) ? publicKeyFingerprint(normalizePublicKey(key.key)!) : null,
      })),
    };
  }

  async deleteOrphanKey(keyId: string, actorUserId?: string) {
    const config = await this.loadConfig();
    if (!config) throw new ServiceUnavailableException('Intégration GitHub non configurée.');
    const holder = await this.prisma.node.findFirst({ where: { githubDeployKeyId: keyId }, select: { name: true } });
    if (holder) throw new BadRequestException(`Cette clé appartient au nœud ${holder.name} : supprimez le nœud pour la retirer.`);
    const key = (await this.listKeys(config)).find((k) => String(k.id) === keyId);
    if (!key) throw new NotFoundException('Clé introuvable sur GitHub.');
    const nodes = await this.prisma.node.findMany({ where: { deployKeyPublic: { not: null } }, select: { deployKeyPublic: true } });
    if (nodes.some((node) => normalizePublicKey(node.deployKeyPublic) === normalizePublicKey(key.key))) {
      throw new BadRequestException('Un nœud utilise cette clé : elle ne peut pas être supprimée ici.');
    }
    try {
      await this.request(openSecret(config.token), 'DELETE', `/repos/${config.repository}/keys/${keyId}`);
    } catch (error) {
      throw new BadRequestException(describeGithubError(error));
    }
    await this.audit(actorUserId, 'admin.github.delete-key', { repository: config.repository, keyId, title: key.title });
    return this.sync();
  }

  /**
   * Adds a freshly onboarded node's key. Never throws: onboarding falls
   * back to asking the user to add the key by hand.
   */
  async registerNodeKey(node: { id: string; name: string }, publicKey: string): Promise<{ registered: boolean; error: string | null }> {
    const material = normalizePublicKey(publicKey);
    await this.prisma.node.update({ where: { id: node.id }, data: { deployKeyPublic: material } });
    const config = await this.loadConfig();
    if (!config || !material) return { registered: false, error: null };
    try {
      const { id } = await this.addKey(config, this.keyTitle(node), material);
      await this.prisma.node.update({ where: { id: node.id }, data: { githubDeployKeyId: id } });
      return { registered: true, error: null };
    } catch (error) {
      const message = describeGithubError(error);
      this.logger.warn(`Could not add the deploy key of node ${node.name} to GitHub: ${message}`);
      return { registered: false, error: message };
    }
  }

  /**
   * Removes a deleted node's key from GitHub, unless another node still
   * uses the same key (a host enrolled twice). Never throws: the node is
   * gone either way, a key left behind shows up in the admin panel.
   */
  async removeNodeKey(node: { id: string; name: string; deployKeyPublic: string | null; githubDeployKeyId: string | null }): Promise<'removed' | 'kept' | 'none' | 'failed'> {
    const config = await this.loadConfig();
    const material = normalizePublicKey(node.deployKeyPublic);
    if (!config || (!node.githubDeployKeyId && !material)) return 'none';
    if (material) {
      const others = await this.prisma.node.findMany({ where: { id: { not: node.id }, deployKeyPublic: { not: null } }, select: { deployKeyPublic: true } });
      if (others.some((other) => normalizePublicKey(other.deployKeyPublic) === material)) return 'kept';
    }
    try {
      let keyId = node.githubDeployKeyId;
      if (!keyId && material) {
        keyId = (await this.listKeys(config)).find((key) => normalizePublicKey(key.key) === material)?.id?.toString() ?? null;
      }
      if (!keyId) return 'none';
      await this.request(openSecret(config.token), 'DELETE', `/repos/${config.repository}/keys/${keyId}`).catch((error) => {
        if (!(error instanceof GithubError && error.status === 404)) throw error;
      });
      this.logger.log(`Deploy key of deleted node ${node.name} removed from ${config.repository}`);
      return 'removed';
    } catch (error) {
      this.logger.warn(`Could not remove the deploy key of deleted node ${node.name}: ${describeGithubError(error)}`);
      return 'failed';
    }
  }

  private audit(actorUserId: string | undefined, action: string, details: Prisma.InputJsonObject) {
    return this.prisma.auditLog.create({
      data: { actorUserId: actorUserId ?? null, action, resourceType: 'platform', resourceId: null, details },
    });
  }
}
