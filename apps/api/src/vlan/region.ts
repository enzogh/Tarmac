// Coarse continent buckets used to decide whether two VLAN members are
// "close" (full mesh, unchanged) or should route cross-region traffic
// through designated gateway nodes instead. Mirrors the country list in
// apps/web/lib/country-centroids.ts so the two never drift apart.
export type Region = 'europe' | 'north-america' | 'south-america' | 'asia' | 'oceania' | 'africa';

const REGION_BY_COUNTRY: Record<string, Region> = {
  FR: 'europe',
  DE: 'europe',
  GB: 'europe',
  IE: 'europe',
  NL: 'europe',
  BE: 'europe',
  LU: 'europe',
  CH: 'europe',
  AT: 'europe',
  ES: 'europe',
  PT: 'europe',
  IT: 'europe',
  PL: 'europe',
  CZ: 'europe',
  SK: 'europe',
  HU: 'europe',
  RO: 'europe',
  BG: 'europe',
  GR: 'europe',
  SE: 'europe',
  NO: 'europe',
  FI: 'europe',
  DK: 'europe',
  IS: 'europe',
  EE: 'europe',
  LV: 'europe',
  LT: 'europe',
  UA: 'europe',
  US: 'north-america',
  CA: 'north-america',
  MX: 'north-america',
  BR: 'south-america',
  AR: 'south-america',
  CL: 'south-america',
  CO: 'south-america',
  RU: 'asia',
  TR: 'asia',
  SG: 'asia',
  JP: 'asia',
  KR: 'asia',
  CN: 'asia',
  HK: 'asia',
  IN: 'asia',
  ID: 'asia',
  AE: 'asia',
  IL: 'asia',
  SA: 'asia',
  AU: 'oceania',
  NZ: 'oceania',
  ZA: 'africa',
  EG: 'africa',
  MA: 'africa',
};

/**
 * Returns null for unmapped or missing country codes — callers must treat a
 * null region as "same region as everything else" (safe full-mesh fallback),
 * never as a distinct segment of its own.
 */
export function resolveRegion(countryCode: string | null | undefined): Region | null {
  if (!countryCode) return null;
  return REGION_BY_COUNTRY[countryCode.toUpperCase()] ?? null;
}
