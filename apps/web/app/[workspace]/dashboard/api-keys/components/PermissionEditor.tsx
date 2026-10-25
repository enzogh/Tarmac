'use client';

import { Eye, Lock, Pencil, ShieldAlert, Sparkles, SlidersHorizontal } from 'lucide-react';
import {
  AccessLevel,
  API_KEY_RESOURCES,
  fullPermissions,
  PermissionMap,
  PermissionPreset,
  presetOf,
  readOnlyPermissions,
} from '@/lib/api-key-permissions';
import { cn } from '@/lib/utils';

const PRESETS: Array<{ id: PermissionPreset; label: string; description: string; icon: typeof Sparkles }> = [
  { id: 'full', label: 'Accès complet', description: 'Tout lire et tout modifier', icon: Sparkles },
  { id: 'read', label: 'Lecture seule', description: 'Consulter sans rien changer', icon: Eye },
  { id: 'custom', label: 'Personnalisé', description: 'Choisir module par module', icon: SlidersHorizontal },
];

const LEVELS: Array<{ id: AccessLevel; label: string; icon?: typeof Eye }> = [
  { id: 'none', label: 'Aucun' },
  { id: 'read', label: 'Lecture', icon: Eye },
  { id: 'write', label: 'Lecture et écriture', icon: Pencil },
];

/**
 * Fine-grained permissions in the GitHub-token style: one row per area of
 * the API with a none / read / read-write switch, and presets on top for the
 * two cases most people want. Picking a preset just fills the rows; touching
 * a row makes it "Personnalisé" on its own.
 */
export function PermissionEditor({
  value,
  onChange,
}: {
  value: PermissionMap;
  onChange: (next: PermissionMap) => void;
}) {
  const preset = presetOf(value);
  const granted = API_KEY_RESOURCES.filter((resource) => value[resource.id] !== 'none').length;
  const writes = API_KEY_RESOURCES.filter((resource) => value[resource.id] === 'write');
  const warnings = writes.filter((resource) => resource.writeWarning);

  const applyPreset = (next: PermissionPreset) => {
    if (next === 'full') onChange(fullPermissions());
    if (next === 'read') onChange(readOnlyPermissions());
    // "Personnalisé" keeps the current rows: it's where they get edited.
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Niveau d'accès">
        {PRESETS.map((item) => {
          const active = preset === item.id;
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => applyPreset(item.id)}
              className={cn(
                'flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors',
                active ? 'border-primary/60 bg-primary/[0.07] ring-1 ring-primary/30' : 'border-border bg-surface-2 hover:border-primary/30',
              )}
            >
              <item.icon className={cn('mt-0.5 h-4 w-4 shrink-0', active ? 'text-primary' : 'text-muted-foreground')} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{item.label}</span>
                <span className="block text-2xs text-muted-foreground">{item.description}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-2/60 px-3 py-2 text-2xs text-muted-foreground">
          <span className="font-medium uppercase tracking-wider">Module</span>
          <span>
            {granted === 0
              ? 'Aucune permission'
              : `${granted} module${granted > 1 ? 's' : ''} · ${writes.length} en écriture`}
          </span>
        </div>
        <ul className="divide-y divide-border">
          {API_KEY_RESOURCES.map((resource) => {
            const level = value[resource.id];
            const Icon = resource.icon;
            const description = level === 'write' ? resource.write : level === 'read' ? resource.read : null;
            return (
              <li key={resource.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-2.5">
                  <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', level === 'none' ? 'text-muted-foreground' : 'text-primary')} />
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                      {resource.label}
                      <code className="font-mono text-2xs font-normal text-muted-foreground">{resource.id}</code>
                    </p>
                    <p className="text-2xs text-muted-foreground">{description ?? 'Aucun accès à ce module.'}</p>
                  </div>
                </div>
                <div
                  className="inline-flex shrink-0 self-start rounded-md border border-border bg-surface-2 p-0.5 sm:self-center"
                  role="radiogroup"
                  aria-label={`Accès ${resource.label}`}
                >
                  {LEVELS.map((item) => {
                    const unavailable = item.id === 'write' && !resource.write;
                    const active = level === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        disabled={unavailable}
                        title={unavailable ? 'Ce module est en lecture seule' : undefined}
                        onClick={() => onChange({ ...value, [resource.id]: item.id })}
                        className={cn(
                          'inline-flex h-7 items-center gap-1 rounded px-2 text-2xs transition-colors',
                          active
                            ? item.id === 'none'
                              ? 'bg-surface-3 font-medium text-foreground'
                              : 'bg-primary/15 font-medium text-foreground'
                            : 'text-muted-foreground hover:text-foreground',
                          'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-muted-foreground',
                        )}
                      >
                        {unavailable ? <Lock className="h-3 w-3" /> : item.icon && <item.icon className="h-3 w-3" />}
                        {item.id === 'write' ? 'Écriture' : item.label}
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {warnings.length > 0 && (
        <div className="flex gap-2 rounded-lg border border-[hsl(var(--warn))]/25 bg-[hsl(var(--warn))]/[0.06] px-3 py-2 text-2xs text-[hsl(var(--warn))]">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <ul className="space-y-0.5">
            {warnings.map((resource) => (
              <li key={resource.id}>
                <span className="font-medium">{resource.label} :</span> {resource.writeWarning}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-2xs text-muted-foreground">
        L&apos;écriture inclut la lecture. Aucune clé ne peut gérer les comptes, les workspaces, leurs membres ou les
        clés API elles-mêmes : ces actions demandent une session.
      </p>
    </div>
  );
}
