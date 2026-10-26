'use client';

import { useEffect, useState } from 'react';
import { FolderSearch, HardDrive, RefreshCcw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/Callout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DirectoryBrowser } from '@/components/ui/directory-browser';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { NODE_STATUS, StatusDot, describe } from '@/components/ui/status';
import { api, DirectoryScanEntry, NodeActivityItem } from '@/lib/api';

const formatBytes = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const index = Math.min(units.length - 1, Math.max(0, Math.floor(Math.log(value) / Math.log(1024))));
  const scaled = value / 1024 ** index;
  return `${scaled >= 10 ? scaled.toFixed(0) : scaled.toFixed(1)} ${units[index]}`;
};

export function ExplorationTab({ nodes }: { nodes: NodeActivityItem[] }) {
  const [nodeId, setNodeId] = useState('');
  const [browsePath, setBrowsePath] = useState('/');
  const [selectedPath, setSelectedPath] = useState('/');
  const [directories, setDirectories] = useState<string[]>([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResults, setScanResults] = useState<DirectoryScanEntry[]>([]);
  const [scanTruncated, setScanTruncated] = useState(false);
  // Explorer failures belong to this panel, not to the page-wide notice: a
  // node whose agent simply can't be browsed is normal.
  const [error, setError] = useState<string | null>(null);

  const loadDirectories = async (id: string, basePath: string) => {
    if (!id) return;
    setDirectoryLoading(true);
    setError(null);
    try {
      const payload = await api.migrations.listDirectories(id, basePath || '/');
      setBrowsePath(payload.basePath);
      setDirectories([...payload.directories].sort((a, b) => a.localeCompare(b)));
    } catch {
      setDirectories([]);
      setError('Navigation distante indisponible sur ce nœud (agent hors ligne ou accès refusé).');
    } finally {
      setDirectoryLoading(false);
    }
  };

  const runScan = async () => {
    if (!nodeId) return;
    setScanLoading(true);
    setError(null);
    try {
      const payload = await api.migrations.scanDirectories(nodeId, selectedPath || browsePath, 20);
      setScanResults(payload.entries);
      setScanTruncated(payload.truncated);
    } catch {
      setScanResults([]);
      setScanTruncated(false);
      setError('Scan volumétrique indisponible. Vérifiez la connectivité de l’agent.');
    } finally {
      setScanLoading(false);
    }
  };

  const selectNode = (id: string) => {
    setNodeId(id);
    setBrowsePath('/');
    setSelectedPath('/');
    setDirectories([]);
    setScanResults([]);
    setScanTruncated(false);
  };

  useEffect(() => {
    if (nodes.length === 0 || nodes.some((node) => node.id === nodeId)) return;
    selectNode((nodes.find((node) => node.status === 'online') ?? nodes[0]).id);
  }, [nodes, nodeId]);

  useEffect(() => {
    if (nodeId) void loadDirectories(nodeId, '/');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodeId]);

  const selectedNode = nodes.find((node) => node.id === nodeId) ?? null;
  const scanMax = scanResults[0]?.sizeBytes ?? 1;
  const sortedNodes = [...nodes].sort((left, right) => left.name.localeCompare(right.name));

  return (
    <div className="space-y-4">
      <Callout>Parcourez les dossiers d’un nœud puis lancez un scan volumétrique pour repérer les répertoires les plus lourds.</Callout>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 xl:grid-cols-[1.25fr_minmax(0,1fr)]">
        <Card>
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <FolderSearch className="h-4 w-4 text-primary" />
              Navigateur de dossiers
            </CardTitle>
            {/* A select, not one button per node: with 40 servers the
                button grid pushed the browser itself off screen. */}
            <Select value={nodeId} onValueChange={selectNode}>
              <SelectTrigger className="h-8 w-64">
                <SelectValue placeholder="Choisir un nœud" />
              </SelectTrigger>
              <SelectContent>
                {sortedNodes.map((node) => (
                  <SelectItem key={node.id} value={node.id}>
                    <span className="flex items-center gap-2">
                      <StatusDot tone={describe(NODE_STATUS, node.status).tone} />
                      {node.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            <DirectoryBrowser
              title={selectedNode ? `Exploration : ${selectedNode.name}` : 'Exploration'}
              description="Navigation distante via l’agent. Sélectionnez un dossier puis lancez le scan volumétrique."
              currentPath={browsePath}
              selectedPath={selectedPath}
              directories={directories}
              loading={directoryLoading}
              disabled={!nodeId}
              onBrowse={(path) => nodeId && void loadDirectories(nodeId, path)}
              onSelect={setSelectedPath}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
              Dossiers volumineux
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted-foreground">
              <p className="font-mono text-foreground/90">{selectedPath || browsePath}</p>
              <p className="mt-1">Classe les dossiers les plus lourds du chemin sélectionné.</p>
            </div>
            <Button onClick={() => void runScan()} disabled={!nodeId || scanLoading} className="w-full gap-2">
              <RefreshCcw className={`h-4 w-4 ${scanLoading ? 'animate-spin' : ''}`} />
              {scanLoading ? 'Scan en cours…' : 'Scanner les dossiers volumineux'}
            </Button>
            <div className="space-y-2">
              {scanResults.map((entry) => (
                <div key={entry.path} className="rounded-lg border border-border bg-surface-2 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2 text-xs">
                    <p className="truncate font-mono text-foreground/90">{entry.path}</p>
                    <p className="shrink-0 font-semibold text-foreground">{formatBytes(entry.sizeBytes)}</p>
                  </div>
                  <Progress value={(entry.sizeBytes / scanMax) * 100} className="h-1.5" />
                </div>
              ))}
              {!scanLoading && scanResults.length === 0 && (
                <p className="rounded-lg border border-dashed border-border bg-surface-2 px-3 py-4 text-center text-xs text-muted-foreground">
                  Aucun résultat de scan pour le moment.
                </p>
              )}
              {scanTruncated && <p className="text-2xs text-[hsl(var(--warn))]">Résultat partiel : scan borné pour rester réactif.</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
