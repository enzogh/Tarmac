import type { ReactNode } from 'react';
import { FirewallProvider } from './components/FirewallContext';
import { FirewallShell } from './components/FirewallShell';

export default function FirewallLayout({ children }: { children: ReactNode }) {
  return (
    <FirewallProvider>
      <FirewallShell>{children}</FirewallShell>
    </FirewallProvider>
  );
}
