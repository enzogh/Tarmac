import './globals.css';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import type { Metadata } from 'next';
import { getAppVersion } from '../lib/app-version';
import { VersionBadge } from '../components/VersionBadge';

export const metadata: Metadata = {
  title: 'Tarmac — Stockage NFS interconnecté',
  description: "Tarmac orchestre une flotte de nœuds de stockage interconnectés : partages NFS, montages, réplication, migrations et supervision réseau.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const appVersion = getAppVersion();

  return (
    <html lang="fr" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        {children}
        <VersionBadge fallback={appVersion} />
      </body>
    </html>
  );
}
