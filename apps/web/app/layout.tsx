import './globals.css';
import type { Metadata } from 'next';
import { getAppVersion } from '../lib/app-version';

export const metadata: Metadata = {
  title: 'Tarmac — Stockage NFS interconnecté',
  description: "Tarmac orchestre une flotte de nœuds de stockage interconnectés : partages NFS, montages, réplication, migrations et supervision réseau.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const appVersion = getAppVersion();

  return (
    <html lang="fr">
      <body>
        {children}
        <div className="pointer-events-none fixed bottom-3 right-3 z-50 rounded-md border border-white/10 bg-zinc-950/90 px-2.5 py-1 text-xs text-zinc-300 shadow-lg">
          Version {appVersion}
        </div>
      </body>
    </html>
  );
}
