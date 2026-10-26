'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HelpText } from '@/components/ui/wizard';
import type { NodeActivityItem } from '@/lib/api';

export const slugifyHostname = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// The dialogs stay mounted while they close: unmounting an open Radix dialog
// (returning null as soon as `node` is cleared) skips its own cleanup of the
// page-wide pointer lock. The last node is kept so the closing frame still
// has something to render.
function useRetained<T>(value: T | null): T | null {
  const last = useRef(value);
  if (value) last.current = value;
  return value ?? last.current;
}

export function EditNodeDialog({
  node: current,
  labels,
  onOpenChange,
  onSave,
}: {
  node: NodeActivityItem | null;
  labels: string[];
  onOpenChange: (open: boolean) => void;
  onSave: (values: { name: string; role: string; labels: string[]; dnsHostname: string | null }) => Promise<void>;
}) {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [labelText, setLabelText] = useState('');
  const [dnsHostname, setDnsHostname] = useState('');
  const [saving, setSaving] = useState(false);
  const node = useRetained(current);

  useEffect(() => {
    if (!current) return;
    setName(current.name);
    setRole(current.role);
    setLabelText(labels.join(', '));
    setDnsHostname(current.dnsHostname ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  if (!node) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      await onSave({
        name,
        role,
        dnsHostname: dnsHostname || null,
        labels: labelText
          .split(',')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
          .slice(0, 6),
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(current)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier « {node.name} »</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Nom du nœud</Label>
              <Input id="edit-name" value={name} onChange={(event) => setName(event.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-role">Rôle</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger id="edit-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="worker">Worker</SelectItem>
                  <SelectItem value="controller">Controller</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-labels">Libellés</Label>
            <Input id="edit-labels" value={labelText} onChange={(event) => setLabelText(event.target.value)} placeholder="paris, production, critique" />
            <p className="text-xs text-muted-foreground">Séparés par des virgules (6 maximum). Servent à filtrer la liste des nœuds.</p>
          </div>
          <div className="space-y-2">
            <span className="flex items-center gap-1">
              <Label htmlFor="edit-dns-hostname">Nom DNS interne</Label>
              <HelpText text="Nom utilisé pour joindre ce nœud sur le réseau privé (ex : node1.tarmac.local), une fois qu'un serveur DNS interne est désigné dans la flotte. Laissez vide pour un nom dérivé du nom du nœud." />
            </span>
            <Input
              id="edit-dns-hostname"
              value={dnsHostname}
              onChange={(event) => setDnsHostname(event.target.value)}
              placeholder={slugifyHostname(name) || 'node1'}
            />
            <p className="font-mono text-xs text-muted-foreground">{dnsHostname || slugifyHostname(name) || '…'}.tarmac.local</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteNodeDialog({
  node: current,
  onOpenChange,
  onConfirm,
}: {
  node: NodeActivityItem | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (node: NodeActivityItem) => Promise<void>;
}) {
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const node = useRetained(current);
  useEffect(() => setTyped(''), [current?.id]);
  if (!node) return null;
  return (
    <Dialog open={Boolean(current)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Supprimer « {node.name} » ?</DialogTitle>
          <DialogDescription>
            Le nœud quitte la flotte et l’agent est désinstallé du serveur s’il est en ligne. Son historique (métriques, disques,
            SMART) et les profils VPN qui l’utilisent comme point d’entrée sont supprimés avec lui. Action irréversible.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="delete-confirm">Tapez le nom du nœud pour confirmer</Label>
          <Input id="delete-confirm" value={typed} autoFocus onChange={(event) => setTyped(event.target.value)} placeholder={node.name} />
        </div>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={typed.trim() !== node.name || deleting}
            onClick={async () => {
              setDeleting(true);
              try {
                await onConfirm(node);
              } finally {
                setDeleting(false);
              }
            }}
          >
            Supprimer définitivement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
