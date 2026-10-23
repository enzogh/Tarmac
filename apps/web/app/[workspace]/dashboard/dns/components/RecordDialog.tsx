'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api, DnsRecordItem, DnsRecordType } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { HelpText } from '@/components/ui/wizard';
import { DnsNotice } from './useDnsPageState';

const RECORD_TYPES: DnsRecordType[] = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'CAA', 'SRV', 'PTR'];

type RecordValueDraft = { content: string; priority: string };

const emptyValueDraft = (): RecordValueDraft => ({ content: '', priority: '' });

export type RecordDialogTarget = { zoneId: string; record?: DnsRecordItem };

// Rendered with a `key` derived from `target` at the call site (see
// ZonesSection/page.tsx) so React remounts fresh local form state whenever
// a different record (or "new record" for a different zone) is opened,
// instead of needing a useEffect to resync state from props.
export function RecordDialog({
  target,
  onClose,
  onSaved,
  onNotice,
}: {
  target: RecordDialogTarget;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onNotice: (notice: DnsNotice) => void;
}) {
  const existing = target.record;
  const [recordForm, setRecordForm] = useState(
    existing
      ? { name: existing.name, type: existing.type, ttl: existing.ttl, isGeo: existing.isGeo }
      : { name: '@', type: 'A' as DnsRecordType, ttl: 3600, isGeo: false },
  );
  const [recordValues, setRecordValues] = useState<RecordValueDraft[]>(
    existing?.values.length
      ? existing.values.map((v) => ({
          content: v.content,
          priority: v.priority != null ? String(v.priority) : '',
        }))
      : [emptyValueDraft()],
  );
  const [saving, setSaving] = useState(false);

  const saveRecord = async () => {
    const values = recordValues
      .filter((v) => v.content.trim())
      .map((v) => ({
        content: v.content.trim(),
        ...(v.priority.trim() ? { priority: Number(v.priority) } : {}),
      }));
    if (!recordForm.name.trim() || values.length === 0) {
      onNotice({ type: 'error', message: 'Nom du record et au moins une valeur sont obligatoires.' });
      return;
    }
    setSaving(true);
    try {
      await api.dns.zones.upsertRecord(target.zoneId, {
        name: recordForm.name.trim(),
        type: recordForm.type,
        ttl: recordForm.ttl,
        isGeo: recordForm.isGeo,
        values,
      });
      onNotice({ type: 'success', message: 'Enregistrement DNS enregistré.' });
      onClose();
      await onSaved();
    } catch {
      onNotice({ type: 'error', message: "Erreur lors de l'enregistrement du record." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Enregistrement DNS</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="record-name">Nom</Label>
              <Input
                id="record-name"
                value={recordForm.name}
                onChange={(e) => setRecordForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="@ (apex) ou www"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="record-type">Type</Label>
              <Select
                value={recordForm.type}
                onValueChange={(value) => setRecordForm((prev) => ({ ...prev, type: value as DnsRecordType }))}
              >
                <SelectTrigger id="record-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RECORD_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="record-ttl">TTL (secondes)</Label>
              <Input
                id="record-ttl"
                type="number"
                min={1}
                value={recordForm.ttl}
                onChange={(e) => setRecordForm((prev) => ({ ...prev, ttl: Number(e.target.value) || 3600 }))}
              />
            </div>
            <label className="flex items-end gap-1.5 pb-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={recordForm.isGeo}
                onChange={(e) => setRecordForm((prev) => ({ ...prev, isGeo: e.target.checked }))}
                className="h-4 w-4 rounded"
              />
              Géo-routage
              <HelpText text="Au lieu de renvoyer toujours la même valeur, PowerDNS choisit automatiquement, à chaque requête, celle géographiquement la plus proche du client qui interroge. Utile quand plusieurs serveurs dans des régions différentes servent le même nom : un visiteur en Europe reçoit l'IP du serveur européen, un visiteur aux US celle du serveur américain." />
            </label>
          </div>

          <div className="space-y-2">
            <Label>Valeurs {recordForm.isGeo && '(candidats géo-routés)'}</Label>
            {recordValues.map((value, index) => (
              <div key={index} className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 p-2">
                <Input
                  value={value.content}
                  onChange={(e) =>
                    setRecordValues((prev) => prev.map((v, i) => (i === index ? { ...v, content: e.target.value } : v)))
                  }
                  placeholder="IP, hostname ou texte selon le type"
                  className="min-w-[10rem] flex-1"
                />
                {(recordForm.type === 'MX' || recordForm.type === 'SRV') && (
                  <Input
                    type="number"
                    value={value.priority}
                    onChange={(e) =>
                      setRecordValues((prev) => prev.map((v, i) => (i === index ? { ...v, priority: e.target.value } : v)))
                    }
                    placeholder="priorité"
                    className="w-24"
                  />
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRecordValues((prev) => prev.filter((_, i) => i !== index))}
                  disabled={recordValues.length === 1}
                  className="text-rose-300 hover:text-rose-200"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button variant="secondary" size="sm" className="gap-1" onClick={() => setRecordValues((prev) => [...prev, emptyValueDraft()])}>
              <Plus className="h-3.5 w-3.5" />
              Ajouter une valeur
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={saveRecord} disabled={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
