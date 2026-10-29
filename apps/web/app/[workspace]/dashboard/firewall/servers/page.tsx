'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Ban, Eye, LoaderCircle, Plus, Radar, ShieldCheck } from 'lucide-react';
import { Callout } from '@/components/Callout';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api, FirewallMode } from '@/lib/api';
import { useReadOnly } from '@/lib/read-only';
import { cn } from '@/lib/utils';
import { useFirewall, useRuleActions } from '../components/FirewallContext';
import { FwSection } from '../components/fw-ui';
import { AccessMatrix, ModeSelector, RulesTable, SystemFlows } from '../components/MeshPanels';

function Journey({ mode, onStep }: { mode: FirewallMode; onStep: (step: 'observe' | 'activity' | 'enforce') => void }) {
  const steps = [
    { id: 'observe', title: 'Observer', text: 'Rien n’est coupé : Tarmac note ce qui serait bloqué.', done: mode !== 'open' },
    { id: 'activity', title: 'Autoriser le légitime', text: 'Depuis Activité, en un clic par connexion.', done: mode === 'enforce' },
    { id: 'enforce', title: 'Appliquer', text: 'Seul ce qui est autorisé passe désormais.', done: mode === 'enforce' },
  ] as const;
  const current = steps.findIndex((step) => !step.done);
  return (
    <ol className="grid gap-2 sm:grid-cols-3">
      {steps.map((step, index) => (
        <li key={step.id}>
          <button
            type="button"
            onClick={() => onStep(step.id)}
            className={cn(
              'flex h-full w-full items-start gap-3 rounded-lg border p-3.5 text-left transition-colors',
              index === current ? 'border-primary/40 bg-primary/[0.06] hover:border-primary/60' : 'border-border bg-surface-2 hover:border-primary/30',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                step.done ? 'bg-[hsl(var(--ok))]/20 text-[hsl(var(--ok))]' : index === current ? 'bg-primary text-primary-foreground' : 'bg-surface-3 text-muted-foreground',
              )}
            >
              {step.done ? '✓' : index + 1}
            </span>
            <span>
              <span className="block text-sm font-medium text-foreground">{step.title}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{step.text}</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

export default function FirewallServersPage() {
  const { workspace } = useParams<{ workspace: string }>();
  const activity = `/${workspace}/dashboard/firewall/activity`;
  const { data, replace, notify, fail, openRule, openTest } = useFirewall();
  const onRuleAction = useRuleActions();
  const { readOnly } = useReadOnly();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const mode = data.settings.meshMode;
  const meshNodes = data.nodes.filter((node) => node.vlanIp);
  const rules = data.rules.filter((rule) => rule.scope === 'mesh');
  const cut = data.matrix.filter((cell) => cell.status === 'blocked' || cell.status === 'observed').length;

  const setMode = async (next: FirewallMode) => {
    setBusy(true);
    try {
      replace(await api.firewall.updateSettings({ meshMode: next }));
      notify({
        tone: 'success',
        message:
          next === 'enforce'
            ? 'Pare-feu appliqué entre vos serveurs : seules les connexions autorisées passent.'
            : next === 'observe'
              ? 'Mode observation activé : les connexions qui seraient bloquées apparaissent dans Activité.'
              : 'Réseau privé repassé en mode ouvert : seules vos règles de blocage s’appliquent.',
      });
    } catch (caught) {
      fail(caught, 'Le changement de mode a échoué.');
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };
  const onMode = (next: FirewallMode) => (next === 'enforce' ? setConfirm(true) : void setMode(next));

  const examples = [
    {
      title: 'Isoler un serveur suspect',
      text: 'Coupe tout ce qu’un serveur peut ouvrir vers les autres.',
      onUse: () => openRule({ draft: { scope: 'mesh', action: 'deny', sourceKind: 'nodes', protocol: 'any', ports: [], name: 'Isoler un serveur' } }),
    },
    {
      title: 'Réserver SSH à un bastion',
      text: 'Seul le serveur choisi peut se connecter en SSH aux autres.',
      onUse: () => openRule({ draft: { scope: 'mesh', action: 'allow', sourceKind: 'nodes', protocol: 'tcp', ports: ['22'], name: 'SSH depuis le bastion' } }),
    },
    {
      title: 'Protéger une base de données',
      text: 'PostgreSQL joignable seulement depuis vos serveurs applicatifs.',
      onUse: () => openRule({ draft: { scope: 'mesh', action: 'allow', sourceKind: 'labels', targetKind: 'labels', protocol: 'tcp', ports: ['5432'] } }),
    },
  ];

  return (
    <>
      <PageHeader
        title="Entre serveurs"
        description="Le trafic qui circule entre vos serveurs sur le réseau privé Tarmac : qui peut joindre qui, et sur quels services."
        actionsReadOnlySafe
        actions={
          <>
            <Button variant="secondary" className="gap-1.5" onClick={() => openTest({ scope: 'mesh' })} disabled={meshNodes.length < 2}>
              <Radar className="h-4 w-4" />
              Tester une connexion
            </Button>
            <Button write className="gap-1.5" onClick={() => openRule({ draft: { scope: 'mesh' } })} disabled={meshNodes.length === 0}>
              <Plus className="h-4 w-4" />
              Nouvelle règle
            </Button>
          </>
        }
      />

      <FwSection title="Niveau de protection" description="Les règles de blocage s’appliquent dans tous les modes. Commencez par l’observation pour ne rien casser.">
        <Card>
          <CardContent className="space-y-5 p-5">
            <ModeSelector value={mode} onChange={onMode} scope="mesh" busy={busy} />
            {mode !== 'enforce' && (
              <div className="space-y-2.5 border-t border-border pt-5">
                <p className="text-sm font-medium text-foreground">Le parcours conseillé</p>
                <Journey
                  mode={mode}
                  onStep={(step) => {
                    if (step === 'activity') router.push(activity);
                    else if (readOnly) return;
                    else if (step === 'observe' && mode === 'open') void setMode('observe');
                    else if (step === 'enforce') setConfirm(true);
                  }}
                />
              </div>
            )}
          </CardContent>
        </Card>
        {mode === 'observe' && data.stats.observed24h > 0 && (
          <Callout variant="info">
            {data.stats.observed24h.toLocaleString('fr-FR')} connexion(s) auraient été bloquées ces dernières 24 h.{' '}
            <Link href={activity} className="underline">
              Passez-les en revue
            </Link>{' '}
            avant d’appliquer.
          </Callout>
        )}
      </FwSection>

      <FwSection title="Qui peut joindre qui" description="Chaque case résume un trajet d’un serveur vers un autre. Cliquez dessus pour le détail, le tester ou le modifier.">
        <AccessMatrix
          nodes={data.nodes}
          cells={data.matrix}
          mode={mode}
          onTest={(sourceNodeId, targetNodeId) => openTest({ scope: 'mesh', sourceNodeId, targetNodeId })}
          onCreateRule={(action, sourceNodeId, targetNodeId) =>
            openRule({
              draft: {
                scope: 'mesh',
                action,
                sourceKind: 'nodes',
                sourceNodeIds: [sourceNodeId],
                targetKind: 'nodes',
                targetNodeIds: [targetNodeId],
                protocol: action === 'deny' ? 'any' : 'tcp',
                ports: action === 'deny' ? [] : ['22'],
              },
            })
          }
        />
      </FwSection>

      <FwSection
        title="Règles"
        description="Les blocages passent toujours avant les autorisations."
        actions={
          rules.length > 0 ? (
            <Button write size="sm" variant="secondary" className="gap-1.5" onClick={() => openRule({ draft: { scope: 'mesh' } })}>
              <Plus className="h-3.5 w-3.5" />
              Ajouter
            </Button>
          ) : undefined
        }
      >
        <RulesTable
          rules={rules}
          nodes={data.nodes}
          scope="mesh"
          mode={mode}
          onAction={(rule, action) => void onRuleAction(rule, action)}
          onCreate={() => openRule({ draft: { scope: 'mesh' } })}
          examples={examples}
        />
        <SystemFlows flows={data.system} nodes={data.nodes} scope="mesh" />
      </FwSection>

      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Appliquer le pare-feu entre serveurs ?</DialogTitle>
            <DialogDescription>Seules les connexions autorisées passeront. Les sessions déjà ouvertes ne sont pas coupées.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {mode === 'open' && (
              <Callout variant="warning">
                Le réseau n’est pas passé par le mode observation : vous ne savez pas encore quelles connexions légitimes seraient coupées. Observez quelques
                heures d’abord.
              </Callout>
            )}
            <ul className="space-y-2 text-foreground">
              <li className="flex items-center gap-2">
                <Ban className="h-4 w-4 shrink-0 text-[hsl(var(--danger))]" />
                {cut} trajet(s) entre serveurs n’auront plus aucun accès (hors ping de supervision).
              </li>
              {data.stats.observed24h > 0 && (
                <li className="flex items-center gap-2">
                  <Eye className="h-4 w-4 shrink-0 text-[hsl(var(--info))]" />
                  {data.stats.observed24h.toLocaleString('fr-FR')} connexion(s) observée(s) en 24 h auraient été bloquées.
                </li>
              )}
              <li className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 text-[hsl(var(--ok))]" />
                Les flux de Tarmac (synchronisations, montages, DNS, VPN) restent autorisés.
              </li>
            </ul>
          </div>
          <DialogFooter>
            <Button variant="secondary" asChild>
              <Link href={activity}>Voir l’activité d’abord</Link>
            </Button>
            <Button write onClick={() => void setMode('enforce')} disabled={busy} className="gap-1.5">
              {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
              Appliquer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
