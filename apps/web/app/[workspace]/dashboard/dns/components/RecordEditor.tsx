'use client';

import { useMemo, useState } from 'react';
import { CornerDownRight, LoaderCircle, MapPin, Plus, Server, Trash2, X } from 'lucide-react';
import { api, DnsRecordItem, DnsRecordType, NodeItem } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { flagFromCountryCode } from '@/lib/geo';
import { cn } from '@/lib/utils';
import { fqdn, nodePublicIp, RECORD_TYPE_ORDER, RECORD_TYPES, RecordTypeBadge, TTL_OPTIONS } from './dns-ui';

type ValueDraft = { content: string; priority: string; nodeId: string | null };

const emptyValue = (): ValueDraft => ({ content: '', priority: '', nodeId: null });
const NAME_PATTERN = /^(@|\*|(\*\.)?[a-zA-Z0-9_]([a-zA-Z0-9_-]*[a-zA-Z0-9_])?(\.[a-zA-Z0-9_]([a-zA-Z0-9_-]*[a-zA-Z0-9_])?)*)$/;

/**
 * Inline add/edit form for one RRset, opened in place in the records table
 * (Cloudflare-style) rather than in a modal that hides the list you're
 * working on. Every value field explains what it expects for the chosen
 * type, A/AAAA values can be picked straight from the fleet, and obvious
 * mistakes are flagged before anything is sent to the DNS servers.
 */
export function RecordEditor({
  zoneId,
  zoneName,
  record,
  nodes,
  onCancel,
  onSaved,
  onDeleted,
  onError,
}: {
  zoneId: string;
  zoneName: string;
  /** Undefined = new record. */
  record?: DnsRecordItem;
  nodes: NodeItem[];
  onCancel: () => void;
  onSaved: (message: string) => void;
  onDeleted?: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [type, setType] = useState<DnsRecordType>(record?.type ?? 'A');
  const [name, setName] = useState(record?.name ?? '');
  const [ttl, setTtl] = useState(record?.ttl ?? 3600);
  const [isGeo, setIsGeo] = useState(record?.isGeo ?? false);
  const [values, setValues] = useState<ValueDraft[]>(
    record?.values.length
      ? record.values.map((value) => ({
          content: value.content,
          priority: value.priority != null ? String(value.priority) : '',
          nodeId: value.nodeId ?? null,
        }))
      : [emptyValue()],
  );
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [touched, setTouched] = useState(false);

  const meta = RECORD_TYPES[type];
  // Fleet nodes whose public IP fits this record type (IPv4 for A, IPv6 for AAAA).
  const targetNodes = useMemo(
    () =>
      nodes
        .map((node) => ({ node, ip: nodePublicIp(node) }))
        .filter((entry): entry is { node: NodeItem; ip: string } => Boolean(entry.ip) && (type === 'AAAA') === entry.ip!.includes(':')),
    [nodes, type],
  );
  const ttlOptions = TTL_OPTIONS.some((option) => option.value === ttl)
    ? TTL_OPTIONS
    : [...TTL_OPTIONS, { value: ttl, label: `${ttl} s` }].sort((a, b) => a.value - b.value);

  const effectiveName = name.trim() || '@';
  const nameError = NAME_PATTERN.test(effectiveName) ? null : 'Lettres, chiffres, tirets et points uniquement';
  const valueErrors = values.map((value) => {
    const content = value.content.trim();
    if (!content) return values.length === 1 ? 'Valeur obligatoire' : null;
    if (meta.usesPriority && value.priority.trim() === '') return 'Priorité obligatoire';
    return meta.validate?.(content) ?? null;
  });
  const filled = values.filter((value) => value.content.trim());
  const hasErrors = Boolean(nameError) || valueErrors.some(Boolean) || filled.length === 0;
  const canGeo = (type === 'A' || type === 'AAAA' || type === 'CNAME') && filled.length >= 2;

  const updateValue = (index: number, patch: Partial<ValueDraft>) =>
    setValues((current) => current.map((value, i) => (i === index ? { ...value, ...patch } : value)));

  const save = async () => {
    setTouched(true);
    if (hasErrors) return;
    setSaving(true);
    try {
      await api.dns.zones.upsertRecord(zoneId, {
        name: effectiveName,
        type,
        ttl,
        isGeo: canGeo && isGeo,
        values: filled.map((value) => ({
          content: value.content.trim(),
          ...(value.nodeId && meta.nodeTarget ? { nodeId: value.nodeId } : {}),
          ...(meta.usesPriority ? { priority: Number(value.priority) } : {}),
        })),
      });
      // Records are keyed by name + type server-side: renaming or retyping
      // an existing one creates a new RRset, so the old one has to go.
      if (record && (record.name !== effectiveName || record.type !== type)) {
        await api.dns.zones.deleteRecord(zoneId, record.id);
      }
      onSaved(`${type} ${fqdn(effectiveName, zoneName)} enregistré.`);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : "L'enregistrement a échoué.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!record) return;
    if (!window.confirm(`Supprimer l'enregistrement ${record.type} ${fqdn(record.name, zoneName)} ?`)) return;
    setDeleting(true);
    try {
      await api.dns.zones.deleteRecord(zoneId, record.id);
      onDeleted?.(`${record.type} ${fqdn(record.name, zoneName)} supprimé.`);
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'La suppression a échoué.');
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4 rounded-lg border border-primary/30 bg-primary/[0.03] p-4">
      <div className="grid gap-3 sm:grid-cols-[10rem_1fr_9rem]">
        <div className="space-y-1.5">
          <Label htmlFor="record-type">Type</Label>
          <Select value={type} onValueChange={(value) => setType(value as DnsRecordType)}>
            <SelectTrigger id="record-type">
              {/* The items carry a description; the trigger only needs the type. */}
              <RecordTypeBadge type={type} />
            </SelectTrigger>
            <SelectContent className="max-h-80">
              {RECORD_TYPE_ORDER.map((option) => (
                <SelectItem key={option} value={option}>
                  <span className="flex items-center gap-2">
                    <RecordTypeBadge type={option} />
                    <span className="text-xs text-muted-foreground">{RECORD_TYPES[option].description}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="record-name">Nom</Label>
          <div
            className={cn(
              'flex h-9 items-center overflow-hidden rounded-lg border bg-zinc-950/70 shadow-insetSoft focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-ring',
              touched && nameError ? 'border-[hsl(var(--danger))]/60' : 'border-border',
            )}
          >
            <input
              id="record-name"
              value={name}
              autoFocus={!record}
              onChange={(event) => setName(event.target.value.replace(/\s/g, ''))}
              placeholder="@"
              className="h-full min-w-0 flex-1 bg-transparent px-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <span className="max-w-[50%] shrink-0 truncate border-l border-border px-3 font-mono text-xs text-muted-foreground">
              .{zoneName}
            </span>
          </div>
          <p className={cn('text-2xs', touched && nameError ? 'text-[hsl(var(--danger))]' : 'text-muted-foreground')}>
            {touched && nameError ? nameError : '@ pour le domaine lui-même, * pour tous les sous-domaines'}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="record-ttl">TTL</Label>
          <Select value={String(ttl)} onValueChange={(value) => setTtl(Number(value))}>
            <SelectTrigger id="record-ttl">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ttlOptions.map((option) => (
                <SelectItem key={option.value} value={String(option.value)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label>
            {meta.contentLabel}
            {values.length > 1 && <span className="ml-1.5 font-normal text-muted-foreground">({values.length} valeurs)</span>}
          </Label>
          {meta.hint && <span className="text-2xs text-muted-foreground">{meta.hint}</span>}
        </div>
        {values.map((value, index) => {
          const error = touched ? valueErrors[index] : null;
          const linkedNode = value.nodeId ? nodes.find((node) => node.id === value.nodeId) : undefined;
          return (
            <div key={index} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                {meta.usesPriority && (
                  <Input
                    type="number"
                    min={0}
                    value={value.priority}
                    onChange={(event) => updateValue(index, { priority: event.target.value })}
                    placeholder="Priorité"
                    aria-label="Priorité"
                    className="w-24"
                  />
                )}
                <Input
                  value={value.content}
                  onChange={(event) => updateValue(index, { content: event.target.value, nodeId: null })}
                  placeholder={meta.placeholder}
                  aria-label={meta.contentLabel}
                  className={cn('min-w-[12rem] flex-1 font-mono', error && 'border-[hsl(var(--danger))]/60')}
                />
                {meta.nodeTarget && targetNodes.length > 0 && (
                  <Select
                    value={value.nodeId ?? ''}
                    onValueChange={(nodeId) => {
                      const target = targetNodes.find((candidate) => candidate.node.id === nodeId);
                      if (target) updateValue(index, { content: target.ip, nodeId: target.node.id });
                    }}
                  >
                    <SelectTrigger className="w-44" aria-label="Choisir un nœud de la flotte">
                      {/* A div, not a span: SelectTrigger line-clamps direct span children. */}
                      <div className="flex min-w-0 items-center gap-1.5 text-xs">
                        <Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        <span className="truncate">{linkedNode ? linkedNode.name : 'Nœud de la flotte'}</span>
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      {targetNodes.map(({ node, ip }) => (
                        <SelectItem key={node.id} value={node.id}>
                          <span className="flex items-center gap-2">
                            <span>{flagFromCountryCode(node.locationCountryCode)}</span>
                            <span>{node.name}</span>
                            <span className="font-mono text-2xs text-muted-foreground">{ip}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <button
                  type="button"
                  onClick={() => setValues((current) => current.filter((_, i) => i !== index))}
                  disabled={values.length === 1}
                  aria-label="Retirer cette valeur"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-2 hover:text-foreground disabled:opacity-30"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {error && <p className="text-2xs text-[hsl(var(--danger))]">{error}</p>}
            </div>
          );
        })}
        <button
          type="button"
          onClick={() => setValues((current) => [...current, emptyValue()])}
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
        >
          <Plus className="h-3.5 w-3.5" />
          Ajouter une valeur
        </button>
      </div>

      {canGeo && (
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface-2 p-3">
          <input type="checkbox" checked={isGeo} onChange={(event) => setIsGeo(event.target.checked)} className="mt-0.5 h-4 w-4 rounded" />
          <span>
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <MapPin className="h-3.5 w-3.5 text-[hsl(var(--ok))]" />
              Géo-routage
            </span>
            <span className="block text-xs text-muted-foreground">
              Chaque visiteur reçoit la valeur la plus proche de lui géographiquement, au lieu d&apos;une rotation entre
              toutes.
            </span>
          </span>
        </label>
      )}

      {filled.length > 0 && !hasErrors && (
        <p className="flex items-start gap-1.5 font-mono text-2xs text-muted-foreground">
          <CornerDownRight className="mt-px h-3 w-3 shrink-0" />
          <span className="break-all">
            {fqdn(effectiveName, zoneName)} {type} →{' '}
            {filled.map((value) => `${meta.usesPriority ? `${value.priority} ` : ''}${value.content.trim()}`).join(' · ')}
            {canGeo && isGeo ? ' (le plus proche)' : ''}
          </span>
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        {record ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void remove()}
            disabled={deleting || saving}
            className="gap-1.5 text-[hsl(var(--danger))] hover:text-[hsl(var(--danger))]"
          >
            {deleting ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Supprimer
          </Button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={saving}>
            Annuler
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving || (touched && hasErrors)} className="gap-1.5">
            {saving && <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
            Enregistrer
          </Button>
        </div>
      </div>
    </div>
  );
}
