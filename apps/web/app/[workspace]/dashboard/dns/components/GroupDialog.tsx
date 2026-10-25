'use client';

import { useState } from 'react';
import { api, DnsServerGroupItem, NodeItem } from '@/lib/api';
import { Badge } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DnsNotice } from './useDnsPageState';

// 1 primaire + jusqu'à 3 secondaires - garde-fou côté UI, le backend
// applique la même limite (voir MAX_GROUP_MEMBERS dans dns-groups.service.ts).
const MAX_GROUP_MEMBERS = 4;

export function GroupDialog({
  open,
  onOpenChange,
  nodes,
  groups,
  onCreated,
  onNotice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodes: NodeItem[];
  groups: DnsServerGroupItem[];
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
          <DialogTitle>Nouveau groupe de serveurs DNS</DialogTitle>
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
            <Label>
              Serveurs{' '}
              <span className="text-xs font-normal text-muted-foreground">
                ({groupNodeIds.length}/{MAX_GROUP_MEMBERS})
              </span>
            </Label>
            <p className="text-xs text-muted-foreground">
              Le premier nœud coché devient le primaire, les suivants sont secondaires (jusqu'à {MAX_GROUP_MEMBERS} serveurs).
            </p>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {nodes.map((node) => {
                const checked = groupNodeIds.includes(node.id);
                const index = groupNodeIds.indexOf(node.id);
                const ownerGroup = groups.find((g) => g.members.some((m) => m.nodeId === node.id));
                const atCapacity = !checked && groupNodeIds.length >= MAX_GROUP_MEMBERS;
                const disabled = !checked && (!!ownerGroup || atCapacity);
                const row = (
                  <label
                    key={node.id}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2 transition ${
                      disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'
                    } ${checked ? 'border-violet-500/50 bg-violet-500/[0.08]' : 'border-white/[0.1] bg-surface-2'}`}
                  >
                    <span className="flex items-center gap-2 text-sm text-foreground">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleGroupNode(node.id)}
                        className="h-4 w-4 rounded"
                      />
                      {node.name}
                      <span className="text-xs text-muted-foreground">({node.status})</span>
                    </span>
                    {checked ? (
                      <Badge label={index === 0 ? 'primaire' : 'secondaire'} type={index === 0 ? 'info' : 'success'} />
                    ) : (
                      ownerGroup && <Badge label={`déjà dans « ${ownerGroup.name} »`} type="warning" />
                    )}
                  </label>
                );
                if (!disabled) return row;
                return (
                  <Tooltip key={node.id}>
                    <TooltipTrigger asChild>{row}</TooltipTrigger>
                    <TooltipContent>
                      {ownerGroup
                        ? `Ce nœud exécute déjà PowerDNS pour le groupe « ${ownerGroup.name} »`
                        : `Maximum ${MAX_GROUP_MEMBERS} serveurs par groupe`}
                    </TooltipContent>
                  </Tooltip>
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
