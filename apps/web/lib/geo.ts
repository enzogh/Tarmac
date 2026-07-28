export type GeoInfo = {
  ip: string;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  latitude: number | null;
  longitude: number | null;
};

const memoryCache = new Map<string, GeoInfo | null>();
const STORAGE_KEY = 'tarmac_geo_cache_v1';

export type GeocodeResult = { lat: number; lng: number };

const geocodeMemoryCache = new Map<string, GeocodeResult | null>();
const GEOCODE_STORAGE_KEY = 'tarmac_geocode_cache_v1';

type NominatimResult = { lat: string; lon: string };

type IpWhoResult = {
  success?: boolean;
  ip?: string;
  city?: string;
  country?: string;
  country_code?: string;
  latitude?: number;
  longitude?: number;
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
      latitude: typeof payload.latitude === 'number' ? payload.latitude : null,
      longitude: typeof payload.longitude === 'number' ? payload.longitude : null,
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

// Manually-typed locations (e.g. correcting "Roubaix" over a wrong GeoIP
// guess) need real coordinates too, otherwise the map can only fall back to
// a country-wide centroid and several corrected nodes collapse onto the same
// point. Nominatim (OpenStreetMap) resolves the free-text city/country into
// a lat/lng, cached the same way as the IP lookup above.
export const geocodeCity = async (city: string, country?: string | null): Promise<GeocodeResult | null> => {
  const query = [city.trim(), country?.trim()].filter(Boolean).join(', ');
  if (!query) return null;
  const key = query.toLowerCase();

  if (geocodeMemoryCache.has(key)) return geocodeMemoryCache.get(key) ?? null;

  const storageCache = isBrowser()
    ? ((): Record<string, GeocodeResult | null> => {
        try {
          const raw = localStorage.getItem(GEOCODE_STORAGE_KEY);
          return raw ? (JSON.parse(raw) as Record<string, GeocodeResult | null>) : {};
        } catch {
          return {};
        }
      })()
    : {};
  if (key in storageCache) {
    const cached = storageCache[key];
    geocodeMemoryCache.set(key, cached);
    return cached;
  }

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
    );
    if (!res.ok) {
      geocodeMemoryCache.set(key, null);
      return null;
    }
    const results = (await res.json()) as NominatimResult[];
    const first = results[0];
    const result: GeocodeResult | null =
      first && Number.isFinite(parseFloat(first.lat)) && Number.isFinite(parseFloat(first.lon))
        ? { lat: parseFloat(first.lat), lng: parseFloat(first.lon) }
        : null;
    geocodeMemoryCache.set(key, result);
    storageCache[key] = result;
    if (isBrowser()) {
      try {
        localStorage.setItem(GEOCODE_STORAGE_KEY, JSON.stringify(storageCache));
      } catch {
        // ignore quota/storage errors
      }
    }
    return result;
  } catch {
    geocodeMemoryCache.set(key, null);
    return null;
  }
};
