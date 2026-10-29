import type { ReactNode } from 'react';
import { FirewallProvider } from './components/FirewallContext';

export default function FirewallLayout({ children }: { children: ReactNode }) {
  return <FirewallProvider>{children}</FirewallProvider>;
}
