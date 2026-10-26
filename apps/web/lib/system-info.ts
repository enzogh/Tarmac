import { formatBytes, formatDuration } from './format';

// Hardware and OS reported by the agent with each heartbeat (Node.systemInfo
// on the API side, collectSystemInfo in the agent). Every field is optional:
// agents older than this report nothing, and some hosts (containers, ARM
// boards) don't expose all of it.
export type NodeSystemInfo = {
  cpuModel?: string;
  cpuThreads?: number;
  cpuCores?: number;
  cpuSockets?: number;
  cpuMhz?: number;
  load?: number[];
  memTotalBytes?: number;
  memAvailableBytes?: number;
  swapTotalBytes?: number;
  swapFreeBytes?: number;
  os?: string;
  kernel?: string;
  arch?: string;
  uptimeSec?: number;
  virtualization?: string;
};

const plural = (count: number, word: string) => `${count} ${word}${count > 1 ? 's' : ''}`;

/** "6 cœurs · 12 threads", or just the thread count when cores are unknown. */
export function cpuShape(info?: NodeSystemInfo | null): string | null {
  if (!info?.cpuThreads) return null;
  if (info.cpuCores && info.cpuCores !== info.cpuThreads) return `${plural(info.cpuCores, 'cœur')} · ${info.cpuThreads} threads`;
  return plural(info.cpuThreads, 'cœur');
}

/** Short CPU model without the vendor noise ("Intel(R) Xeon(R) CPU E5-1650 v4 @ 3.60GHz" -> "Xeon E5-1650 v4"). */
export function cpuModelShort(info?: NodeSystemInfo | null): string | null {
  if (!info?.cpuModel) return null;
  return info.cpuModel
    .replace(/\((R|TM|tm|r)\)/g, '')
    .replace(/\b(Intel|AMD|CPU|Processor|\d+-Core)\b/g, '')
    .replace(/@.*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Used / total RAM from the live percentage and the reported total. */
export function memoryUsage(info: NodeSystemInfo | null | undefined, ramPercent: number): { used: string; total: string; label: string } | null {
  if (!info?.memTotalBytes) return null;
  const used = (info.memTotalBytes * Math.max(0, Math.min(100, ramPercent))) / 100;
  const total = formatBytes(info.memTotalBytes);
  return { used: formatBytes(used), total, label: `${formatBytes(used)} / ${total}` };
}

/** 1-minute load as a share of the CPU's threads (1.0 per thread = saturated). */
export function loadRatio(info?: NodeSystemInfo | null): number | null {
  if (!info?.load?.length || !info.cpuThreads) return null;
  return info.load[0] / info.cpuThreads;
}

export const formatLoad = (value: number) => value.toLocaleString('fr-FR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

export function uptimeLabel(info?: NodeSystemInfo | null): string | null {
  return info?.uptimeSec ? formatDuration(info.uptimeSec) : null;
}

export function swapLabel(info?: NodeSystemInfo | null): string | null {
  if (!info?.swapTotalBytes) return info?.memTotalBytes ? 'Aucun' : null;
  const used = info.swapTotalBytes - (info.swapFreeBytes ?? 0);
  return `${formatBytes(used)} / ${formatBytes(info.swapTotalBytes)}`;
}
