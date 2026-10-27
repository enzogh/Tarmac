'use client';

import { useState } from 'react';
import { AlertTriangle, ArrowUpCircle, CheckCircle2, LoaderCircle } from 'lucide-react';
import { api, DnsServerGroupMemberItem, DnsServerState, DnsServerTask } from '@/lib/api';
import { Callout } from '@/components/Callout';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DnsNotice } from './useDnsPageState';

// The PowerDNS release the agent upgrades to (see the agent's upgradePdns).
const TARGET = { major: 5, minor: 1, label: '5.1' };

function parseVersion(version: string) {
  const match = /^(?:\d+:)?(\d+)\.(\d+)(?:\.(\d+))?/.exec(version);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), label: match.slice(1, 4).filter(Boolean).join('.') };
}

const isOutdated = (version: ReturnType<typeof parseVersion>) =>
  !!version && (version.major < TARGET.major || (version.major === TARGET.major && version.minor < TARGET.minor));

const TASK_LABEL: Record<string, string> = {
  lmdb: 'La migration de la base PowerDNS vers lmdb',
  upgrade: 'La mise à jour de PowerDNS',
};

/**
 * One DNS server's PowerDNS: its version, the upgrade to the release the
 * agent targets (started here, one server at a time), and any maintenance
 * task the agent couldn't complete.
 */
export function MemberPowerDns({
  groupId,
  member,
  nodeName,
  primaryState,
  setNotice,
  refreshGroups,
}: {
  groupId: string;
  member: DnsServerGroupMemberItem;
  nodeName: string;
  // The group primary's state, to suggest upgrading it first.
  primaryState: DnsServerState | null | undefined;
  setNotice: (notice: DnsNotice) => void;
  refreshGroups: () => Promise<unknown>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const state = member.node?.dnsServerState;
  if (!state?.pdnsVersion) return null;

  const version = parseVersion(state.pdnsVersion);
  const upgrade = state.tasks.upgrade;
  const upgrading = upgrade?.status === 'requested' || upgrade?.status === 'running';
  const failed = (Object.entries(state.tasks) as Array<[string, DnsServerTask | undefined]>).filter(
    ([, task]) => task?.status === 'failed',
  ) as Array<[string, DnsServerTask]>;
  const primaryOutdated = member.role === 'secondary' && isOutdated(parseVersion(primaryState?.pdnsVersion ?? ''));

  const run = async (upgradeRequested: boolean) => {
    setSending(true);
    try {
      await api.dns.groups.runMaintenance(groupId, member.nodeId, { upgrade: upgradeRequested });
      setConfirming(false);
      setNotice({
        type: 'success',
        message: upgradeRequested
          ? `Mise à jour de PowerDNS lancée sur ${nodeName}. Elle prend une à deux minutes.`
          : `Maintenance relancée sur ${nodeName}.`,
      });
      await refreshGroups();
    } catch {
      setNotice({ type: 'error', message: `La commande n'a pas pu être envoyée à ${nodeName} (serveur hors ligne ?).` });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="ml-1 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-2 text-2xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {!isOutdated(version) && <CheckCircle2 className="h-3 w-3 text-[hsl(var(--ok))]" />}
          PowerDNS {version?.label ?? state.pdnsVersion}
          {state.backend === 'lmdb' ? ' · base lmdb' : state.backend === 'gsqlite3' ? ' · base SQLite' : ''}
          {state.catalog ? ' · zones synchronisées par catalogue' : ''}
        </span>
        {upgrading ? (
          <span className="flex items-center gap-1.5 text-foreground/80">
            <LoaderCircle className="h-3 w-3 animate-spin" />
            Mise à jour vers {TARGET.label} en cours…
          </span>
        ) : (
          isOutdated(version) &&
          state.backend === 'lmdb' &&
          failed.length === 0 && (
            <Button write variant="ghost" size="sm" className="h-6 gap-1 px-2 text-2xs" onClick={() => setConfirming(true)}>
              <ArrowUpCircle className="h-3 w-3" />
              Mettre à jour vers {TARGET.label}
            </Button>
          )
        )}
      </div>

      {failed.map(([task, entry]) => {
        const gaveUp = entry.attempts >= state.maxAttempts;
        return (
          <Alert key={task} variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="space-y-2">
              <p>
                {TASK_LABEL[task] ?? 'Une maintenance PowerDNS'} a échoué sur {nodeName}
                {gaveUp
                  ? ` (${entry.attempts} essais) : l'agent ne réessaiera plus seul.`
                  : ` (essai ${entry.attempts} sur ${state.maxAttempts}) : l'agent réessaiera à son prochain redémarrage.`}{' '}
                {task === 'upgrade'
                  ? 'Le serveur a été remis sur sa version précédente, avec ses données : il continue de répondre normalement.'
                  : 'Le serveur continue de répondre avec son ancienne base.'}
              </p>
              {entry.error && (
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">Détail technique</summary>
                  <code className="mt-1 block whitespace-pre-wrap break-all font-mono text-2xs text-muted-foreground">{entry.error}</code>
                </details>
              )}
              <Button write size="sm" disabled={sending} onClick={() => void run(task === 'upgrade')}>
                Réessayer
              </Button>
            </AlertDescription>
          </Alert>
        );
      })}

      <Dialog open={confirming} onOpenChange={(open) => !sending && setConfirming(open)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              Mettre à jour PowerDNS sur {nodeName} ?
            </DialogTitle>
            <DialogDescription>
              PowerDNS {version?.label} n&apos;est plus maintenu. La mise à jour passe par la version 4.7 puis {TARGET.label}{' '}
              et prend une à deux minutes.
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li>Ce serveur cesse de répondre quelques secondes à chaque étape ; les autres serveurs du groupe prennent le relais.</li>
            <li>Ses données sont sauvegardées avant chaque étape et vérifiées après.</li>
            <li>En cas d&apos;échec, il revient automatiquement sur sa version actuelle, avec ses données.</li>
            <li>Une fois tout le groupe à jour, les secondaires récupèrent seuls les nouveaux domaines (zones de catalogue).</li>
          </ul>
          {primaryOutdated && (
            <Callout variant="warning">
              Le serveur primaire du groupe est encore en version {parseVersion(primaryState?.pdnsVersion ?? '')?.label}. Mieux
              vaut le mettre à jour en premier, puis les secondaires, un par un.
            </Callout>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setConfirming(false)} disabled={sending}>
              Annuler
            </Button>
            <Button write onClick={() => void run(true)} disabled={sending} className="gap-1.5">
              {sending && <LoaderCircle className="h-4 w-4 animate-spin" />}
              Lancer la mise à jour
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
