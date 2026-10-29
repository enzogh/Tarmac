'use client';

import { PageHeader } from '@/components/PageHeader';
import { ActivityView } from '../components/ActivityPanel';
import { useFirewall } from '../components/FirewallContext';

export default function FirewallActivityPage() {
  const { data, openRule } = useFirewall();
  return (
    <>
      <PageHeader
        title="Activité du pare-feu"
        description="Les connexions refusées par vos règles et, en mode observation, celles qui le seraient. Autorisez ou bloquez une source en un clic."
      />
      <ActivityView nodes={data.nodes} rules={data.rules} onCreateRule={(draft) => openRule({ draft })} />
    </>
  );
}
