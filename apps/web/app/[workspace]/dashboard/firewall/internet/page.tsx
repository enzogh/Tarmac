'use client';

import { useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, FirewallMode, FirewallNode, FirewallOverview } from '@/lib/api';
import { useReadOnly } from '@/lib/read-only';
import { useFirewall, useRuleActions } from '../components/FirewallContext';
import { FwSection, Switch } from '../components/fw-ui';
import { RulesTable, SystemFlows } from '../components/MeshPanels';
import { EnforcePreflight } from '../components/PublicPanels';
import { InternetServerList, InternetServerSheet } from '../components/InternetServers';
import { AddressLists } from '../components/AddressLists';

function SettingRow({
  title,
  text,
  note,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  text: string;
  note?: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 p-4">
      <div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{text}</p>
        {note}
      </div>
      <Switch checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

const BAN_ATTEMPTS = [3, 5, 10, 20];
const RPC_BAN_ATTEMPTS = [5, 10, 20, 50];
const BAN_MINUTES = [5, 10, 30, 60, 180, 720, 1440];
// Mirrors the agent (firewall_sshban.go): x6 per repeat offence, 7 days at most.
const BAN_FACTOR = 6;
const BAN_MAX_MINUTES = 7 * 24 * 60;

function formatMinutes(minutes: number): string {
  if (minutes >= BAN_MAX_MINUTES) return '7 jours';
  if (minutes >= 1440 && minutes % 1440 === 0) return minutes === 1440 ? '24 h' : `${minutes / 1440} jours`;
  if (minutes >= 60) return minutes % 60 === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${minutes % 60}`;
  return `${minutes} min`;
}

/** "10 min, puis 1 h, 6 h, 36 h, jusqu’à 7 jours". */
function escalationSteps(minutes: number): string {
  const steps: string[] = [];
  for (let current = minutes; steps.length < 5; current *= BAN_FACTOR) {
    if (current >= BAN_MAX_MINUTES) break;
    steps.push(formatMinutes(current));
  }
  return `${steps.join(', puis ')}${steps.length > 0 ? ', ' : ''}jusqu’à 7 jours`;
}

function NumberChoice({
  value,
  options,
  format,
  onChange,
  disabled,
  label,
}: {
  value: number;
  options: number[];
  format: (value: number) => string;
  onChange: (value: number) => void;
  disabled?: boolean;
  label: string;
}) {
  const choices = options.includes(value) ? options : [...options, value].sort((a, b) => a - b);
  return (
    <Select value={String(value)} onValueChange={(next) => onChange(Number(next))} disabled={disabled}>
      <SelectTrigger className="h-8 w-[7.5rem] text-xs" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {choices.map((choice) => (
          <SelectItem key={choice} value={String(choice)}>
            {format(choice)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function FirewallInternetPage() {
  const { data, replace, refresh, notify, fail, openRule } = useFirewall();
  const onRuleAction = useRuleActions();
  const { readOnly } = useReadOnly();
  const [busy, setBusy] = useState(false);
  const [preflight, setPreflight] = useState<{ node: FirewallNode; mode: FirewallMode } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = data.nodes.find((node) => node.id === openId) ?? null;
  const rules = data.rules.filter((rule) => rule.scope === 'public');
  // Agents too old to throttle SSH: the setting says so instead of overpromising.
  const sshLimitPending = data.nodes.filter((node) => node.sshLimit === 'unsupported');
  const rpcGuardPending = data.nodes.filter((node) => node.rpcGuard === 'unsupported');
  const sshBanPending = data.nodes.filter((node) => node.sshBan === 'unsupported');
  const bannedNow = data.nodes.reduce((total, node) => total + (node.sshBans ?? 0), 0);
  const settings = data.settings;
  const banActive = settings.sshLimit && settings.sshBan;
  const rpcBanActive = settings.rpcGuard && settings.rpcBan;
  const rpcBanPending = data.nodes.filter((node) => node.rpcBan === 'unsupported');
  const rpcBannedNow = data.nodes.reduce((total, node) => total + (node.rpcBans ?? 0), 0);

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
          lists={data.lists}
          scope="public"
          onAction={(rule, action) => void onRuleAction(rule, action)}
          onCreate={() => openRule({ draft: { scope: 'public' } })}
          examples={examples}
        />
        <SystemFlows flows={data.system} nodes={data.nodes} scope="public" />
      </FwSection>

      <AddressLists />

      <FwSection title="Réglages" description="Valables pour tous vos serveurs.">
        <Card className="divide-y divide-border overflow-hidden">
          <SettingRow
            title="Limiter les tentatives SSH"
            text="Une même adresse peut ouvrir 20 connexions SSH d’affilée, puis 10 par minute : au-delà, elle est ralentie, jamais bloquée. Efficace contre les robots qui essaient des mots de passe. Les adresses autorisées par une règle SSH ne sont jamais limitées. S’applique aussi aux serveurs non filtrés."
            note={
              data.settings.sshLimit && sshLimitPending.length > 0 ? (
                <p className="mt-2 text-xs text-[hsl(var(--warn))]">
                  {sshLimitPending.length === 1
                    ? `${sshLimitPending[0].name} doit mettre à jour son agent pour en profiter (page Nœuds).`
                    : `${sshLimitPending.length} serveurs doivent mettre à jour leur agent pour en profiter (page Nœuds).`}
                </p>
              ) : undefined
            }
            checked={data.settings.sshLimit}
            onChange={(sshLimit) => void setSetting({ sshLimit })}
            disabled={readOnly}
          />
          <SettingRow
            title="Bannir les adresses qui échouent"
            text={`Une adresse qui rate ${settings.sshBanAttempts} connexions SSH en une heure, ou ${settings.sshBanAttempts * 2} en 24 heures (mauvais mot de passe, utilisateur inconnu, connexion abandonnée sans se connecter) est bannie de SSH pendant ${formatMinutes(settings.sshBanMinutes)}${settings.sshBanEscalate ? ', puis de plus en plus longtemps si elle recommence' : ''}, sur tous les serveurs du workspace à la fois. Attrape aussi les robots lents, qui passent sous la limite ci-dessus. Les adresses du réseau privé et celles qu’une règle SSH autorise ne sont jamais bannies : créer une telle règle lève aussitôt un bannissement.`}
            note={
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
                  <span>Bannir après</span>
                  <NumberChoice
                    label="Échecs avant bannissement"
                    value={settings.sshBanAttempts}
                    options={BAN_ATTEMPTS}
                    format={(value) => `${value} échecs`}
                    onChange={(sshBanAttempts) => void setSetting({ sshBanAttempts })}
                    disabled={readOnly || !banActive}
                  />
                  <span>pendant</span>
                  <NumberChoice
                    label="Durée du premier bannissement"
                    value={settings.sshBanMinutes}
                    options={BAN_MINUTES}
                    format={formatMinutes}
                    onChange={(sshBanMinutes) => void setSetting({ sshBanMinutes })}
                    disabled={readOnly || !banActive}
                  />
                </div>
                <div className="flex items-start gap-3">
                  <Switch
                    checked={settings.sshBanEscalate}
                    onChange={(sshBanEscalate) => void setSetting({ sshBanEscalate })}
                    label="Bannissement progressif"
                    disabled={readOnly || !banActive}
                  />
                  <div className="text-sm">
                    <p className="text-foreground">Bannissement progressif</p>
                    <p className="text-muted-foreground">
                      Chaque récidive dure 6 fois plus longtemps : {escalationSteps(settings.sshBanMinutes)}. Oublié après 7 jours sans nouvel abus.
                    </p>
                  </div>
                </div>
                {!settings.sshLimit ? (
                  <p className="text-xs text-[hsl(var(--warn))]">Activez « Limiter les tentatives SSH » pour bannir des adresses.</p>
                ) : banActive && sshBanPending.length > 0 ? (
                  <p className="text-xs text-[hsl(var(--warn))]">
                    {sshBanPending.length === 1
                      ? `${sshBanPending[0].name} doit mettre à jour son agent pour en profiter (page Nœuds).`
                      : `${sshBanPending.length} serveurs doivent mettre à jour leur agent pour en profiter (page Nœuds).`}
                  </p>
                ) : banActive && bannedNow > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {bannedNow === 1 ? '1 adresse bannie en ce moment' : `${bannedNow} adresses bannies en ce moment`} sur vos serveurs (détail dans l’Activité).
                  </p>
                ) : null}
              </div>
            }
            checked={settings.sshBan}
            onChange={(sshBan) => void setSetting({ sshBan })}
            disabled={readOnly || !settings.sshLimit}
          />
          <SettingRow
            title="rpcbind réservé au réseau privé"
            text="Le port 111 (rpcbind, utilisé par NFS) n’est joignable que depuis le réseau privé Tarmac : depuis Internet, il dévoile vos services et sert à amplifier des attaques DDoS. Vos montages NFS ne sont pas concernés. Une adresse autorisée par une règle sur ce port reste acceptée. S’applique aussi aux serveurs non filtrés."
            note={
              data.settings.rpcGuard && rpcGuardPending.length > 0 ? (
                <p className="mt-2 text-xs text-[hsl(var(--warn))]">
                  {rpcGuardPending.length === 1
                    ? `${rpcGuardPending[0].name} doit mettre à jour son agent pour en profiter (page Nœuds).`
                    : `${rpcGuardPending.length} serveurs doivent mettre à jour leur agent pour en profiter (page Nœuds).`}
                </p>
              ) : undefined
            }
            checked={data.settings.rpcGuard}
            onChange={(rpcGuard) => void setSetting({ rpcGuard })}
            disabled={readOnly}
          />
          <SettingRow
            title="Bannir les adresses qui spamment rpcbind"
            text={`Une adresse qui tente plus de ${settings.rpcBanAttempts} connexions TCP par heure sur rpcbind est bannie de tous les serveurs du workspace, SSH compris, pendant ${formatMinutes(settings.sshBanMinutes)}${settings.sshBanEscalate ? ', puis de plus en plus longtemps' : ''} (durées du bannissement SSH ci-dessus). Seul le TCP compte : en UDP, n’importe qui peut se faire passer pour une autre adresse. Les serveurs Tarmac, le réseau privé et les adresses qu’une règle autorise ne sont jamais bannis.`}
            note={
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
                  <span>Bannir au-delà de</span>
                  <NumberChoice
                    label="Tentatives rpcbind par heure avant bannissement"
                    value={settings.rpcBanAttempts}
                    options={RPC_BAN_ATTEMPTS}
                    format={(value) => `${value} par heure`}
                    onChange={(rpcBanAttempts) => void setSetting({ rpcBanAttempts })}
                    disabled={readOnly || !rpcBanActive}
                  />
                </div>
                {!settings.rpcGuard ? (
                  <p className="text-xs text-[hsl(var(--warn))]">Activez « rpcbind réservé au réseau privé » pour bannir ces adresses.</p>
                ) : rpcBanActive && rpcBanPending.length > 0 ? (
                  <p className="text-xs text-[hsl(var(--warn))]">
                    {rpcBanPending.length === 1
                      ? `${rpcBanPending[0].name} doit mettre à jour son agent pour en profiter (page Nœuds).`
                      : `${rpcBanPending.length} serveurs doivent mettre à jour leur agent pour en profiter (page Nœuds).`}
                  </p>
                ) : rpcBanActive && rpcBannedNow > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {rpcBannedNow === 1 ? '1 adresse bannie de tout le serveur' : `${rpcBannedNow} adresses bannies de tout le serveur`} en ce moment (détail dans l’Activité).
                  </p>
                ) : null}
              </div>
            }
            checked={settings.rpcBan}
            onChange={(rpcBan) => void setSetting({ rpcBan })}
            disabled={readOnly || !settings.rpcGuard}
          />
          <div className="grid divide-y divide-border md:grid-cols-2 md:divide-x md:divide-y-0">
            <SettingRow
              title="Protection anti-verrouillage"
              text="Sur les serveurs filtrés, SSH reste toujours joignable, pour ne jamais perdre la main."
              checked={data.settings.sshGuard}
              onChange={(sshGuard) => void setSetting({ sshGuard })}
              disabled={readOnly}
            />
            <SettingRow
              title="Répondre au ping"
              text="Sur les serveurs filtrés. Utile pour une supervision externe."
              checked={data.settings.publicPing}
              onChange={(publicPing) => void setSetting({ publicPing })}
              disabled={readOnly}
            />
          </div>
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
