// One place for every number the dashboard shows. Before this, each page
// carried its own `formatBytes`/`formatMbps` copy with slightly different
// rounding and units, which is how the overview ended up printing raw
// "32693 GB" next to another page's "31.9 TB" for the same figure.

const FR = 'fr-FR';

/** Thousands-separated integer, e.g. 32 693. */
export function formatInt(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(FR, { maximumFractionDigits: 0 }).format(value);
}

/** Percentage with no decimals, e.g. 72 %. */
export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '—';
  return `${Math.round(value)} %`;
}

/**
 * A capacity expressed in gigabytes, scaled to the largest unit that keeps
 * the number short. Storage figures in this app come from the agent in GB.
 */
export function formatCapacityGb(gigabytes: number): { value: string; unit: string } {
  if (!Number.isFinite(gigabytes) || gigabytes < 0) return { value: '—', unit: '' };
  if (gigabytes >= 1_000_000) return { value: round(gigabytes / 1_000_000), unit: 'PB' };
  if (gigabytes >= 1_000) return { value: round(gigabytes / 1_000), unit: 'TB' };
  return { value: round(gigabytes), unit: 'GB' };
}

/** Same, as a single string. */
export function formatCapacity(gigabytes: number): string {
  const { value, unit } = formatCapacityGb(gigabytes);
  return unit ? `${value} ${unit}` : value;
}

/** A raw byte count, scaled. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'kB', 'MB', 'GB', 'TB', 'PB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${round(bytes / 1024 ** index)} ${units[index]}`;
}

/**
 * A throughput the agent reports in bytes per second. Network rates are
 * conventionally read in bits, so this converts and labels accordingly -
 * the previous helpers multiplied by 8 and then still wrote "MB/s".
 */
export function formatThroughput(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '0 Mb/s';
  const megabits = (bytesPerSecond * 8) / 1_000_000;
  if (megabits >= 1000) return `${round(megabits / 1000)} Gb/s`;
  if (megabits >= 1) return `${round(megabits)} Mb/s`;
  return `${round(megabits * 1000)} kb/s`;
}

/** Absolute date + time, e.g. 23/10/2026 23:04. */
export function formatDateTime(value?: string | Date | null): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(FR, { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

/** Time only, for dense tables and chart axes. */
export function formatTime(value?: string | Date | null): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat(FR, { hour: '2-digit', minute: '2-digit' }).format(date);
}

/**
 * "il y a 3 min" / "il y a 2 h". Operators read a fleet by recency far more
 * than by wall-clock time, so lists lead with this and keep the absolute
 * timestamp in a tooltip.
 */
export function formatRelative(value?: string | Date | null): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 0) return "à l'instant";
  if (seconds < 60) return "à l'instant";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 31) return `il y a ${days} j`;
  return formatDateTime(date);
}

/** Seconds as a compact duration, e.g. 4 min 12 s. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${Math.round(seconds % 60)} s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} j ${hours % 24} h`;
}

function round(value: number): string {
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : value >= 1 ? 2 : 2;
  return new Intl.NumberFormat(FR, { maximumFractionDigits: digits }).format(value);
}

/**
 * Node names are provider-assigned FQDNs ("ns3193972.ip-152-228-250.eu").
 * Chart axes and legends only have room for what distinguishes them, which
 * is the first label; the full name stays in the tooltip or `title`.
 */
export function shortHostname(name: string): string {
  const [first] = name.split('.');
  return first || name;
}
