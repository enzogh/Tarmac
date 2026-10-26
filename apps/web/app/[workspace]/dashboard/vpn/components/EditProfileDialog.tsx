'use client';

import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/Callout';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, VpnGateway, VpnProfile, VpnProfileMode } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { EXPIRY_OPTIONS, expiryToIso, parseDns, parseTags } from './CreateProfileDialog';
import { NodePicker } from './NodePicker';
import { MODE_LABEL, NodeLabel } from './vpn-ui';

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;

export function EditProfileDialog({
  profile,
  gateways,
  onOpenChange,
  onSaved,
}: {
  profile: VpnProfile | null;
  gateways: VpnGateway[];
  onOpenChange: (open: boolean) => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [mode, setMode] = useState<VpnProfileMode>('full');
  const [entryId, setEntryId] = useState('');
  const [pickingEntry, setPickingEntry] = useState(false);
  const [dns, setDns] = useState('');
  const [expiry, setExpiry] = useState('keep');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setName(profile.name);
    setDescription(profile.description ?? '');
    setTags(profile.tags.join(', '));
    setMode(profile.mode);
    setEntryId(profile.entryNode.id);
    setPickingEntry(false);
    setDns(profile.dns.join(', '));
    setExpiry('keep');
    setError(null);
  }, [profile]);

  if (!profile) return null;

  const entryChanged = entryId !== profile.entryNode.id;
  const selectedEntry = gateways.find((gateway) => gateway.id === entryId) ?? (entryChanged ? null : profile.entryNode);
  const dnsList = parseDns(dns);
  const dnsInvalid = dnsList.some((value) => !IPV4.test(value)) || dnsList.length > 4;
  const requiresReimport = entryChanged || mode !== profile.mode || dnsList.join(',') !== profile.dns.join(',');

  const save = async () => {
    if (!name.trim() || dnsInvalid) return;
    setSaving(true);
    setError(null);
    try {
      await api.vpn.update(profile.id, {
        name: name.trim(),
        description: description.trim() || null,
        tags: parseTags(tags),
        mode,
        dns: dnsList,
        ...(entryChanged ? { entryNodeId: entryId } : {}),
        ...(expiry === 'keep' ? {} : { expiresAt: expiry === 'never' ? null : expiryToIso(expiry) }),
      });
      onSaved(
        requiresReimport
          ? `Profil « ${name.trim()} » mis à jour. Réinstallez sa configuration sur l'appareil.`
          : `Profil « ${name.trim()} » mis à jour.`,
      );
      onOpenChange(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'La mise à jour a échoué.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifier « {profile.name} »</DialogTitle>
          <DialogDescription>
            La sortie Internet se change depuis le détail du profil, les accès depuis « Règles d&apos;accès ».
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="vpn-edit-name">Nom</Label>
              <Input id="vpn-edit-name" value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vpn-edit-description">Description</Label>
              <Input
                id="vpn-edit-description"
                value={description}
                maxLength={500}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="vpn-edit-tags">Libellés</Label>
              <Input
                id="vpn-edit-tags"
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="Séparés par des virgules"
              />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Point d&apos;entrée</Label>
              {!pickingEntry && (
                <button type="button" onClick={() => setPickingEntry(true)} className="text-xs font-medium text-primary hover:underline">
                  Changer
                </button>
              )}
            </div>
            {pickingEntry ? (
              <NodePicker
                gateways={gateways}
                value={entryId}
                autoFocus
                disabledReason={(gateway) =>
                  gateway.id !== profile.entryNode.id && gateway.entryEligibility !== null ? gateway.entryEligibility : null
                }
                meta={(gateway) => (gateway.id === profile.entryNode.id ? 'Actuel' : null)}
                onSelect={(gateway) => {
                  setEntryId(gateway.id);
                  setPickingEntry(false);
                }}
                listClassName="max-h-[14rem]"
              />
            ) : (
              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2">
                {selectedEntry ? <NodeLabel node={selectedEntry} showIp /> : <span className="text-sm text-muted-foreground">—</span>}
                {entryChanged && (
                  <button
                    type="button"
                    onClick={() => setEntryId(profile.entryNode.id)}
                    className="shrink-0 text-2xs text-muted-foreground hover:text-foreground"
                  >
                    Annuler le changement
                  </button>
                )}
              </div>
            )}
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="vpn-edit-mode">Trafic</Label>
              <Select value={mode} onValueChange={(value) => setMode(value as VpnProfileMode)}>
                <SelectTrigger id="vpn-edit-mode">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">{MODE_LABEL.full.title}</SelectItem>
                  <SelectItem value="private">{MODE_LABEL.private.title}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vpn-edit-dns">Serveurs DNS</Label>
              <Input id="vpn-edit-dns" value={dns} onChange={(event) => setDns(event.target.value)} placeholder="Aucun" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vpn-edit-expiry">Expiration</Label>
              <Select value={expiry} onValueChange={setExpiry}>
                <SelectTrigger id="vpn-edit-expiry">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="keep">
                    Inchangée ({profile.expiresAt ? formatDateTime(profile.expiresAt) : 'jamais'})
                  </SelectItem>
                  {EXPIRY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.value === 'never' ? 'Jamais' : `Dans ${option.label}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {requiresReimport && (
            <Callout variant="warning">
              {entryChanged
                ? "Changer de point d'entrée attribue une nouvelle adresse et un nouveau serveur au profil : l'appareil devra réimporter sa configuration."
                : "Ce changement modifie la configuration de l'appareil : réimportez-la après l'enregistrement."}
            </Callout>
          )}
          {dnsInvalid && <Callout variant="danger">Serveurs DNS : jusqu&apos;à 4 adresses IPv4 séparées par des virgules.</Callout>}
          {error && <Callout variant="danger">{error}</Callout>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={() => void save()} disabled={saving || !name.trim() || dnsInvalid} className="gap-1.5">
            {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
