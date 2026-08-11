import { Injectable, Logger, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Issuer, generators, type Client } from 'openid-client';

// Wraps OIDC discovery + client construction for the Authentik SSO
// integration. Discovery happens lazily (and is cached) so a slow/unreachable
// Authentik instance at boot never prevents the rest of the API from
// starting - SSO routes just fail until it recovers.
@Injectable()
export class AuthentikService implements OnModuleInit {
  private readonly logger = new Logger(AuthentikService.name);
  private client: Client | null = null;
  private discovering: Promise<Client> | null = null;

  constructor(private readonly configService: ConfigService) {}

  get isConfigured(): boolean {
    return Boolean(
      this.configService.get<string>('AUTHENTIK_ISSUER_URL') &&
        this.configService.get<string>('AUTHENTIK_CLIENT_ID') &&
        this.configService.get<string>('AUTHENTIK_CLIENT_SECRET') &&
        this.configService.get<string>('AUTHENTIK_REDIRECT_URI'),
    );
  }

  async onModuleInit() {
    if (!this.isConfigured) {
      this.logger.warn('Authentik SSO is not configured (AUTHENTIK_* env vars missing) - SSO login disabled');
      return;
    }
    try {
      await this.getClient();
      this.logger.log('Authentik SSO configured');
    } catch (error) {
      this.logger.error(
        `Failed to discover Authentik issuer at startup, will retry on first request: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async getClient(): Promise<Client> {
    if (this.client) {
      return this.client;
    }
    if (!this.isConfigured) {
      throw new ServiceUnavailableException('SSO Authentik non configuré');
    }
    if (!this.discovering) {
      this.discovering = this.discover().finally(() => {
        this.discovering = null;
      });
    }
    return this.discovering;
  }

  private async discover(): Promise<Client> {
    const issuerUrl = this.configService.getOrThrow<string>('AUTHENTIK_ISSUER_URL');
    const issuer = await Issuer.discover(issuerUrl);
    this.client = new issuer.Client({
      client_id: this.configService.getOrThrow<string>('AUTHENTIK_CLIENT_ID'),
      client_secret: this.configService.getOrThrow<string>('AUTHENTIK_CLIENT_SECRET'),
      redirect_uris: [this.configService.getOrThrow<string>('AUTHENTIK_REDIRECT_URI')],
      response_types: ['code'],
    });
    return this.client;
  }

  readonly generators = generators;
}
