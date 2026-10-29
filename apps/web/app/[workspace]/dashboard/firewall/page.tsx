'use client';

import { useMemo, useRef, useState } from 'react';
import { Activity, Ban, BrickWallFire, Eye, Globe2, LoaderCircle, Network, Plus, Radar, ShieldAlert, ShieldCheck } from 'lucide-react';
import { Callout } from '@/components/Callout';
import { PageHeader } from '@/components/PageHeader';
import { SectionLabel } from '@/components/SectionLabel';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CardListSkeleton, StatCardSkeleton } from '@/components/ui/skeleton';
import { Stat, StatRow } from '@/components/ui/stat';
import { StatusPill } from '@/components/ui/status';
import { Tabs, TabsCount, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, FirewallMode, FirewallNode, FirewallOverview, FirewallRule } from '@/lib/api';
import { usePolling } from '@/lib/hooks/usePolling';
import { useLiveSocket } from '@/lib/hooks/useLiveSocket';
import { useReadOnly } from '@/lib/read-only';
import { cn } from '@/lib/utils';
import { ActivityPanel } from './components/ActivityPanel';
import { MODE_INFO, Switch } from './components/fw-ui';
import { AccessMatrix, ModeSelector, RuleAction, RulesTable, SystemFlows } from './components/MeshPanels';
import { EnforcePreflight, PublicNodeCard } from './components/PublicPanels';
import { RuleDialog, RuleDraft } from './components/RuleDialog';
import { TestDialog, TestPreset } from './components/TestDialog';

type View = 'mesh' | 'public' | 'activity';
type Notice = { tone: 'success' | 'danger'; message: string };

function Journey({ mode, onStep }: { mode: FirewallMode; onStep: (step: 'observe' | 'activity' | 'enforce') => void }) {
  const steps = [
    { id: 'observe', title: 'Observer', text: 'Rien n’est coupé : Tarmac note ce qui serait bloqué.', done: mode !== 'open' },
    { id: 'activity', title: 'Autoriser le légitime', text: 'Depuis l’onglet Activité, en un clic par flux.', done: mode === 'enforce' },
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
              'flex h-full w-full items-start gap-2.5 rounded-lg border p-3 text-left transition-colors',
              index === current ? 'border-primary/40 bg-primary/[0.06] hover:border-primary/60' : 'border-border bg-surface-2 hover:border-primary/30',
            )}
          >
            <span
              className={cn(
                'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-2xs font-semibold',
                step.done ? 'bg-[hsl(var(--ok))]/20 text-[hsl(var(--ok))]' : index === current ? 'bg-primary text-primary-foreground' : 'bg-surface-3 text-muted-foreground',
              )}
            >
              {step.done ? '✓' : index + 1}
            </span>
            <span>
              <span className="block text-sm font-medium text-foreground">{step.title}</span>
              <span className="block text-xs text-muted-foreground">{step.text}</span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

function MeshEnforceDialog({
  open,
  overview,
  onOpenChange,
  onConfirm,
  onReview,
  busy,
}: {
  open: boolean;
  overview: FirewallOverview;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  onReview: () => void;
  busy: boolean;
}) {
  const cut = overview.matrix.filter((cell) => cell.status === 'blocked' || cell.status === 'observed').length;
  const neverObserved = overview.settings.meshMode === 'open';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Appliquer le pare-feu entre serveurs ?</DialogTitle>
          <DialogDescription>Seules les connexions autorisées passeront. Les sessions déjà ouvertes ne sont pas coupées.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {neverObserved && (
            <Callout variant="warning">
              Le réseau n’est pas passé par le mode observation : vous ne savez pas encore quelles connexions légitimes seraient coupées. Nous
              vous conseillons d’observer quelques heures d’abord.
            </Callout>
          )}
          <ul className="space-y-1.5 text-foreground">
            <li className="flex items-center gap-2">
              <Ban className="h-4 w-4 text-[hsl(var(--danger))]" />
              {cut} trajet(s) entre serveurs n’auront plus aucun accès (hors ping de supervision).
            </li>
            {overview.stats.observed24h > 0 && (
              <li className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-[hsl(var(--info))]" />
                {overview.stats.observed24h.toLocaleString('fr-FR')} connexion(s) observée(s) ces dernières 24 h auraient été bloquées.
              </li>
            )}
            <li className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[hsl(var(--ok))]" />
              Les flux de Tarmac (synchronisations, montages, DNS, VPN) restent autorisés automatiquement.
            </li>
          </ul>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onReview}>
            Voir l’activité d’abord
          </Button>
          <Button write onClick={onConfirm} disabled={busy} className="gap-1.5">
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
            Appliquer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function FirewallPage() {
  const { data, mutate, isLoading } = usePolling('firewall-overview', api.firewall.overview, { intervalMs: 10000 });
  useLiveSocket((message) => {
    if (message.type === 'firewall.changed' || message.type === 'firewall.events') void mutate();
  });
  const { readOnly } = useReadOnly();

  const [view, setView] = useState<View>('mesh');
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>();
  const [ruleDialog, setRuleDialog] = useState<{ rule?: FirewallRule | null; draft?: RuleDraft | null } | null>(null);
  const [testPreset, setTestPreset] = useState<TestPreset | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [meshConfirm, setMeshConfirm] = useState(false);
  const [preflight, setPreflight] = useState<{ node: FirewallNode; mode: FirewallMode } | null>(null);
  const [busy, setBusy] = useState(false);

  const showNotice = (next: Notice) => {
    setNotice(next);
    clearTimeout(noticeTimer.current);
    if (next.tone === 'success') noticeTimer.current = setTimeout(() => setNotice(null), 6000);
  };
  const fail = (caught: unknown, fallback: string) => showNotice({ tone: 'danger', message: caught instanceof Error ? caught.message : fallback });

  const nodes = data?.nodes ?? [];
  const meshRules = useMemo(() => data?.rules.filter((rule) => rule.scope === 'mesh') ?? [], [data]);
  const publicRules = useMemo(() => data?.rules.filter((rule) => rule.scope === 'public') ?? [], [data]);
  const meshNodes = nodes.filter((node) => node.vlanIp);
  const exposedEverywhere = nodes.flatMap((node) => (node.report?.listening ?? []).filter((entry) => entry.exposure === 'public' && !entry.managedBy));
  const attention = nodes.filter((node) => node.apply.status === 'error' || node.apply.status === 'outdated');

  const openRule = (draft: RuleDraft) => {
    setTestOpen(false);
    setRuleDialog({ draft });
  };

  const setMeshMode = async (mode: FirewallMode) => {
    setBusy(true);
    try {
      await mutate(await api.firewall.updateSettings({ meshMode: mode }), { revalidate: false });
      showNotice({
        tone: 'success',
        message:
          mode === 'enforce'
            ? 'Pare-feu appliqué entre vos serveurs : seules les connexions autorisées passent.'
            : mode === 'observe'
              ? 'Mode observation activé : les connexions qui seraient bloquées apparaissent dans l’onglet Activité.'
              : 'Réseau privé repassé en mode ouvert : seules vos règles de blocage s’appliquent.',
      });
    } catch (caught) {
      fail(caught, 'Le changement de mode a échoué.');
    } finally {
      setBusy(false);
      setMeshConfirm(false);
    }
  };

  const onMeshMode = (mode: FirewallMode) => {
    if (mode === 'enforce') setMeshConfirm(true);
    else void setMeshMode(mode);
  };

  const onPublicMode = async (node: FirewallNode, mode: FirewallMode) => {
    if (mode !== 'open') {
      setPreflight({ node, mode });
      return;
    }
    setBusy(true);
    try {
      await mutate(await api.firewall.setNodesMode([node.id], mode), { revalidate: false });
      showNotice({ tone: 'success', message: `${node.name} n’est plus filtré depuis Internet (hors règles de blocage).` });
    } catch (caught) {
      fail(caught, 'Le changement a échoué.');
    } finally {
      setBusy(false);
    }
  };

  const setSetting = async (patch: Partial<FirewallOverview['settings']>) => {
    if (patch.sshGuard === false) {
      const ok = window.confirm(
        'Désactiver la protection anti-verrouillage ?\n\nSur les serveurs filtrés, SSH ne sera plus joignable depuis Internet sauf si une règle l’autorise. Vérifiez d’avoir une règle SSH (par exemple depuis l’adresse de votre bureau) avant de continuer.',
      );
      if (!ok) return;
    }
    try {
      await mutate(await api.firewall.updateSettings(patch), { revalidate: false });
    } catch (caught) {
      fail(caught, 'Le réglage n’a pas été enregistré.');
    }
  };

  const onRuleAction = async (rule: FirewallRule, action: RuleAction) => {
    try {
      if (action === 'edit') setRuleDialog({ rule });
      if (action === 'duplicate') {
        const { id: _id, expired: _e, inert: _i, service: _s, hitCount: _h, lastHitAt: _l, createdAt: _c, updatedAt: _u, expiresAt: _x, ...rest } = rule;
        setRuleDialog({ draft: { ...rest, name: `${rule.name} (copie)`.slice(0, 80) } });
      }
      if (action === 'toggle') {
        const enable = !rule.enabled || rule.expired;
        await api.firewall.updateRule(rule.id, enable && rule.expired ? { enabled: true, expiresAt: null } : { enabled: enable });
        showNotice({ tone: 'success', message: enable ? `« ${rule.name} » est réactivée.` : `« ${rule.name} » est désactivée.` });
        await mutate();
      }
      if (action === 'delete') {
        if (!window.confirm(`Supprimer la règle « ${rule.name} » ? Elle est retirée des serveurs dans les secondes qui suivent.`)) return;
        await api.firewall.removeRule(rule.id);
        showNotice({ tone: 'success', message: `Règle « ${rule.name} » supprimée.` });
        await mutate();
      }
    } catch (caught) {
      fail(caught, 'L’action a échoué.');
    }
  };

  const meshExamples = [
    {
      title: 'Isoler un serveur suspect',
      text: 'Coupe tout ce qu’un serveur peut ouvrir vers les autres.',
      onUse: () => openRule({ scope: 'mesh', action: 'deny', sourceKind: 'nodes', protocol: 'any', ports: [], name: 'Isoler un serveur' }),
    },
    {
      title: 'Réserver SSH à un bastion',
      text: 'Seul le serveur choisi peut se connecter en SSH aux autres.',
      onUse: () => openRule({ scope: 'mesh', action: 'allow', sourceKind: 'nodes', protocol: 'tcp', ports: ['22'], name: 'SSH depuis le bastion' }),
    },
    {
      title: 'Protéger une base de données',
      text: 'PostgreSQL joignable seulement depuis vos serveurs applicatifs.',
      onUse: () => openRule({ scope: 'mesh', action: 'allow', sourceKind: 'labels', targetKind: 'labels', protocol: 'tcp', ports: ['5432'] }),
    },
  ];
  const publicExamples = [
    {
      title: 'Ouvrir un site web',
      text: 'HTTP et HTTPS joignables par tout Internet.',
      onUse: () => openRule({ scope: 'public', action: 'allow', sourceKind: 'any', targetKind: 'nodes', protocol: 'tcp', ports: ['80', '443'] }),
    },
    {
      title: 'SSH depuis mon bureau',
      text: 'Administration réservée à une adresse IP connue.',
      onUse: () => openRule({ scope: 'public', action: 'allow', sourceKind: 'cidrs', protocol: 'tcp', ports: ['22'], name: 'SSH depuis le bureau' }),
    },
    {
      title: 'Bannir une adresse',
      text: 'Bloque tout le trafic d’une IP ou d’une plage abusive.',
      onUse: () => openRule({ scope: 'public', action: 'deny', sourceKind: 'cidrs', protocol: 'any', ports: [], name: 'Adresse bannie' }),
    },
  ];

  const meshMode = data?.settings.meshMode ?? 'open';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pare-feu"
        description="Choisissez qui peut joindre vos serveurs : entre eux sur le réseau privé, et depuis Internet. Les règles sont appliquées par chaque serveur protégé."
        meta={
          data ? (
            <StatusPill tone={MODE_INFO[meshMode].tone}>Réseau privé : {MODE_INFO[meshMode].title.toLowerCase()}</StatusPill>
          ) : undefined
        }
        actionsReadOnlySafe
        actions={
          <>
            <Button
              variant="secondary"
              className="gap-1.5"
              onClick={() => {
                setTestPreset({ scope: view === 'public' ? 'public' : 'mesh' });
                setTestOpen(true);
              }}
              disabled={!data || nodes.length === 0}
            >
              <Radar className="h-4 w-4" />
              Tester une connexion
            </Button>
            <Button
              write
              className="gap-1.5"
              onClick={() => setRuleDialog({ draft: { scope: view === 'public' ? 'public' : 'mesh' } })}
              disabled={!data || nodes.length === 0}
            >
              <Plus className="h-4 w-4" />
              Nouvelle règle
            </Button>
          </>
        }
      />

      {notice && <Callout variant={notice.tone}>{notice.message}</Callout>}

      {isLoading && !data ? (
        <>
          <StatRow>
            {Array.from({ length: 4 }).map((_, index) => (
              <StatCardSkeleton key={index} />
            ))}
          </StatRow>
          <CardListSkeleton cards={2} />
        </>
      ) : !data ? (
        <Callout variant="danger">Impossible de charger le pare-feu pour le moment. Réessayez dans quelques instants.</Callout>
      ) : nodes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <BrickWallFire className="h-6 w-6 text-primary" />
            </div>
            <h2 className="text-base font-semibold text-foreground">Aucun serveur à protéger pour l’instant</h2>
            <p className="max-w-md text-sm text-muted-foreground">Ajoutez un premier nœud depuis la page Nœuds : son pare-feu se pilotera ensuite d’ici.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <StatRow className="animate-fade-in">
            <Stat
              label="Réseau privé"
              value={MODE_INFO[meshMode].title}
              icon={Network}
              tone={meshMode === 'enforce' ? 'ok' : meshMode === 'observe' ? 'info' : 'neutral'}
              hint={
                meshMode === 'open'
                  ? `${meshRules.filter((rule) => rule.action === 'deny' && rule.enabled).length} blocage(s) actif(s)`
                  : `${meshNodes.length} serveur(s) concerné(s)`
              }
            />
            <Stat
              label="Serveurs filtrés"
              value={data.stats.protectedNodes}
              unit={`/ ${nodes.length}`}
              icon={ShieldCheck}
              tone={attention.length > 0 ? 'warn' : data.stats.protectedNodes > 0 ? 'ok' : 'neutral'}
              hint={attention.length > 0 ? `${attention.length} à vérifier` : `${data.stats.rules} règle(s) active(s)`}
            />
            <Stat
              label="Bloquées (24 h)"
              value={data.stats.blocked24h.toLocaleString('fr-FR')}
              icon={Ban}
              tone={data.stats.blocked24h > 0 ? 'danger' : 'neutral'}
              hint={data.stats.observed24h > 0 ? `+ ${data.stats.observed24h.toLocaleString('fr-FR')} observée(s)` : 'Tentatives refusées'}
            />
            <Stat
              label="Ports ouverts à tous"
              value={exposedEverywhere.length}
              icon={ShieldAlert}
              tone={exposedEverywhere.length > 0 ? 'warn' : 'ok'}
              hint={exposedEverywhere.length > 0 ? 'Hors SSH et services Tarmac' : 'Seuls SSH et les services Tarmac'}
            />
          </StatRow>

          {attention.length > 0 && (
            <Callout variant="warning">
              {attention.map((node) => node.name).join(', ')} : {attention[0].apply.message ?? 'le pare-feu n’a pas pu être appliqué.'}
            </Callout>
          )}

          <Tabs value={view} onValueChange={(value) => setView(value as View)}>
            <TabsList>
              <TabsTrigger value="mesh">
                <Network />
                Entre serveurs <TabsCount>{meshRules.length}</TabsCount>
              </TabsTrigger>
              <TabsTrigger value="public">
                <Globe2 />
                Depuis Internet <TabsCount>{publicRules.length}</TabsCount>
              </TabsTrigger>
              <TabsTrigger value="activity">
                <Activity />
                Activité <TabsCount>{(data.stats.blocked24h + data.stats.observed24h).toLocaleString('fr-FR')}</TabsCount>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {view === 'mesh' && (
            <div className="space-y-4 animate-fade-in">
              <Card>
                <CardContent className="space-y-4 p-4">
                  <div>
                    <h2 className="text-sm font-medium text-foreground">Mode du réseau privé</h2>
                    <p className="text-xs text-muted-foreground">
                      S’applique au trafic entre vos {meshNodes.length} serveur(s) reliés par le réseau privé Tarmac. Les règles de blocage
                      s’appliquent dans tous les modes.
                    </p>
                  </div>
                  <ModeSelector value={meshMode} onChange={onMeshMode} scope="mesh" busy={busy} />
                  {meshMode !== 'enforce' && (
                    <div className="space-y-2 border-t border-border pt-4">
                      <p className="text-2xs font-medium uppercase tracking-wider text-muted-foreground">Parcours conseillé</p>
                      <Journey
                        mode={meshMode}
                        onStep={(step) => {
                          if (readOnly && step !== 'activity') return;
                          if (step === 'observe' && meshMode === 'open') void setMeshMode('observe');
                          if (step === 'activity') setView('activity');
                          if (step === 'enforce') setMeshConfirm(true);
                        }}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>

              {meshMode === 'open' && meshRules.length === 0 && meshNodes.length > 1 && (
                <Callout variant="warning">
                  Aujourd’hui, chacun de vos {meshNodes.length} serveurs peut ouvrir n’importe quelle connexion vers les autres, SSH compris.
                  Un seul serveur compromis donne donc accès à tout le réseau. Commencez par le mode observation pour voir qui parle à qui.
                </Callout>
              )}
              {meshMode === 'observe' && data.stats.observed24h > 0 && (
                <Callout variant="info">
                  {data.stats.observed24h.toLocaleString('fr-FR')} connexion(s) auraient été bloquées ces dernières 24 h.{' '}
                  <button type="button" className="underline" onClick={() => setView('activity')}>
                    Passez-les en revue
                  </button>{' '}
                  et autorisez celles qui sont légitimes avant d’appliquer.
                </Callout>
              )}

              <AccessMatrix
                nodes={nodes}
                cells={data.matrix}
                mode={meshMode}
                onTest={(sourceNodeId, targetNodeId) => {
                  setTestPreset({ scope: 'mesh', sourceNodeId, targetNodeId });
                  setTestOpen(true);
                }}
                onCreateRule={(action, sourceNodeId, targetNodeId) =>
                  openRule({
                    scope: 'mesh',
                    action,
                    sourceKind: 'nodes',
                    sourceNodeIds: [sourceNodeId],
                    targetKind: 'nodes',
                    targetNodeIds: [targetNodeId],
                    protocol: action === 'deny' ? 'any' : 'tcp',
                    ports: action === 'deny' ? [] : ['22'],
                  })
                }
              />

              <SectionLabel
                actions={
                  <Button write size="sm" variant="secondary" className="gap-1.5" onClick={() => setRuleDialog({ draft: { scope: 'mesh' } })}>
                    <Plus className="h-3.5 w-3.5" />
                    Règle
                  </Button>
                }
              >
                Règles entre serveurs
              </SectionLabel>
              <RulesTable
                rules={meshRules}
                nodes={nodes}
                scope="mesh"
                mode={meshMode}
                onAction={(rule, action) => void onRuleAction(rule, action)}
                onCreate={() => setRuleDialog({ draft: { scope: 'mesh' } })}
                examples={meshExamples}
              />
              <SystemFlows flows={data.system} nodes={nodes} scope="mesh" />
            </div>
          )}

          {view === 'public' && (
            <div className="space-y-4 animate-fade-in">
              <Card>
                <CardContent className="grid gap-3 p-4 md:grid-cols-2">
                  <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-foreground">Protection anti-verrouillage</p>
                      <p className="text-xs text-muted-foreground">SSH reste joignable sur les serveurs filtrés, pour ne jamais perdre la main.</p>
                    </div>
                    <Switch checked={data.settings.sshGuard} onChange={(sshGuard) => void setSetting({ sshGuard })} label="Protection anti-verrouillage" disabled={readOnly} />
                  </div>
                  <div className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-foreground">Répondre au ping</p>
                      <p className="text-xs text-muted-foreground">Les serveurs filtrés répondent au ping depuis Internet (utile pour la supervision externe).</p>
                    </div>
                    <Switch checked={data.settings.publicPing} onChange={(publicPing) => void setSetting({ publicPing })} label="Répondre au ping" disabled={readOnly} />
                  </div>
                </CardContent>
              </Card>

              <p className="text-xs text-muted-foreground">
                Le filtrage Internet se règle serveur par serveur : activez-le progressivement, en commençant par l’observation. Les pare-feux déjà
                présents sur vos serveurs (ufw, firewalld) continuent de s’appliquer : Tarmac ne rouvre jamais un port qu’ils ferment.
              </p>
              <div className="grid gap-3 xl:grid-cols-2">
                {nodes.map((node) => (
                  <PublicNodeCard key={node.id} node={node} busy={busy} onChangeMode={(target, mode) => void onPublicMode(target, mode)} />
                ))}
              </div>

              <SectionLabel
                actions={
                  <Button write size="sm" variant="secondary" className="gap-1.5" onClick={() => setRuleDialog({ draft: { scope: 'public' } })}>
                    <Plus className="h-3.5 w-3.5" />
                    Règle
                  </Button>
                }
              >
                Règles Internet
              </SectionLabel>
              <RulesTable
                rules={publicRules}
                nodes={nodes}
                scope="public"
                onAction={(rule, action) => void onRuleAction(rule, action)}
                onCreate={() => setRuleDialog({ draft: { scope: 'public' } })}
                examples={publicExamples}
              />
              <SystemFlows flows={data.system} nodes={nodes} scope="public" />
            </div>
          )}

          {view === 'activity' && (
            <div className="animate-fade-in">
              <ActivityPanel nodes={nodes} rules={data.rules} onCreateRule={openRule} />
            </div>
          )}
        </>
      )}

      {data && (
        <>
          <RuleDialog
            open={ruleDialog !== null}
            onOpenChange={(open) => !open && setRuleDialog(null)}
            rule={ruleDialog?.rule}
            draft={ruleDialog?.draft}
            nodes={nodes}
            labels={data.labels}
            meshMode={meshMode}
            sshGuard={data.settings.sshGuard}
            system={data.system}
            onSaved={(message) => {
              showNotice({ tone: 'success', message });
              void mutate();
            }}
          />
          <TestDialog open={testOpen} onOpenChange={setTestOpen} nodes={nodes} preset={testPreset} onCreateRule={openRule} />
          <MeshEnforceDialog
            open={meshConfirm}
            overview={data}
            busy={busy}
            onOpenChange={setMeshConfirm}
            onConfirm={() => void setMeshMode('enforce')}
            onReview={() => {
              setMeshConfirm(false);
              setView('activity');
            }}
          />
          <EnforcePreflight
            target={preflight}
            onOpenChange={(open) => !open && setPreflight(null)}
            onDone={(message) => {
              showNotice({ tone: 'success', message });
              void mutate();
            }}
          />
        </>
      )}
    </div>
  );
}
