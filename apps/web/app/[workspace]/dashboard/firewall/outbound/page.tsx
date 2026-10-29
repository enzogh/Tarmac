'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Eye, Info, LoaderCircle, Plus, Send, ShieldCheck } from 'lucide-react';
import { Callout } from '@/components/Callout';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusPill } from '@/components/ui/status';
import { api, FirewallMode, FirewallNode } from '@/lib/api';
import { useReadOnly } from '@/lib/read-only';
import { useFirewall, useRuleActions } from '../components/FirewallContext';
import { FwSection, NodeName } from '../components/fw-ui';
import { RulesTable } from '../components/MeshPanels';

// Plain-language names for the outbound zone of a server.
const OUTBOUND_MODE: Record<FirewallMode, { label: string; text: string }> = {
  open: { label: 'Pas de filtrage', text: 'Les services contactent Internet librement.' },
  observe: { label: 'Observation', text: 'Rien n’est coupé ; Tarmac note ce qui serait bloqué.' },
  enforce: { label: 'Filtré', text: 'Seules les destinations autorisées restent joignables.' },
};

function OutboundServerList({ nodes, busy, onChange }: { nodes: FirewallNode[]; busy: boolean; onChange: (node: FirewallNode, mode: FirewallMode) => void }) {
  const { readOnly } = useReadOnly();
  return (
    <Card className="overflow-hidden">
      <ul className="stagger-in divide-y divide-border">
        {nodes.map((node) => {
          const outdated = node.missingFeatures.includes('outbound');
          return (
            <li key={node.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 sm:flex-nowrap">
              <div className="min-w-0 flex-1 basis-56">
                <NodeName node={node} />
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {outdated ? 'Agent trop ancien pour filtrer le trafic sortant' : OUTBOUND_MODE[node.outboundMode].text}
                </p>
              </div>
              {outdated ? (
                <StatusPill tone="warn">Agent à mettre à jour</StatusPill>
              ) : (
                <Select value={node.outboundMode} onValueChange={(value) => onChange(node, value as FirewallMode)} disabled={busy || readOnly}>
                  <SelectTrigger className="h-8 w-[10.5rem] text-xs" aria-label={`Filtrage sortant de ${node.name}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['open', 'observe', 'enforce'] as const).map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {OUTBOUND_MODE[mode].label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export default function FirewallOutboundPage() {
  const { workspace } = useParams<{ workspace: string }>();
  const { data, replace, notify, fail, openRule } = useFirewall();
  const onRuleAction = useRuleActions();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<FirewallNode | null>(null);
  const rules = data.rules.filter((rule) => rule.scope === 'outbound');

  const apply = async (node: FirewallNode, mode: FirewallMode) => {
    setBusy(true);
    try {
      replace(await api.firewall.setNodesOutboundMode([node.id], mode));
      notify({
        tone: 'success',
        message:
          mode === 'enforce'
            ? `${node.name} : les services ne contactent plus Internet que là où une règle l’autorise.`
            : mode === 'observe'
              ? `${node.name} : connexions sortantes en observation, celles qui seraient bloquées apparaissent dans Activité.`
              : `${node.name} : trafic sortant non filtré (hors règles de blocage).`,
      });
    } catch (caught) {
      fail(caught, 'Le changement a échoué.');
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  const onChange = (node: FirewallNode, mode: FirewallMode) => (mode === 'enforce' ? setConfirm(node) : void apply(node, mode));

  const examples = [
    {
      title: 'Autoriser le web',
      text: 'HTTP et HTTPS vers tout Internet : API, paquets, webhooks.',
      onUse: () => openRule({ draft: { scope: 'outbound', action: 'allow', sourceKind: 'any', targetKind: 'any', protocol: 'tcp', ports: ['80', '443'], name: 'Web sortant' } }),
    },
    {
      title: 'Empêcher l’envoi d’e-mails',
      text: 'Bloque SMTP (25) : un site piraté ne pourra pas envoyer de spam.',
      onUse: () => openRule({ draft: { scope: 'outbound', action: 'deny', sourceKind: 'any', targetKind: 'any', protocol: 'tcp', ports: ['25'], name: 'Pas de SMTP sortant' } }),
    },
    {
      title: 'Bloquer des pays',
      text: 'Aucune connexion de vos services vers les pays choisis.',
      onUse: () => openRule({ draft: { scope: 'outbound', action: 'deny', sourceKind: 'countries', targetKind: 'any', protocol: 'any', ports: [], name: 'Pays bloqués en sortie' } }),
    },
  ];

  return (
    <>
      <Callout variant="info">
        <span className="font-medium">Ce que ce filtrage protège.</span> Si un service est piraté (un site, une base de données), il ne pourra contacter
        sur Internet que ce que vous autorisez : pas de téléchargement d’outils, pas d’envoi de vos données ailleurs. Les processus système (root), dont
        l’agent Tarmac et les mises à jour, ainsi que le DNS et l’heure, restent toujours libres : un serveur ne perd jamais le contact avec Tarmac. Les
        conteneurs Docker ne sont pas concernés.
      </Callout>

      <FwSection title="Vos serveurs" description="Activez le filtrage serveur par serveur, en passant d’abord par l’observation pour repérer ce dont vos services ont besoin.">
        <OutboundServerList nodes={data.nodes} busy={busy} onChange={onChange} />
      </FwSection>

      <FwSection
        title="Règles"
        description="Les blocages passent toujours avant les autorisations."
        actions={
          rules.length > 0 ? (
            <Button write size="sm" variant="secondary" className="gap-1.5" onClick={() => openRule({ draft: { scope: 'outbound' } })}>
              <Plus className="h-3.5 w-3.5" />
              Ajouter
            </Button>
          ) : undefined
        }
      >
        <RulesTable
          rules={rules}
          nodes={data.nodes}
          lists={data.lists}
          scope="outbound"
          onAction={(rule, action) => void onRuleAction(rule, action)}
          onCreate={() => openRule({ draft: { scope: 'outbound' } })}
          examples={examples}
        />
      </FwSection>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Filtrer le trafic sortant de {confirm?.name} ?</DialogTitle>
            <DialogDescription>Les services du serveur ne pourront plus contacter Internet que là où une règle l’autorise.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {confirm?.outboundMode === 'open' && (
              <Callout variant="warning">
                Ce serveur n’est pas passé par l’observation : vous ne savez pas encore ce que ses services contactent (API, paiement, sauvegardes…).
                Observez quelques heures d’abord.
              </Callout>
            )}
            <ul className="space-y-2 text-foreground">
              <li className="flex items-center gap-2">
                <Send className="h-4 w-4 shrink-0 text-muted-foreground" />
                {rules.filter((rule) => rule.action === 'allow' && rule.enabled).length === 0
                  ? 'Aucune règle d’autorisation : vos services ne pourront plus rien contacter.'
                  : `${rules.filter((rule) => rule.action === 'allow' && rule.enabled).length} règle(s) d’autorisation s’appliqueront.`}
              </li>
              <li className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 shrink-0 text-[hsl(var(--ok))]" />
                Root (agent Tarmac, mises à jour), DNS et heure restent libres.
              </li>
              <li className="flex items-center gap-2">
                <Info className="h-4 w-4 shrink-0 text-muted-foreground" />
                Les connexions déjà ouvertes ne sont pas coupées.
              </li>
            </ul>
          </div>
          <DialogFooter>
            <Button variant="secondary" asChild>
              <Link href={`/${workspace}/dashboard/firewall/activity`} className="gap-1.5">
                <Eye className="h-4 w-4" />
                Voir l’activité d’abord
              </Link>
            </Button>
            <Button write onClick={() => confirm && void apply(confirm, 'enforce')} disabled={busy} className="gap-1.5">
              {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
              Filtrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
