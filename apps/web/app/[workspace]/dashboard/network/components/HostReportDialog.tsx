'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Download, FileText, History, LoaderCircle, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/Callout';
import { CopyButton } from '@/components/ui/copy-button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, type LinkCapture } from '@/lib/api';

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
 * comparison with the servers' other links, and the tests support asks for
 * before escalating (top, ping, traceroute, MTR), run from each end.
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
  const [captures, setCaptures] = useState<LinkCapture[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setReport(null);
    setError(null);
    setRunning(false);
  }, [open, nodeA?.id, nodeB?.id]);

  useEffect(() => {
    if (!nodeA || !nodeB) return;
    let cancelled = false;
    setCaptures(null);
    api.vlan
      .linkCaptures(vlanId, nodeA.id, nodeB.id, range)
      .then((list) => !cancelled && setCaptures(list))
      .catch(() => !cancelled && setCaptures([]));
    return () => {
      cancelled = true;
    };
  }, [vlanId, nodeA?.id, nodeB?.id, range, report]);

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
            la latence mesurées, la comparaison avec leurs autres liens, et les tests qu’exigent les supports réseau (charge avec
            top, ping, traceroute et MTR), lancés maintenant depuis chacun des deux serveurs vers l’autre.
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

          <CaptureList captures={captures} nodeA={nodeA.name} nodeB={nodeB.name} />

          {running && (
            <Callout variant="info">
              Chaque serveur lance top, un ping de 100 paquets, un traceroute et un MTR de 30 cycles vers l’autre : comptez
              environ 35 secondes.
            </Callout>
          )}
          {error && <Callout variant="danger">{error}</Callout>}

          {report ? (
            <div className="space-y-2">
              <pre className="scroll-thin max-h-[50vh] overflow-auto rounded-lg border border-border bg-zinc-950/70 p-3 font-mono text-[11px] leading-[1.45] text-foreground">
                {report.text}
              </pre>
              <p className="text-2xs text-muted-foreground">
                Envoyez-le au support de l’hébergeur de chacun des deux serveurs : les tests capturés pendant l’incident montrent où
                la route se dégradait. Les heures sont en UTC, comme les attend un support réseau.
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

const timeFormat = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function lossVariant(loss: number | null): 'success' | 'warning' | 'destructive' | 'secondary' {
  if (loss === null) return 'secondary';
  if (loss === 0) return 'success';
  return loss >= 5 ? 'destructive' : 'warning';
}

/**
 * The tests Tarmac ran by itself when the link degraded: what makes the
 * report convincing once the incident is over.
 */
function CaptureList({ captures, nodeA, nodeB }: { captures: LinkCapture[] | null; nodeA: string; nodeB: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2/40">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <History className="h-4 w-4 text-muted-foreground" />
          Tests capturés pendant les dégradations
        </p>
        {captures && captures.length > 0 && (
          <span className="text-2xs text-muted-foreground">
            {captures.length} sur la période · {captures.filter((c) => c.included).length} joint{captures.filter((c) => c.included).length > 1 ? 's' : ''} au rapport
          </span>
        )}
      </div>
      {captures === null ? (
        <p className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          Chargement…
        </p>
      ) : captures.length === 0 ? (
        <p className="px-3 py-3 text-xs leading-relaxed text-muted-foreground">
          Aucune capture sur cette période. Dès que ce lien se dégrade, Tarmac lance de lui-même top, ping, traceroute et MTR depuis
          les deux serveurs (au plus une fois par demi-heure) : le rapport aura ainsi des preuves prises pendant l’incident, même
          si vous le générez une fois le problème passé.
        </p>
      ) : (
        <ul className="scroll-thin max-h-40 divide-y divide-border overflow-auto">
          {captures.map((capture) => (
            <li key={capture.at} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
              <span className="w-28 shrink-0 tabular-nums text-muted-foreground">{timeFormat.format(new Date(capture.at))}</span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-1">
                {capture.direction === 'AB' ? nodeA : nodeB}
                <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                {capture.direction === 'AB' ? nodeB : nodeA}
                <span className="whitespace-nowrap text-muted-foreground">
                  {capture.status === 'offline' ? 'coupé' : 'dégradé'}
                  {capture.triggerLoss !== null && ` (${Math.round(capture.triggerLoss)} % de perte)`}
                </span>
              </span>
              <span className="ml-auto flex items-center gap-1.5">
                <Badge variant={lossVariant(capture.measuredLoss)}>
                  {capture.measuredLoss === null
                    ? 'perte non mesurée'
                    : capture.measuredLoss === 0
                      ? 'aucune perte aux tests'
                      : `${capture.measuredLoss} % perdus aux tests`}
                </Badge>
                {!capture.complete && <Badge variant="secondary">un seul côté</Badge>}
                {capture.included && <Badge variant="info">joint au rapport</Badge>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
