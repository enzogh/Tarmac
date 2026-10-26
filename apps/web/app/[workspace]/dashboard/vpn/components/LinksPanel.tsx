'use client';

import { useMemo, useState } from 'react';
import { ArrowRight, ArrowRightLeft, Link2, LoaderCircle, Plus, Search, UsersRound, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, VpnProfile } from '@/lib/api';
import { useReadOnly } from '@/lib/read-only';
import { NodeFlag } from './vpn-ui';

type Link = { key: string; from: VpnProfile; to: VpnProfile; mutual: boolean };

/** Every profile-to-profile permission, mutual ones folded into a single row. */
export function buildLinks(profiles: VpnProfile[]): Link[] {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const allows = (from: VpnProfile, toId: string) =>
    from.access.peers === 'all' || (from.access.peers === 'selected' && from.access.peerProfileIds.includes(toId));
  const links: Link[] = [];
  const seen = new Set<string>();
  for (const from of profiles) {
    if (from.access.peers !== 'selected') continue;
    for (const toId of from.access.peerProfileIds) {
      const to = byId.get(toId);
      if (!to) continue;
      const pair = [from.id, to.id].sort().join('|');
      const mutual = allows(to, from.id);
      if (mutual && seen.has(pair)) continue;
      seen.add(pair);
      links.push({ key: `${from.id}>${to.id}`, from, to, mutual });
    }
  }
  return links.sort((left, right) => left.from.name.localeCompare(right.from.name) || left.to.name.localeCompare(right.to.name));
}

function ProfileRef({ profile, onOpen }: { profile: VpnProfile; onOpen: (profile: VpnProfile) => void }) {
  return (
    <button type="button" onClick={() => onOpen(profile)} className="inline-flex min-w-0 items-center gap-2 text-left hover:text-primary">
      <NodeFlag node={profile.entryNode} className="text-sm" />
      <span className="min-w-0">
        <span className="block truncate font-medium text-foreground">{profile.name}</span>
        <span className="block truncate font-mono text-2xs text-muted-foreground">
          {profile.clientIp} · {profile.entryNode.name}
        </span>
      </span>
    </button>
  );
}

export function LinksPanel({
  profiles,
  onCreate,
  onOpenProfile,
  onChanged,
  onError,
}: {
  profiles: VpnProfile[];
  onCreate: () => void;
  onOpenProfile: (profile: VpnProfile) => void;
  onChanged: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  const { readOnly } = useReadOnly();
  const links = useMemo(() => buildLinks(profiles), [profiles]);
  const openToAll = profiles.filter((profile) => profile.access.peers === 'all');
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return links;
    return links.filter((link) =>
      [link.from, link.to].some((profile) =>
        [profile.name, profile.clientIp, profile.entryNode.name, ...profile.tags].some((value) => value.toLowerCase().includes(needle)),
      ),
    );
  }, [links, query]);
  const crossEntry = links.filter((link) => link.from.entryNode.id !== link.to.entryNode.id).length;

  const remove = async (link: Link) => {
    setRemoving(link.key);
    try {
      await api.vpn.bulk([link.from.id], 'remove_peers', { peerIds: [link.to.id] });
      if (link.mutual && link.to.access.peers === 'selected') {
        await api.vpn.bulk([link.to.id], 'remove_peers', { peerIds: [link.from.id] });
      }
      onChanged(`Lien entre « ${link.from.name} » et « ${link.to.name} » supprimé.`);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'La suppression du lien a échoué.');
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div className="space-y-4">
      {openToAll.length > 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-2 py-3">
            <UsersRound className="h-4 w-4 text-[hsl(var(--warn))]" />
            <span className="text-sm text-foreground">Peuvent joindre tous les profils :</span>
            {openToAll.map((profile) => (
              <button
                key={profile.id}
                type="button"
                onClick={() => onOpenProfile(profile)}
                className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs text-foreground hover:border-primary/40"
              >
                {profile.name}
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>Liens entre profils</CardTitle>
            <CardDescription>
              {links.length === 0
                ? 'Par défaut chaque appareil est isolé des autres. Créez un lien pour autoriser deux appareils à communiquer.'
                : `${links.length} lien${links.length > 1 ? 's' : ''}${crossEntry > 0 ? `, dont ${crossEntry} entre points d’entrée différents` : ''}. Les autres appareils restent isolés.`}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {links.length > 6 && (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Profil, IP, libellé…" className="h-8 w-56 pl-8" />
              </div>
            )}
            <Button write onClick={onCreate} className="gap-1.5" disabled={profiles.length < 2}>
              <Plus className="h-4 w-4" />
              Nouveau lien
            </Button>
          </div>
        </CardHeader>
        <CardContent flush>
          {links.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Link2 className="h-6 w-6 text-muted-foreground" />
              <p className="max-w-md text-sm text-muted-foreground">
                Exemple : autoriser le PC d&apos;un technicien à prendre la main sur les postes d&apos;une équipe, sans que ces
                postes ne se voient entre eux.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Profil</TableHead>
                  <TableHead className="w-24 text-center">Sens</TableHead>
                  <TableHead>Peut joindre</TableHead>
                  <TableHead className="w-12">
                    <span className="sr-only">Supprimer</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((link) => (
                  <TableRow key={link.key}>
                    <TableCell className="max-w-[18rem] py-2">
                      <ProfileRef profile={link.from} onOpen={onOpenProfile} />
                    </TableCell>
                    <TableCell className="py-2 text-center">
                      <span
                        title={link.mutual ? 'Dans les deux sens' : 'Sens unique'}
                        className="inline-flex items-center gap-1 rounded-md border border-border bg-surface-2 px-2 py-0.5 text-2xs text-muted-foreground"
                      >
                        {link.mutual ? <ArrowRightLeft className="h-3 w-3 text-primary" /> : <ArrowRight className="h-3 w-3" />}
                        {link.mutual ? 'Mutuel' : 'Unique'}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-[18rem] py-2">
                      <ProfileRef profile={link.to} onOpen={onOpenProfile} />
                    </TableCell>
                    <TableCell className="py-2 text-right">
                      {!readOnly && <button
                        type="button"
                        onClick={() => void remove(link)}
                        disabled={removing === link.key}
                        aria-label="Supprimer le lien"
                        title="Supprimer le lien"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-[hsl(var(--danger))]"
                      >
                        {removing === link.key ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                      </button>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {links.length > 0 && visible.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">Aucun lien ne correspond à cette recherche.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
