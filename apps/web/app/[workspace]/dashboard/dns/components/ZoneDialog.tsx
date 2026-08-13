'use client';

import { useState } from 'react';
import { api, DnsServerGroupItem } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DnsNotice } from './useDnsPageState';

export function ZoneDialog({
  open,
  onOpenChange,
  groups,
  onCreated,
  onNotice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: DnsServerGroupItem[];
  onCreated: () => Promise<void>;
  onNotice: (notice: DnsNotice) => void;
}) {
  const [zoneForm, setZoneForm] = useState({ groupId: '', name: '', dnssecEnabled: true });
  const [creating, setCreating] = useState(false);

  const createZone = async () => {
    if (!zoneForm.groupId || !zoneForm.name.trim()) {
      onNotice({ type: 'error', message: 'Groupe DNS et nom de domaine sont obligatoires.' });
      return;
    }
    setCreating(true);
    try {
      const zone = await api.dns.zones.create({
        groupId: zoneForm.groupId,
        name: zoneForm.name.trim(),
        dnssecEnabled: zoneForm.dnssecEnabled,
      });
      onNotice({ type: 'success', message: `Zone « ${zone.name} » créée.` });
      onOpenChange(false);
      setZoneForm({ groupId: '', name: '', dnssecEnabled: true });
      await onCreated();
    } catch {
      onNotice({ type: 'error', message: 'Erreur lors de la création de la zone (nom déjà utilisé ?).' });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvelle zone DNS</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dns-zone-group">Groupe DNS</Label>
            <Select value={zoneForm.groupId} onValueChange={(value) => setZoneForm((prev) => ({ ...prev, groupId: value }))}>
              <SelectTrigger id="dns-zone-group">
                <SelectValue placeholder="Choisir un groupe" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    {group.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="dns-zone-name">Domaine</Label>
            <Input
              id="dns-zone-name"
              value={zoneForm.name}
              onChange={(e) => setZoneForm((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="exemple.com"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={zoneForm.dnssecEnabled}
              onChange={(e) => setZoneForm((prev) => ({ ...prev, dnssecEnabled: e.target.checked }))}
              className="h-4 w-4 rounded"
            />
            Activer DNSSEC
          </label>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={createZone} disabled={creating}>
            {creating ? 'Création…' : 'Créer la zone'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
