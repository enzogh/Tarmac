'use client';

import { useCallback, useRef, useState } from 'react';
import type { StatusTone } from '@/components/ui/status';
import { StatusDot } from '@/components/ui/status';
import type { VpnNodeRef, VpnProfile, VpnStatsLiveEvent } from '@/lib/api';
import { flagFromCountryCode } from '@/lib/geo';
import { useLiveSocket } from '@/lib/hooks/useLiveSocket';
import { cn } from '@/lib/utils';

export const MODE_LABEL: Record<VpnProfile['mode'], { title: string; short: string; description: string }> = {
  full: {
    title: 'Tout le trafic',
    short: 'VPN complet',
    description:
      "Toute la navigation de l'appareil passe par le VPN et sort sur Internet avec l'IP publique du nœud de sortie.",
  },
  private: {
    title: 'Réseau privé uniquement',
    short: 'Réseau privé',
    description:
      "Seul l'accès à vos serveurs passe par le VPN ; la connexion Internet de l'appareil reste inchangée.",
  },
};

export function nodeLocation(node: Pick<VpnNodeRef, 'locationCity' | 'locationCountry'>): string | null {
  return [node.locationCity, node.locationCountry].filter(Boolean).join(', ') || null;
}

export function NodeFlag({ node, className }: { node: Pick<VpnNodeRef, 'locationCountryCode'>; className?: string }) {
  return (
    <span className={cn('text-base leading-none', className)} aria-hidden>
      {flagFromCountryCode(node.locationCountryCode)}
    </span>
  );
}

const NODE_TONE: Record<VpnNodeRef['status'], StatusTone> = { online: 'ok', degraded: 'warn', offline: 'danger' };

/** Flag, name and live status of a node - the unit every VPN screen is built from. */
export function NodeLabel({ node, showIp = false, className }: { node: VpnNodeRef; showIp?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-2', className)}>
      <NodeFlag node={node} />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-medium text-foreground">{node.name}</span>
          <StatusDot tone={NODE_TONE[node.status]} />
        </span>
        {showIp && (
          <span className="block truncate font-mono text-2xs text-muted-foreground">{node.publicIp ?? 'IP inconnue'}</span>
        )}
      </span>
    </span>
  );
}

export type ProfileStatusKey = 'error' | 'connected' | 'pending' | 'ready' | 'disabled' | 'expired';
export type ProfileStatus = { key: ProfileStatusKey; tone: StatusTone; label: string; pulse?: boolean; hint?: string | null };

// One status per profile, in the order an operator cares about: is it
// broken, is it still being set up, is someone on it right now.
export function profileStatus(profile: VpnProfile): ProfileStatus {
  const { deployment, session } = profile;
  if (deployment.status === 'expired') return { key: 'expired', tone: 'neutral', label: 'Expiré' };
  if (deployment.status === 'disabled') return { key: 'disabled', tone: 'neutral', label: 'Désactivé' };
  if (deployment.status === 'error') return { key: 'error', tone: 'danger', label: 'Erreur', hint: deployment.message };
  if (deployment.status === 'pending') {
    return { key: 'pending', tone: 'warn', label: 'Déploiement…', pulse: true, hint: deployment.message };
  }
  if (session.connected) return { key: 'connected', tone: 'ok', label: 'Connecté', pulse: true };
  return {
    key: 'ready',
    tone: 'info',
    label: 'Prêt',
    hint: session.lastHandshakeAt ? null : "Aucun appareil ne s'est encore connecté avec ce profil.",
  };
}

export type LiveSession = {
  rxBytes: number;
  txBytes: number;
  rxRate: number;
  txRate: number;
  lastHandshakeAt: string | null;
  endpoint: string | null;
};

/**
 * Real-time session counters: the entry node's heartbeat pushes every
 * client's byte counters on the live socket (~every 5s); throughput is the
 * delta between two pushes. The REST list (polled) stays the source of
 * truth for everything else, and `onChanged` refetches it as soon as the
 * API reports a configuration change.
 */
export function useVpnLive(onChanged: () => void) {
  const [sessions, setSessions] = useState<Record<string, LiveSession>>({});
  const previous = useRef<Record<string, { rx: number; tx: number; at: number }>>({});
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;

  useLiveSocket(
    useCallback((message) => {
      if (message.type === 'vpn.changed') {
        onChangedRef.current();
        return;
      }
      if (message.type !== 'vpn.stats') return;
      const { peers } = message.payload as VpnStatsLiveEvent;
      const now = Date.now();
      setSessions((current) => {
        const next = { ...current };
        for (const peer of peers) {
          const before = previous.current[peer.profileId];
          const seconds = before ? (now - before.at) / 1000 : 0;
          // Counters reset when a client's keys are rotated: never show a
          // negative rate for that one sample.
          const rate = (value: number, old?: number) =>
            before && seconds > 0 && old !== undefined && value >= old ? (value - old) / seconds : 0;
          next[peer.profileId] = {
            rxBytes: peer.rxBytes,
            txBytes: peer.txBytes,
            rxRate: rate(peer.rxBytes, before?.rx),
            txRate: rate(peer.txBytes, before?.tx),
            lastHandshakeAt: peer.lastHandshakeAt,
            endpoint: peer.endpoint,
          };
          previous.current[peer.profileId] = { rx: peer.rxBytes, tx: peer.txBytes, at: now };
        }
        return next;
      });
    }, []),
  );

  return sessions;
}

/** Strips the port from a WireGuard endpoint ("1.2.3.4:51820" / "[::1]:51820"). */
export function endpointIp(endpoint: string | null | undefined): string | null {
  if (!endpoint) return null;
  if (endpoint.startsWith('[')) return endpoint.slice(1, endpoint.indexOf(']'));
  return endpoint.split(':')[0] || null;
}
