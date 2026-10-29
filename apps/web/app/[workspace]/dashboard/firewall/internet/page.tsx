'use client';

import { useState } from 'react';
import { Plus, Radar } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api, FirewallMode, FirewallNode, FirewallOverview } from '@/lib/api';
import { useReadOnly } from '@/lib/read-only';
import { useFirewall, useRuleActions } from '../components/FirewallContext';
import { FwSection, Switch } from '../components/fw-ui';
import { RulesTable, SystemFlows } from '../components/MeshPanels';
import { EnforcePreflight } from '../components/PublicPanels';
import { InternetServerList, InternetServerSheet } from '../components/InternetServers';

function SettingRow({ title, text, checked, onChange, disabled }: { title: string; text: string; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 p-4">
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{text}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

export default function FirewallInternetPage() {
  const { data, replace, refresh, notify, fail, openRule, openTest } = useFirewall();
  const onRuleAction = useRuleActions();
  const { readOnly } = useReadOnly();
  const [busy, setBusy] = useState(false);
  const [preflight, setPreflight] = useState<{ node: FirewallNode; mode: FirewallMode } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = data.nodes.find((node) => node.id === openId) ?? null;
  const rules = data.rules.filter((rule) => rule.scope === 'public');

  const onMode = async (node: FirewallNode, mode: FirewallMode) => {
    if (mode !== 'open') {
      setPreflight({ node, mode });
      return;
    }
    setBusy(true);
    try {
      replace(await api.firewall.setNodesMode([node.id], mode));
      notify({ tone: 'success', message: `${node.name} n’est plus filtré depuis Internet (hors règles de blocage).` });
    } catch (caught) {
      fail(caught, 'Le changement a échoué.');
    } finally {
      setBusy(false);
    }
  };

  const setSetting = async (patch: Partial<FirewallOverview['settings']>) => {
    if (
      patch.sshGuard === false &&
      !window.confirm(
        'Désactiver la protection anti-verrouillage ?\n\nSur les serveurs filtrés, SSH ne sera plus joignable depuis Internet sauf si une règle l’autorise. Vérifiez d’avoir une règle SSH (par exemple depuis l’adresse de votre bureau).',
      )
    ) {
      return;
    }
    try {
      replace(await api.firewall.updateSettings(patch));
    } catch (caught) {
      fail(caught, 'Le réglage n’a pas été enregistré.');
    }
  };

  const examples = [
    {
      title: 'Ouvrir un site web',
      text: 'HTTP et HTTPS joignables par tout Internet.',
      onUse: () => openRule({ draft: { scope: 'public', action: 'allow', sourceKind: 'any', targetKind: 'nodes', protocol: 'tcp', ports: ['80', '443'] } }),
    },
    {
      title: 'SSH depuis mon bureau',
      text: 'Administration réservée à une adresse IP connue.',
      onUse: () => openRule({ draft: { scope: 'public', action: 'allow', sourceKind: 'cidrs', protocol: 'tcp', ports: ['22'], name: 'SSH depuis le bureau' } }),
    },
    {
      title: 'Bannir une adresse',
      text: 'Bloque tout le trafic d’une IP ou d’une plage abusive.',
      onUse: () => openRule({ draft: { scope: 'public', action: 'deny', sourceKind: 'cidrs', protocol: 'any', ports: [], name: 'Adresse bannie' } }),
    },
  ];

  return (
    <>
      <PageHeader
        title="Depuis Internet"
        description="Ce que vos serveurs exposent au monde. Activez le filtrage serveur par serveur, de préférence en passant d’abord par l’observation."
        actionsReadOnlySafe
        actions={
          <>
            <Button variant="secondary" className="gap-1.5" onClick={() => openTest({ scope: 'public' })}>
              <Radar className="h-4 w-4" />
              Tester une connexion
            </Button>
            <Button write className="gap-1.5" onClick={() => openRule({ draft: { scope: 'public' } })}>
              <Plus className="h-4 w-4" />
              Nouvelle règle
            </Button>
          </>
        }
      />

      <FwSection title="Vos serveurs" description="Cliquez sur un serveur pour voir ses ports et les ouvrir ou fermer un par un.">
        <InternetServerList nodes={data.nodes} busy={busy} onOpen={(node) => setOpenId(node.id)} onChangeMode={(node, mode) => void onMode(node, mode)} />
      </FwSection>

      <FwSection
        title="Règles"
        description="Les blocages passent toujours avant les autorisations."
        actions={
          rules.length > 0 ? (
            <Button write size="sm" variant="secondary" className="gap-1.5" onClick={() => openRule({ draft: { scope: 'public' } })}>
              <Plus className="h-3.5 w-3.5" />
              Ajouter
            </Button>
          ) : undefined
        }
      >
        <RulesTable
          rules={rules}
          nodes={data.nodes}
          scope="public"
          onAction={(rule, action) => void onRuleAction(rule, action)}
          onCreate={() => openRule({ draft: { scope: 'public' } })}
          examples={examples}
        />
        <SystemFlows flows={data.system} nodes={data.nodes} scope="public" />
      </FwSection>

      <FwSection title="Réglages" description="Pour tous les serveurs filtrés.">
        <Card className="grid divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
          <SettingRow
            title="Protection anti-verrouillage"
            text="SSH reste toujours joignable, pour ne jamais perdre la main."
            checked={data.settings.sshGuard}
            onChange={(sshGuard) => void setSetting({ sshGuard })}
            disabled={readOnly}
          />
          <SettingRow
            title="Répondre au ping"
            text="Utile pour une supervision externe."
            checked={data.settings.publicPing}
            onChange={(publicPing) => void setSetting({ publicPing })}
            disabled={readOnly}
          />
        </Card>
      </FwSection>

      <InternetServerSheet
        node={opened}
        busy={busy}
        onOpenChange={(open) => !open && setOpenId(null)}
        onChangeMode={(node, mode) => {
          if (mode !== 'open') setOpenId(null);
          void onMode(node, mode);
        }}
        onCreateRule={(draft) => {
          setOpenId(null);
          openRule({ draft });
        }}
      />
      <EnforcePreflight
        target={preflight}
        onOpenChange={(open) => !open && setPreflight(null)}
        onDone={(message) => {
          notify({ tone: 'success', message });
          void refresh();
        }}
      />
    </>
  );
}
