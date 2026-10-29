import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { isSealed, sealSecret, secretsKeyConfigured } from '../common/secret-box';
import { PrismaService } from './prisma.service';

// Encrypts, once, the secrets written in plaintext before TARMAC_SECRETS_KEY
// existed. Idempotent: rows already sealed are skipped.
@Injectable()
export class SecretsAtRestService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SecretsAtRestService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    if (!secretsKeyConfigured()) {
      this.logger.warn('TARMAC_SECRETS_KEY absent : les clés VPN, secrets TSIG et mots de passe seedbox restent en clair en base');
      return;
    }

    const profiles = await this.prisma.vpnProfile.findMany({
      select: { id: true, clientPrivateKey: true, presharedKey: true },
    });
    let sealedProfiles = 0;
    for (const profile of profiles) {
      const privateKeyPlain = profile.clientPrivateKey !== null && !isSealed(profile.clientPrivateKey);
      const presharedPlain = !isSealed(profile.presharedKey);
      if (!privateKeyPlain && !presharedPlain) continue;
      await this.prisma.vpnProfile.update({
        where: { id: profile.id },
        data: { clientPrivateKey: sealSecret(profile.clientPrivateKey), presharedKey: sealSecret(profile.presharedKey) },
      });
      sealedProfiles++;
    }

    const groups = await this.prisma.dnsServerGroup.findMany({
      where: { tsigKeySecret: { not: null } },
      select: { id: true, tsigKeySecret: true },
    });
    let sealedGroups = 0;
    for (const group of groups) {
      if (!group.tsigKeySecret || isSealed(group.tsigKeySecret)) continue;
      await this.prisma.dnsServerGroup.update({
        where: { id: group.id },
        data: { tsigKeySecret: sealSecret(group.tsigKeySecret) },
      });
      sealedGroups++;
    }

    // Seedbox / storage box passwords of migrations live in the notes JSON.
    const migrations = await this.prisma.migrationTask.findMany({
      where: { notes: { contains: 'SeedboxPassword' } },
      select: { id: true, notes: true },
    });
    let sealedMigrations = 0;
    for (const migration of migrations) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(migration.notes ?? '');
      } catch {
        continue;
      }
      if (typeof parsed !== 'object' || parsed === null) continue;
      let changed = false;
      for (const field of ['sourceSeedboxPassword', 'targetSeedboxPassword']) {
        const value = parsed[field];
        if (typeof value === 'string' && value && !isSealed(value)) {
          parsed[field] = sealSecret(value);
          changed = true;
        }
      }
      if (!changed) continue;
      await this.prisma.migrationTask.update({ where: { id: migration.id }, data: { notes: JSON.stringify(parsed) } });
      sealedMigrations++;
    }

    if (sealedProfiles || sealedGroups || sealedMigrations) {
      this.logger.log(
        `Secrets chiffrés au repos : ${sealedProfiles} profil(s) VPN, ${sealedGroups} groupe(s) DNS, ${sealedMigrations} migration(s)`,
      );
    }
  }
}
