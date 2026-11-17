'use client';

import { useEffect, useState } from 'react';
import { Download, FileText, LoaderCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/Callout';
import { CopyButton } from '@/components/ui/copy-button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';

type Range = '6h' | '24h' | '48h';
type Lang = 'fr' | 'en';
type Report = { text: string; filename: string; generatedAt: string };

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Builds the incident report about one link that a hosting provider's
 * support needs: both public IPs, the measured loss over time, the
 * comparison with the servers' other links, and a trace of the internet
 * route run from each end.
 */
export function HostReportDialog({
  vlanId,
  nodeA,
  nodeB,
  onOpenChange,
}: {
  vlanId: string;
  nodeA: { id: string; name: string } | null;
  nodeB: { id: string; name: string } | null;
  onOpenChange: (open: boolean) => void;
}) {
  const open = Boolean(nodeA && nodeB);
  const [lang, setLang] = useState<Lang>('fr');
  const [range, setRange] = useState<Range>('24h');
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setReport(null);
    setError(null);
    setRunning(false);
  }, [open, nodeA?.id, nodeB?.id]);

  if (!nodeA || !nodeB) return null;

  const generate = async () => {
    setRunning(true);
    setError(null);
    try {
      setReport(await api.vlan.linkReport(vlanId, { source: nodeA.id, target: nodeB.id, range, lang }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'La génération du rapport a échoué.');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !running && onOpenChange(next)}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Rapport pour l’hébergeur
          </DialogTitle>
          <DialogDescription>
            {nodeA.name} ↔ {nodeB.name}. Un rapport prêt à joindre à un ticket : les IP publiques des deux serveurs, les pertes et
            la latence mesurées, la comparaison avec leurs autres liens, et le trajet internet relevé maintenant depuis chaque
            serveur.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label>Langue du rapport</Label>
              <Tabs value={lang} onValueChange={(value) => setLang(value as Lang)}>
                <TabsList variant="segmented">
                  <TabsTrigger value="fr" disabled={running}>
                    Français
                  </TabsTrigger>
                  <TabsTrigger value="en" disabled={running}>
                    English
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="space-y-1.5">
              <Label>Période analysée</Label>
              <Tabs value={range} onValueChange={(value) => setRange(value as Range)}>
                <TabsList variant="segmented">
                  <TabsTrigger value="6h" disabled={running}>
                    6 h
                  </TabsTrigger>
                  <TabsTrigger value="24h" disabled={running}>
                    24 h
                  </TabsTrigger>
                  <TabsTrigger value="48h" disabled={running}>
                    48 h
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <Button onClick={() => void generate()} disabled={running} className="gap-1.5">
              {running ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : report ? (
                <RefreshCw className="h-4 w-4" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              {running ? 'Génération…' : report ? 'Régénérer' : 'Générer le rapport'}
            </Button>
          </div>

          {running && (
            <Callout variant="info">
              Les deux serveurs tracent la route internet vers l’autre (10 sondes par saut) : comptez une quinzaine de secondes.
            </Callout>
          )}
          {error && <Callout variant="danger">{error}</Callout>}

          {report ? (
            <div className="space-y-2">
              <pre className="scroll-thin max-h-[50vh] overflow-auto rounded-lg border border-border bg-zinc-950/70 p-3 font-mono text-[11px] leading-[1.45] text-foreground">
                {report.text}
              </pre>
              <p className="text-2xs text-muted-foreground">
                Envoyez-le au support de l’hébergeur de chacun des deux serveurs : le trajet relevé montre où la route se dégrade.
                Les heures sont en UTC, comme les attend un support réseau.
              </p>
            </div>
          ) : (
            !running && (
              <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                Choisissez la langue de l’hébergeur et la période, puis générez le rapport.
              </p>
            )
          )}
        </div>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={running}>
            Fermer
          </Button>
          {report && (
            <>
              <CopyButton value={report.text} label="Copier le texte" />
              <Button onClick={() => download(report.filename, report.text)} className="gap-1.5">
                <Download className="h-4 w-4" />
                Télécharger (.txt)
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
