'use client';

import { useMemo } from 'react';
import { NodeComparisonChart } from '@/components/dashboard-charts';
import { SectionLabel } from '@/components/SectionLabel';
import { ServerTrendCard } from '@/components/ServerTrendCard';
import { Card, CardContent } from '@/components/ui/card';
import { CardListSkeleton, ChartCardSkeleton } from '@/components/ui/skeleton';
import { api, NodeActivityItem, NodeMetricSample } from '@/lib/api';
import { usePolling } from '@/lib/hooks/usePolling';

export function PerformanceTab({
  nodes,
  loading,
  labels,
}: {
  nodes: NodeActivityItem[];
  loading: boolean;
  labels: Record<string, string[]>;
}) {
  const sortedByCpu = useMemo(() => [...nodes].sort((left, right) => right.metrics.cpu - left.metrics.cpu), [nodes]);
  const topNodes = sortedByCpu.slice(0, 6);
  const topNodeIds = topNodes.map((node) => node.id);
  const avgCpu = nodes.length ? nodes.reduce((acc, node) => acc + node.metrics.cpu, 0) / nodes.length : 0;
  const avgRam = nodes.length ? nodes.reduce((acc, node) => acc + node.metrics.ram, 0) / nodes.length : 0;

  // Mounted only while the tab is shown: this is the heaviest poll of the
  // page (up to 6 nodes' full history per tick).
  const { data: samplesByNode = {} } = usePolling(
    topNodeIds.length > 0 ? `metrics:${topNodeIds.join(',')}:6h` : null,
    async () => {
      const histories = await Promise.all(topNodeIds.map(async (id) => [id, await api.nodes.metrics(id, '6h')] as const));
      return Object.fromEntries(histories) as Record<string, NodeMetricSample[]>;
    },
    { intervalMs: 20000 },
  );

  const comparison = useMemo(
    () => sortedByCpu.map((node) => ({ name: node.name, cpu: Math.round(node.metrics.cpu), ram: Math.round(node.metrics.ram) })),
    [sortedByCpu],
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <ChartCardSkeleton />
        <CardListSkeleton cards={4} />
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <SectionLabel>Comparaison CPU / RAM par nœud</SectionLabel>
          <p className="text-xs text-muted-foreground">
            Moyenne flotte : <span className="font-medium text-foreground">{Math.round(avgCpu)}% CPU</span> ·{' '}
            <span className="font-medium text-foreground">{Math.round(avgRam)}% RAM</span>
          </p>
        </div>
        <Card>
          <CardContent className="pt-6">
            <NodeComparisonChart data={comparison} />
          </CardContent>
        </Card>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <SectionLabel>Détail par nœud</SectionLabel>
          <p className="text-xs text-muted-foreground">Les 6 nœuds les plus chargés en CPU</p>
        </div>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {topNodes.map((node) => (
            <ServerTrendCard key={node.id} node={node} samples={samplesByNode[node.id] ?? []} labels={labels[node.id] ?? []} />
          ))}
          {nodes.length === 0 && <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Aucun nœud détecté pour le moment.</p>}
        </div>
      </section>
    </div>
  );
}
