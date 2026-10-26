'use client';

import { useEffect, useState } from 'react';
import { Globe, LoaderCircle } from 'lucide-react';
import { api, DnsServerGroupItem, DnsZoneItem } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/Callout';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

const DOMAIN = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

// People paste URLs and mixed case; the zone is just the bare domain.
function normalizeDomain(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
}

export function ZoneDialog({
  open,
  onOpenChange,
  groups,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: DnsServerGroupItem[];
  onCreated: (zone: DnsZoneItem) => void | Promise<void>;
}) {
  const [domain, setDomain] = useState('');
  const [groupId, setGroupId] = useState('');
  const [dnssec, setDnssec] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setDomain('');
    setDnssec(true);
    setError(null);
    setGroupId(groups.length === 1 ? groups[0].id : '');
    // Reset on open only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const name = normalizeDomain(domain);
  const domainInvalid = name.length > 0 && !DOMAIN.test(name);

  const create = async () => {
    if (!DOMAIN.test(name) || !groupId) return;
    setCreating(true);
    setError(null);
    try {
      const zone = await api.dns.zones.create({ groupId, name, dnssecEnabled: dnssec });
      onOpenChange(false);
      void onCreated(zone);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Création impossible (ce domaine existe peut-être déjà).');
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Ajouter un domaine</DialogTitle>
          <DialogDescription>
            Le domaine sera servi par vos propres serveurs DNS. Vous le déléguerez ensuite chez votre registrar.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dns-zone-name">Domaine</Label>
            <div className="relative">
              <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="dns-zone-name"
                value={domain}
                autoFocus
                onChange={(event) => setDomain(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void create()}
                placeholder="exemple.com ou sous.exemple.com"
                className="pl-9 font-mono"
              />
            </div>
            {domainInvalid && <p className="text-2xs text-[hsl(var(--danger))]">Nom de domaine invalide.</p>}
          </div>
          <div className="space-y-2">
            <Label htmlFor="dns-zone-group">Serveurs DNS</Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger id="dns-zone-group">
                <SelectValue placeholder="Choisir un groupe de serveurs" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name} · {group.members.length} serveur{group.members.length > 1 ? 's' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface-2 p-3">
            <input type="checkbox" checked={dnssec} onChange={(event) => setDnssec(event.target.checked)} className="mt-0.5 h-4 w-4 rounded" />
            <span>
              <span className="block text-sm font-medium text-foreground">Signer la zone avec DNSSEC</span>
              <span className="block text-xs text-muted-foreground">
                Recommandé : protège vos visiteurs contre les réponses DNS falsifiées. Ce choix ne se modifie pas après la
                création.
              </span>
            </span>
          </label>
          {error && <Callout variant="danger">{error}</Callout>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button write onClick={() => void create()} disabled={creating || !DOMAIN.test(name) || !groupId} className="gap-1.5">
            {creating && <LoaderCircle className="h-4 w-4 animate-spin" />}
            Ajouter le domaine
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
