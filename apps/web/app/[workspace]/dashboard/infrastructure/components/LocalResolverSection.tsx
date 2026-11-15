'use client';

import { useEffect, useState } from 'react';
import { FileText, LoaderCircle, Power, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/Callout';
import type { ForwarderConflictAction, NodeActivityItem } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { InternalDnsState } from './node-ui';

type Conflict = NonNullable<NodeActivityItem['internalDnsForwarderConflict']>;

function serviceName(unit: string) {
  return unit.replace(/\.service$/, '');
}

/** Who holds port 53, in plain words ("le service unbound"). */
function holderLabel(conflict: Conflict | null | undefined) {
  if (!conflict) return 'un autre programme';
  if (conflict.container) return `le conteneur Docker « ${conflict.container} »`;
  if (conflict.unit) return `le service ${serviceName(conflict.unit)}`;
  if (conflict.processName) return `le programme ${conflict.processName}${conflict.pid ? ` (pid ${conflict.pid})` : ''}`;
  return 'un autre programme';
}

/** The agent's failure reasons are technical English: say what they mean. */
function friendlyError(error: string) {
  if (/no service to stop/i.test(error)) return 'aucun service à arrêter n’a été trouvé pour ce programme. Utilisez /etc/hosts.';
  if (/still held/i.test(error)) return 'le port 53 est toujours occupé après l’arrêt du service.';
  if (/could not stop/i.test(error)) return 'le service n’a pas pu être arrêté.';
  if (/dnsmasq/i.test(error)) return 'le résolveur local (dnsmasq) n’a pas pu être installé ou démarré.';
  if (/hosts/i.test(error)) return 'le fichier /etc/hosts n’a pas pu être modifié.';
  return null;
}

function ErrorLine({ error }: { error: string }) {
  const friendly = friendlyError(error);
  return (
    <div className="space-y-1 rounded-lg border border-rose-500/20 bg-rose-500/[0.06] px-3 py-2 text-xs text-rose-200/90">
      <p>La dernière tentative a échoué{friendly ? ` : ${friendly}` : '.'}</p>
      <p className="break-all font-mono text-2xs text-rose-200/60">{error}</p>
    </div>
  );
}

function Choice({
  icon: Icon,
  title,
  recommended,
  children,
  action,
}: {
  icon: typeof FileText;
  title: string;
  recommended?: boolean;
  children: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <div className={cn('rounded-xl border bg-surface-1 p-3', recommended ? 'border-primary/30' : 'border-border')}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-2">
          <Icon className="h-3.5 w-3.5 text-primary" />
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
            {title}
            {recommended && <Badge label="Recommandé" />}
          </div>
          <div className="text-xs text-muted-foreground">{children}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">{action}</div>
    </div>
  );
}

/**
 * How this node resolves *.tarmac.local, and the ways out of a port-53
 * conflict: resolve from /etc/hosts (always possible, touches nothing),
 * or stop the service holding the port so the local resolver can start.
 */
export function LocalResolverSection({
  node,
  internalDns,
  busy,
  onResolve,
}: {
  node: NodeActivityItem;
  internalDns: InternalDnsState | undefined;
  busy: boolean;
  onResolve: (action: ForwarderConflictAction) => void;
}) {
  const [confirmStop, setConfirmStop] = useState(false);
  useEffect(() => setConfirmStop(false), [node.id, node.internalDnsForwarderStatus]);

  const status = node.internalDnsForwarderStatus;
  const conflict = node.internalDnsForwarderConflict;
  const error = node.internalDnsForwarderError;
  const offline = node.status === 'offline';
  const disabled = busy || offline;
  const spinner = busy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null;

  if (!internalDns?.internalDnsNodeId) {
    return <Note>Aucun DNS interne configuré dans la flotte.</Note>;
  }

  if (status === 'pending') {
    return (
      <Note>
        <span className="flex items-center gap-2">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />
          Correction en cours : l’agent applique votre choix, le résultat s’affiche ici dans quelques secondes.
        </span>
      </Note>
    );
  }

  if (status === 'conflict') {
    const holder = holderLabel(conflict);
    return (
      <div className="space-y-3">
        <Callout variant="warning">
          <p className="font-medium">Le port 53 local est déjà utilisé</p>
          <p className="mt-1 text-xs text-amber-200/80">
            {holder.charAt(0).toUpperCase() + holder.slice(1)} écoute sur 127.0.0.1:53 : le résolveur que Tarmac installe sur ce
            nœud ne peut pas démarrer, donc les noms <span className="font-mono">*.tarmac.local</span> ne s’y résolvent pas.
            Choisissez comment corriger.
          </p>
        </Callout>

        <Choice
          icon={FileText}
          title="Résoudre via /etc/hosts"
          recommended
          action={
            <Button write size="sm" disabled={disabled} onClick={() => onResolve('hosts')} className="gap-1.5">
              {spinner}
              Utiliser /etc/hosts
            </Button>
          }
        >
          Ne touche pas à {holder}. Tarmac écrit les noms du réseau privé dans /etc/hosts et les tient à jour tout seul.
        </Choice>

        {conflict?.unit ? (
          <Choice
            icon={Power}
            title={`Arrêter ${serviceName(conflict.unit)}`}
            action={
              confirmStop ? (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmStop(false)} disabled={busy}>
                    Annuler
                  </Button>
                  <Button
                    write
                    size="sm"
                    variant="destructive"
                    disabled={disabled}
                    onClick={() => onResolve('stop_service')}
                    className="gap-1.5"
                  >
                    {spinner}
                    Confirmer l’arrêt définitif
                  </Button>
                </>
              ) : (
                <Button write size="sm" variant="secondary" disabled={disabled} onClick={() => setConfirmStop(true)}>
                  Arrêter le service…
                </Button>
              )
            }
          >
            {confirmStop ? (
              <span className="text-amber-200/90">
                {serviceName(conflict.unit)} sera arrêté, désactivé et bloqué, y compris après un redémarrage. Tout ce qui
                l’utilise sur ce nœud cessera de fonctionner.
              </span>
            ) : (
              <>Libère le port pour le résolveur local. À choisir seulement si ce service ne vous sert pas.</>
            )}
          </Choice>
        ) : (
          <Choice
            icon={RotateCcw}
            title="Libérer le port vous-même"
            action={
              <Button write size="sm" variant="secondary" disabled={disabled} onClick={() => onResolve('local')} className="gap-1.5">
                {spinner}
                Réessayer
              </Button>
            }
          >
            {conflict?.container ? (
              <>
                Tarmac n’arrête pas un conteneur à votre place. Pour garder le résolveur local, publiez le port 53 du conteneur «{' '}
                {conflict.container} » sur une autre adresse que 127.0.0.1 (l’adresse publique par exemple), puis réessayez.
              </>
            ) : (
              <>Ce programme ne tourne pas comme un service que Tarmac peut arrêter. Arrêtez-le sur le nœud, puis réessayez.</>
            )}
          </Choice>
        )}

        {error && <ErrorLine error={error} />}
        {offline && <p className="text-2xs text-muted-foreground">Le nœud est hors ligne : la correction sera possible à son retour.</p>}
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="space-y-2">
        <Note>Le résolveur local de ce nœud n’a pas pu être installé : les noms *.tarmac.local ne s’y résolvent pas.</Note>
        {error && <ErrorLine error={error} />}
        <div className="flex flex-wrap gap-2">
          <Button write size="sm" variant="secondary" disabled={disabled} onClick={() => onResolve('local')} className="gap-1.5">
            {spinner ?? <RotateCcw className="h-3.5 w-3.5" />}
            Réessayer
          </Button>
          <Button write size="sm" variant="ghost" disabled={disabled} onClick={() => onResolve('hosts')} className="gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Utiliser /etc/hosts à la place
          </Button>
        </div>
      </div>
    );
  }

  if (status === 'unreachable') {
    return (
      <Note>
        Ce nœud n’obtient aucune réponse du serveur DNS interne (port 5300 sur le réseau privé) : *.tarmac.local ne se résout
        pas ici. Vérifiez le pare-feu du nœud DNS.
      </Note>
    );
  }

  if (status === 'active') {
    if (node.internalDnsForwarderMode === 'hosts_auto') {
      return (
        <Note>
          Ce nœud résout *.tarmac.local via /etc/hosts : son serveur DNS public occupe déjà le port 53. Les noms du réseau privé y
          sont mis à jour automatiquement.
        </Note>
      );
    }
    if (node.internalDnsForwarderMode === 'hosts') {
      return (
        <div className="space-y-2">
          <Note>
            Ce nœud résout *.tarmac.local via /etc/hosts, comme vous l’avez choisi : les noms du réseau privé y sont écrits et mis à
            jour automatiquement, sans toucher au port 53.
          </Note>
          <Button write size="sm" variant="ghost" disabled={disabled} onClick={() => onResolve('local')} className="gap-1.5">
            {spinner ?? <RotateCcw className="h-3.5 w-3.5" />}
            Revenir au résolveur local
          </Button>
        </div>
      );
    }
    return (
      <Note>
        Ce nœud résout *.tarmac.local
        {node.internalDnsForwarderMode === 'resolved'
          ? ' via systemd-resolved'
          : node.internalDnsForwarderMode === 'dnsmasq'
            ? ' via son résolveur local'
            : ''}{' '}
        : le serveur DNS interne répond.
      </Note>
    );
  }

  return <Note>En attente du premier rapport de l’agent sur la résolution de *.tarmac.local.</Note>;
}

function Note({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-border bg-surface-2/40 px-3 py-2 text-xs text-muted-foreground">{children}</div>;
}
