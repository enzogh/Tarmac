'use client';

import { useState } from 'react';
import { api, NodeItem } from '@/lib/api';
import { Badge } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DnsNotice } from './useDnsPageState';

export function GroupDialog({
  open,
  onOpenChange,
  nodes,
  onCreated,
  onNotice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodes: NodeItem[];
  onCreated: () => Promise<void>;
  onNotice: (notice: DnsNotice) => void;
}) {
  const [groupName, setGroupName] = useState('');
  const [groupNodeIds, setGroupNodeIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const resetForm = () => {
    setGroupName('');
    setGroupNodeIds([]);
  };

  const toggleGroupNode = (nodeId: string) => {
    setGroupNodeIds((prev) => (prev.includes(nodeId) ? prev.filter((id) => id !== nodeId) : [...prev, nodeId]));
  };

  const createGroup = async () => {
    if (!groupName.trim()) {
      onNotice({ type: 'error', message: 'Le nom du groupe DNS est obligatoire.' });
      return;
    }
    setCreating(true);
    try {
      const group = await api.dns.groups.create({ name: groupName.trim() });
      await Promise.all(
        groupNodeIds.map((nodeId, index) =>
          api.dns.groups.addMember(group.id, {
            nodeId,
            role: index === 0 ? 'primary' : 'secondary',
            status: 'pending',
          }),
        ),
      );
      onNotice({ type: 'success', message: `Groupe DNS « ${group.name} » créé.` });
      onOpenChange(false);
      resetForm();
      await onCreated();
    } catch {
      onNotice({ type: 'error', message: 'Erreur lors de la création du groupe DNS.' });
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) resetForm();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau groupe DNS</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dns-group-name">Nom du groupe</Label>
            <Input
              id="dns-group-name"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="ex: dns-principal"
            />
          </div>
          <div className="space-y-2">
            <Label>Serveurs</Label>
            <p className="text-xs text-muted-foreground">
              Le premier nœud coché devient le primaire, les suivants sont secondaires.
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {nodes.map((node) => {
                const checked = groupNodeIds.includes(node.id);
                const index = groupNodeIds.indexOf(node.id);
                return (
                  <label
                    key={node.id}
                    className={`flex cursor-pointer items-center justify-between rounded-lg border px-3 py-2 transition ${
                      checked ? 'border-violet-500/50 bg-violet-500/[0.08]' : 'border-white/[0.1] bg-zinc-950/50'
                    }`}
                  >
                    <span className="flex items-center gap-2 text-sm text-foreground">
                      <input type="checkbox" checked={checked} onChange={() => toggleGroupNode(node.id)} className="h-4 w-4 rounded" />
                      {node.name}
                      <span className="text-xs text-muted-foreground">({node.status})</span>
                    </span>
                    {checked && (
                      <Badge label={index === 0 ? 'primaire' : 'secondaire'} type={index === 0 ? 'info' : 'success'} />
                    )}
                  </label>
                );
              })}
              {nodes.length === 0 && <p className="text-sm text-muted-foreground">Aucun nœud enregistré.</p>}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={createGroup} disabled={creating}>
            {creating ? 'Création…' : 'Créer le groupe'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
