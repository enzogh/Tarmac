export type GeoInfo = {
  ip: string;
  city: string | null;
  country: string | null;
  countryCode: string | null;
};

const memoryCache = new Map<string, GeoInfo | null>();
const STORAGE_KEY = 'tarmac_geo_cache_v1';

type IpWhoResult = {
  success?: boolean;
  ip?: string;
  city?: string;
  country?: string;
  country_code?: string;
  message?: string;
};

const isBrowser = () => typeof window !== 'undefined';

const readStorageCache = (): Record<string, GeoInfo | null> => {
  if (!isBrowser()) return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, GeoInfo | null>;
  } catch {
    return {};
  }
};

const writeStorageCache = (cache: Record<string, GeoInfo | null>) => {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // ignore quota/storage errors
  }
};

export const parseHostFromEndpoint = (endpoint?: string | null) => {
  if (!endpoint) return null;
  const raw = endpoint.trim();
  if (!raw) return null;

  try {
    const value = raw.includes('://') ? raw : `udp://${raw}`;
    return new URL(value).hostname || null;
  } catch {
    if (raw.startsWith('[')) {
      const closeBracket = raw.indexOf(']');
      if (closeBracket > 1) return raw.slice(1, closeBracket);
    }
    const hostPort = raw.split('/')[0] || raw;
    const parts = hostPort.split(':');
    if (parts.length === 2 && /^\d+$/.test(parts[1])) {
      return parts[0] || null;
    }
    return hostPort || null;
  }
};

export const normalizeCountryCode = (value?: string | null) => {
  const trimmed = value?.trim().toUpperCase();
  if (!trimmed) return undefined;
  return trimmed.slice(0, 2);
};

export const flagFromCountryCode = (code?: string | null) => {
  if (!code || code.length !== 2) return '🏳️';
  const upper = code.toUpperCase();
  const chars = [...upper].map((char) => 0x1f1e6 + (char.charCodeAt(0) - 65));
  return String.fromCodePoint(...chars);
};

export const getGeoInfo = async (ip: string): Promise<GeoInfo | null> => {
  if (!ip) return null;

  if (memoryCache.has(ip)) return memoryCache.get(ip) ?? null;

  const storageCache = readStorageCache();
  if (ip in storageCache) {
    const cached = storageCache[ip];
    memoryCache.set(ip, cached);
    return cached;
  }

  try {
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`);
    if (!res.ok) {
      memoryCache.set(ip, null);
      return null;
    }
    const payload = (await res.json()) as IpWhoResult;
    if (payload.success === false) {
      memoryCache.set(ip, null);
      return null;
    }
    const info: GeoInfo = {
      ip: payload.ip ?? ip,
      city: payload.city?.trim() || null,
      country: payload.country?.trim() || null,
      countryCode: payload.country_code?.trim().toUpperCase() || null,
    };
    memoryCache.set(ip, info);
    storageCache[ip] = info;
    writeStorageCache(storageCache);
    return info;
  } catch {
    memoryCache.set(ip, null);
    return null;
  }
};
