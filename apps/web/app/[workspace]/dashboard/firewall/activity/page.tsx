'use client';

import { ActivityView } from '../components/ActivityPanel';
import { useFirewall } from '../components/FirewallContext';

export default function FirewallActivityPage() {
  const { data, openRule, openTest } = useFirewall();
  return (
    <ActivityView
      nodes={data.nodes}
      rules={data.rules}
      retentionDays={data.settings.eventRetentionDays}
      onCreateRule={(draft) => openRule({ draft })}
      onTest={openTest}
    />
  );
}
