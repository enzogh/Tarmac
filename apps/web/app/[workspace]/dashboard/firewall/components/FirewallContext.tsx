'use client';

import { createContext, ReactNode, useContext, useRef, useState } from 'react';
import { Callout } from '@/components/Callout';
import { CardListSkeleton, StatCardSkeleton } from '@/components/ui/skeleton';
import { StatRow } from '@/components/ui/stat';
import { api, FirewallOverview, FirewallRule } from '@/lib/api';
import { usePolling } from '@/lib/hooks/usePolling';
import { useLiveSocket } from '@/lib/hooks/useLiveSocket';
import { RuleDialog, RuleDraft } from './RuleDialog';
import { TestDialog, TestPreset } from './TestDialog';

type Notice = { tone: 'success' | 'danger'; message: string };

type FirewallContextValue = {
  data: FirewallOverview;
  refresh: () => Promise<unknown>;
  replace: (next: FirewallOverview) => void;
  openRule: (input: { draft?: RuleDraft; rule?: FirewallRule }) => void;
  openTest: (preset: TestPreset) => void;
  notify: (notice: Notice) => void;
  fail: (caught: unknown, fallback: string) => void;
};

const Context = createContext<FirewallContextValue | null>(null);

export function useFirewall(): FirewallContextValue {
  const value = useContext(Context);
  if (!value) throw new Error('useFirewall outside FirewallProvider');
  return value;
}

/**
 * One copy of the firewall state and of its dialogs for every page of the
 * section, so switching page never reloads or loses an open rule.
 */
export function FirewallProvider({ children }: { children: ReactNode }) {
  const { data, mutate, isLoading } = usePolling('firewall-overview', api.firewall.overview, { intervalMs: 10000 });
  useLiveSocket((message) => {
    if (message.type === 'firewall.changed' || message.type === 'firewall.events') void mutate();
  });
  const [rule, setRule] = useState<{ draft?: RuleDraft; rule?: FirewallRule } | null>(null);
  const [testPreset, setTestPreset] = useState<TestPreset | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const notify = (next: Notice) => {
    setNotice(next);
    clearTimeout(timer.current);
    if (next.tone === 'success') timer.current = setTimeout(() => setNotice(null), 6000);
  };

  if (!data) {
    return isLoading ? (
      <div className="space-y-6">
        <StatRow>
          {Array.from({ length: 4 }).map((_, index) => (
            <StatCardSkeleton key={index} />
          ))}
        </StatRow>
        <CardListSkeleton cards={2} />
      </div>
    ) : (
      <Callout variant="danger">Impossible de charger le pare-feu pour le moment. Réessayez dans quelques instants.</Callout>
    );
  }

  const value: FirewallContextValue = {
    data,
    refresh: () => mutate(),
    replace: (next) => void mutate(next, { revalidate: false }),
    openRule: (input) => {
      setTestOpen(false);
      setRule(input);
    },
    openTest: (preset) => {
      setTestPreset(preset);
      setTestOpen(true);
    },
    notify,
    fail: (caught, fallback) => notify({ tone: 'danger', message: caught instanceof Error ? caught.message : fallback }),
  };

  return (
    <Context.Provider value={value}>
      <div className="space-y-8">
        {notice && <Callout variant={notice.tone}>{notice.message}</Callout>}
        {children}
      </div>
      <RuleDialog
        open={rule !== null}
        onOpenChange={(open) => !open && setRule(null)}
        rule={rule?.rule}
        draft={rule?.draft}
        nodes={data.nodes}
        labels={data.labels}
        lists={data.lists}
        meshMode={data.settings.meshMode}
        sshGuard={data.settings.sshGuard}
        system={data.system}
        onSaved={(message) => {
          notify({ tone: 'success', message });
          void mutate();
        }}
      />
      <TestDialog open={testOpen} onOpenChange={setTestOpen} nodes={data.nodes} preset={testPreset} onCreateRule={(draft) => value.openRule({ draft })} />
    </Context.Provider>
  );
}

/** Toggle / duplicate / delete / edit, shared by the rule lists of every page. */
export function useRuleActions() {
  const { openRule, notify, fail, refresh } = useFirewall();
  return async (rule: FirewallRule, action: 'edit' | 'duplicate' | 'delete' | 'toggle') => {
    try {
      if (action === 'edit') openRule({ rule });
      if (action === 'duplicate') {
        const { id: _id, expired: _e, inert: _i, service: _s, hitCount: _h, lastHitAt: _l, createdAt: _c, updatedAt: _u, expiresAt: _x, ...rest } = rule;
        openRule({ draft: { ...rest, name: `${rule.name} (copie)`.slice(0, 80) } });
      }
      if (action === 'toggle') {
        const enable = !rule.enabled || rule.expired;
        await api.firewall.updateRule(rule.id, enable && rule.expired ? { enabled: true, expiresAt: null } : { enabled: enable });
        notify({ tone: 'success', message: enable ? `« ${rule.name} » est réactivée.` : `« ${rule.name} » est désactivée.` });
        await refresh();
      }
      if (action === 'delete') {
        if (!window.confirm(`Supprimer la règle « ${rule.name} » ? Elle est retirée des serveurs dans les secondes qui suivent.`)) return;
        await api.firewall.removeRule(rule.id);
        notify({ tone: 'success', message: `Règle « ${rule.name} » supprimée.` });
        await refresh();
      }
    } catch (caught) {
      fail(caught, 'L’action a échoué.');
    }
  };
}
