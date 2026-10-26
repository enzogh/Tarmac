'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, ArrowRightLeft, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/Callout';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectableList } from '@/components/ui/selectable-list';
import { api, VpnAccess, VpnAccessScope, VpnGateway, VpnProfile } from '@/lib/api';
import { cn } from '@/lib/utils';
import { AccessEditor, accessError, accessPayload } from './access';

const errorMessage = (caught: unknown, fallback: string) => (caught instanceof Error ? caught.message : fallback);

/** Access rules of one profile. */
export function AccessDialog({
  profile,
  gateways,
  profiles,
  onOpenChange,
  onSaved,
}: {
  profile: VpnProfile | null;
  gateways: VpnGateway[];
  profiles: VpnProfile[];
  onOpenChange: (open: boolean) => void;
  onSaved: (message: string) => void;
}) {
  const [access, setAccess] = useState<VpnAccess | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setAccess(profile ? profile.access : null);
    setError(null);
  }, [profile]);

  if (!profile || !access) return null;
  const invalid = accessError(access);

  const save = async () => {
    if (invalid) return;
    setSaving(true);
    setError(null);
    try {
      await api.vpn.update(profile.id, accessPayload(access));
      onSaved(`Règles d'accès de « ${profile.name} » enregistrées : elles s'appliquent en quelques secondes, sans reconnexion.`);
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught, "L'enregistrement a échoué."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Accès de « {profile.name} »</DialogTitle>
          <DialogDescription>Ce que cet appareil peut joindre une fois connecté. Aucune réinstallation nécessaire.</DialogDescription>
        </DialogHeader>
        <AccessEditor value={access} onChange={setAccess} mode={profile.mode} gateways={gateways} profiles={profiles} selfId={profile.id} />
        {(error || invalid) && <Callout variant={error ? 'danger' : 'warning'} className="mt-4">{error ?? invalid}</Callout>}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={() => void save()} disabled={saving || Boolean(invalid)} className="gap-1.5">
            {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
            Enregistrer
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type Keep<T> = T | 'keep';

function Choice<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-surface-2 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={value === option.value}
          className={cn(
            'rounded-md px-3 py-1.5 text-xs transition-colors',
            value === option.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Same server/peer access for a whole selection of profiles. */
export function BulkAccessDialog({
  targets,
  gateways,
  onOpenChange,
  onDone,
}: {
  targets: VpnProfile[] | null;
  gateways: VpnGateway[];
  onOpenChange: (open: boolean) => void;
  onDone: (message: string) => void;
}) {
  const [mesh, setMesh] = useState<Keep<VpnAccessScope>>('keep');
  const [meshNodeIds, setMeshNodeIds] = useState<string[]>([]);
  const [peers, setPeers] = useState<Keep<'all' | 'none'>>('keep');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMesh('keep');
    setMeshNodeIds([]);
    setPeers('keep');
    setError(null);
  }, [targets]);

  if (!targets) return null;
  const ids = targets.map((profile) => profile.id);
  const invalid =
    mesh === 'keep' && peers === 'keep'
      ? 'Choisissez au moins une règle à modifier.'
      : mesh === 'selected' && meshNodeIds.length === 0
        ? 'Choisissez au moins un nœud.'
        : null;

  const apply = async () => {
    if (invalid) return;
    setSaving(true);
    setError(null);
    try {
      if (mesh !== 'keep') await api.vpn.bulk(ids, 'set_mesh_access', { scope: mesh, meshNodeIds });
      if (peers !== 'keep') await api.vpn.bulk(ids, 'set_peer_access', { scope: peers });
      onDone(`Règles d'accès appliquées à ${ids.length} profil${ids.length > 1 ? 's' : ''}.`);
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught, "L'application des règles a échoué."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Règles d&apos;accès pour {ids.length} profils</DialogTitle>
          <DialogDescription>Seules les règles modifiées ici remplacent celles des profils sélectionnés.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <div className="space-y-2">
            <Label>Serveurs du réseau privé</Label>
            <Choice
              value={mesh}
              onChange={setMesh}
              options={[
                { value: 'keep', label: 'Ne pas modifier' },
                { value: 'all', label: 'Tout le réseau' },
                { value: 'selected', label: 'Nœuds choisis' },
                { value: 'none', label: 'Aucun' },
              ]}
            />
            {mesh === 'selected' && (
              <SelectableList
                items={gateways.map((gateway) => ({ id: gateway.id, label: gateway.name, detail: gateway.vlanIp }))}
                selected={meshNodeIds}
                onChange={setMeshNodeIds}
                placeholder="Nœud ou IP privée…"
              />
            )}
          </div>
          <div className="space-y-2">
            <Label>Autres appareils VPN</Label>
            <Choice
              value={peers}
              onChange={setPeers}
              options={[
                { value: 'keep', label: 'Ne pas modifier' },
                { value: 'none', label: 'Isolés' },
                { value: 'all', label: 'Tous les profils' },
              ]}
            />
            <p className="text-2xs text-muted-foreground">
              Pour relier des profils précis entre eux, utilisez « Nouveau lien » dans l&apos;onglet Liens d&apos;accès.
            </p>
          </div>
          {(error || invalid) && <Callout variant={error ? 'danger' : 'info'}>{error ?? invalid}</Callout>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={() => void apply()} disabled={saving || Boolean(invalid)} className="gap-1.5">
            {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
            Appliquer à {ids.length} profils
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Lets a set of profiles reach another set (optionally both ways). */
export function LinkDialog({
  open,
  profiles,
  initialSources = [],
  onOpenChange,
  onDone,
}: {
  open: boolean;
  profiles: VpnProfile[];
  initialSources?: string[];
  onOpenChange: (open: boolean) => void;
  onDone: (message: string) => void;
}) {
  const [sources, setSources] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [both, setBoth] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSources(initialSources);
    setTargets([]);
    setBoth(true);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const items = profiles.map((profile) => ({
    id: profile.id,
    label: profile.name,
    detail: `${profile.clientIp} · via ${profile.entryNode.name}`,
    tags: profile.tags,
  }));
  const invalid =
    sources.length === 0 || targets.length === 0
      ? 'Choisissez au moins un profil de chaque côté.'
      : sources.length === 1 && targets.length === 1 && sources[0] === targets[0]
        ? 'Un profil ne peut pas être relié à lui-même.'
        : null;
  const allOpen = profiles.filter((profile) => sources.includes(profile.id) && profile.access.peers === 'all');

  const apply = async () => {
    if (invalid) return;
    setSaving(true);
    setError(null);
    try {
      await api.vpn.bulk(sources, 'add_peers', { peerIds: targets });
      if (both) await api.vpn.bulk(targets, 'add_peers', { peerIds: sources });
      const count = sources.length * targets.length;
      onDone(`${count} lien${count > 1 ? 's' : ''} créé${count > 1 ? 's' : ''}${both ? ' dans les deux sens' : ''}.`);
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught, 'La création des liens a échoué.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Nouveau lien entre profils</DialogTitle>
          <DialogDescription>
            Les appareils de gauche pourront ouvrir des connexions vers ceux de droite, même via des points d&apos;entrée
            différents. Les autres règles des profils ne changent pas.
          </DialogDescription>
        </DialogHeader>
        <div className="grid items-start gap-3 md:grid-cols-[1fr_auto_1fr]">
          <div className="space-y-2">
            <Label>Ces profils…</Label>
            <SelectableList items={items} selected={sources} onChange={setSources} placeholder="Profil, libellé ou IP…" listClassName="max-h-72" />
          </div>
          <div className="flex justify-center pt-8 text-muted-foreground">
            {both ? <ArrowRightLeft className="h-5 w-5 text-primary" /> : <ArrowRight className="h-5 w-5" />}
          </div>
          <div className="space-y-2">
            <Label>…peuvent joindre ceux-ci</Label>
            <SelectableList items={items} selected={targets} onChange={setTargets} placeholder="Profil, libellé ou IP…" listClassName="max-h-72" />
          </div>
        </div>
        <label className="mt-4 flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-3 text-sm text-foreground">
          <Checkbox checked={both} onChange={(event) => setBoth(event.target.checked)} className="mt-0.5" />
          <span>
            Dans les deux sens
            <span className="block text-xs text-muted-foreground">
              Les profils de droite pourront aussi contacter ceux de gauche. Décochez pour un accès à sens unique (par exemple
              un poste d&apos;administration qui joint des appareils sans qu&apos;ils puissent le joindre).
            </span>
          </span>
        </label>
        {allOpen.length > 0 && (
          <Callout variant="info" className="mt-3">
            {allOpen.map((profile) => profile.name).join(', ')} {allOpen.length > 1 ? 'joignent' : 'joint'} déjà tous les profils.
          </Callout>
        )}
        {(error || (invalid && (sources.length > 0 || targets.length > 0))) && (
          <Callout variant={error ? 'danger' : 'warning'} className="mt-3">
            {error ?? invalid}
          </Callout>
        )}
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Annuler
          </Button>
          <Button onClick={() => void apply()} disabled={saving || Boolean(invalid)} className="gap-1.5">
            {saving && <LoaderCircle className="h-4 w-4 animate-spin" />}
            Créer les liens
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Adds or removes one label on a selection of profiles. */
export function TagDialog({
  targets,
  knownTags,
  onOpenChange,
  onDone,
}: {
  targets: VpnProfile[] | null;
  knownTags: string[];
  onOpenChange: (open: boolean) => void;
  onDone: (message: string) => void;
}) {
  const [tag, setTag] = useState('');
  const [saving, setSaving] = useState<'add_tag' | 'remove_tag' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTag('');
    setError(null);
  }, [targets]);

  if (!targets) return null;
  const run = async (action: 'add_tag' | 'remove_tag') => {
    if (!tag.trim()) return;
    setSaving(action);
    setError(null);
    try {
      await api.vpn.bulk(
        targets.map((profile) => profile.id),
        action,
        { tag: tag.trim() },
      );
      onDone(
        action === 'add_tag'
          ? `Libellé « ${tag.trim()} » ajouté à ${targets.length} profil(s).`
          : `Libellé « ${tag.trim()} » retiré de ${targets.length} profil(s).`,
      );
      onOpenChange(false);
    } catch (caught) {
      setError(errorMessage(caught, 'La modification a échoué.'));
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Libellés de {targets.length} profil(s)</DialogTitle>
          <DialogDescription>Regroupez les profils par équipe, site ou usage pour les filtrer et les relier plus vite.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input value={tag} maxLength={32} autoFocus onChange={(event) => setTag(event.target.value)} placeholder="Ex. Équipe support" list="vpn-known-tags" />
          <datalist id="vpn-known-tags">
            {knownTags.map((known) => (
              <option key={known} value={known} />
            ))}
          </datalist>
          {knownTags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {knownTags.slice(0, 12).map((known) => (
                <button
                  key={known}
                  type="button"
                  onClick={() => setTag(known)}
                  className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-2xs text-muted-foreground hover:text-foreground"
                >
                  {known}
                </button>
              ))}
            </div>
          )}
          {error && <Callout variant="danger">{error}</Callout>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => void run('remove_tag')} disabled={!tag.trim() || saving !== null}>
            {saving === 'remove_tag' && <LoaderCircle className="h-4 w-4 animate-spin" />}
            Retirer
          </Button>
          <Button onClick={() => void run('add_tag')} disabled={!tag.trim() || saving !== null} className="gap-1.5">
            {saving === 'add_tag' && <LoaderCircle className="h-4 w-4 animate-spin" />}
            Ajouter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
