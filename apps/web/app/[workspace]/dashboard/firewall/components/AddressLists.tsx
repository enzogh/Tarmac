'use client';

import { useEffect, useState } from 'react';
import { ListChecks, LoaderCircle, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react';
import { Callout } from '@/components/Callout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { api, FirewallAddressList } from '@/lib/api';
import { useReadOnly } from '@/lib/read-only';
import { useFirewall } from './FirewallContext';
import { FwSection } from './fw-ui';

function splitAddresses(text: string): string[] {
  return text
    .split(/[\s,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function ListDialog({ list, open, onOpenChange }: { list: FirewallAddressList | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { replace, refresh, notify } = useFirewall();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [addresses, setAddresses] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(list?.name ?? '');
    setDescription(list?.description ?? '');
    setAddresses(list?.cidrs.join('\n') ?? '');
    setError(null);
  }, [open, list]);

  const cidrs = splitAddresses(addresses);
  const ready = name.trim().length > 0 && cidrs.length > 0;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload = { name: name.trim(), description: description.trim() || null, cidrs };
      if (list) await api.firewall.updateList(list.id, payload);
      else await api.firewall.createList(payload);
      notify({
        tone: 'success',
        message: list
          ? list.usedBy.length > 0
            ? `Liste « ${payload.name} » mise à jour : ${list.usedBy.length === 1 ? 'la règle qui l’utilise est' : `les ${list.usedBy.length} règles qui l’utilisent sont`} réappliquée${list.usedBy.length === 1 ? '' : 's'}.`
            : `Liste « ${payload.name} » mise à jour.`
          : `Liste « ${payload.name} » créée. Choisissez-la comme origine d’une règle Internet.`,
      });
      replace(await api.firewall.overview());
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'L’enregistrement a échoué.');
      void refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{list ? `Modifier « ${list.name} »` : 'Nouvelle liste d’adresses'}</DialogTitle>
          <DialogDescription>
            Un nom pour un groupe d’adresses Internet. Les règles qui l’utilisent suivent automatiquement ses changements.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready && !saving) void save();
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="fw-list-name" className="text-sm font-medium text-foreground">
              Nom
            </label>
            <Input id="fw-list-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Bureau" maxLength={60} autoFocus />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="fw-list-addresses" className="text-sm font-medium text-foreground">
              Adresses
            </label>
            <textarea
              id="fw-list-addresses"
              value={addresses}
              onChange={(event) => setAddresses(event.target.value)}
              rows={5}
              placeholder={'203.0.113.24\n198.51.100.0/24\n2001:db8::/32'}
              className="w-full rounded-md border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="text-2xs text-muted-foreground">
              Une adresse ou une plage par ligne, IPv4 ou IPv6.{cidrs.length > 0 && ` ${cidrs.length} adresse${cidrs.length > 1 ? 's' : ''}.`}
            </p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="fw-list-description" className="text-sm font-medium text-foreground">
              Note <span className="font-normal text-muted-foreground">(facultatif)</span>
            </label>
            <Input
              id="fw-list-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Box fibre des locaux de Lyon"
              maxLength={300}
            />
          </div>
          {error && <Callout variant="danger">{error}</Callout>}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
              Annuler
            </Button>
            <Button type="submit" write disabled={!ready || saving} className="gap-1.5">
              {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
              {list ? 'Enregistrer' : 'Créer la liste'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The "Listes d'adresses" section: the workspace's lists, with create / edit / delete. */
export function AddressLists() {
  const { data, replace, notify, fail } = useFirewall();
  const { readOnly } = useReadOnly();
  const [editing, setEditing] = useState<FirewallAddressList | null>(null);
  const [open, setOpen] = useState(false);
  const ruleName = (id: string) => data.rules.find((rule) => rule.id === id)?.name ?? 'règle';

  const edit = (list: FirewallAddressList | null) => {
    setEditing(list);
    setOpen(true);
  };
  const remove = async (list: FirewallAddressList) => {
    if (!window.confirm(`Supprimer la liste « ${list.name} » ?`)) return;
    try {
      await api.firewall.removeList(list.id);
      replace(await api.firewall.overview());
      notify({ tone: 'success', message: `Liste « ${list.name} » supprimée.` });
    } catch (caught) {
      fail(caught, 'La suppression a échoué.');
    }
  };

  return (
    <FwSection
      title="Listes d’adresses"
      description="Des adresses regroupées sous un nom, à utiliser comme origine de vos règles Internet."
      actions={
        data.lists.length > 0 && !readOnly ? (
          <Button write size="sm" variant="secondary" className="gap-1.5" onClick={() => edit(null)}>
            <Plus className="h-3.5 w-3.5" />
            Nouvelle liste
          </Button>
        ) : undefined
      }
    >
      {data.lists.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
              <ListChecks className="h-5 w-5 text-primary" />
            </span>
            <div>
              <p className="text-sm font-medium text-foreground">Aucune liste pour l’instant</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                Regroupez des adresses sous un nom, « Bureau » ou « Prestataire », puis utilisez-le dans vos règles. Une adresse qui change se corrige à un seul
                endroit.
              </p>
            </div>
            {!readOnly && (
              <Button write size="sm" className="gap-1.5" onClick={() => edit(null)}>
                <Plus className="h-3.5 w-3.5" />
                Créer une liste
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {data.lists.map((list) => (
              <li key={list.id} className="flex items-center gap-4 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <ListChecks className="h-4 w-4 text-primary" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-foreground">
                    {list.name}
                    {list.description && <span className="ml-2 font-normal text-muted-foreground">· {list.description}</span>}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                    {list.cidrs.slice(0, 4).join(', ')}
                    {list.cidrs.length > 4 ? ` +${list.cidrs.length - 4}` : ''}
                  </p>
                </div>
                <p className="hidden shrink-0 text-right text-xs text-muted-foreground sm:block" title={list.usedBy.map(ruleName).join(', ')}>
                  {list.usedBy.length === 0 ? 'Utilisée par aucune règle' : list.usedBy.length === 1 ? `Règle « ${ruleName(list.usedBy[0])} »` : `${list.usedBy.length} règles`}
                </p>
                {!readOnly && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label={`Actions sur la liste ${list.name}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => edit(list)} className="gap-2">
                        <Pencil className="h-3.5 w-3.5" />
                        Modifier
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => void remove(list)} className="gap-2 text-[hsl(var(--danger))]">
                        <Trash2 className="h-3.5 w-3.5" />
                        Supprimer
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <ListDialog list={editing} open={open} onOpenChange={setOpen} />
    </FwSection>
  );
}
