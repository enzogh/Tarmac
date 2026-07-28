// Approximate country center points, used only as a last-resort placement on
// the world map for nodes that have neither a manual pin (dragged) nor a
// GeoIP lat/lng yet — just enough to land in the right country until the
// node is dragged to its exact spot. Not exhaustive: covers common hosting
// regions (Europe, North America, and other major cloud/DC markets).
export const COUNTRY_CENTROIDS: Record<string, [lat: number, lng: number]> = {
  FR: [46.6, 2.4],
  DE: [51.2, 10.4],
  GB: [54.0, -2.5],
  IE: [53.4, -8.2],
  NL: [52.2, 5.5],
  BE: [50.6, 4.6],
  LU: [49.8, 6.1],
  CH: [46.8, 8.2],
  AT: [47.6, 14.2],
  ES: [40.3, -3.7],
  PT: [39.6, -8.0],
  IT: [42.8, 12.6],
  PL: [52.0, 19.4],
  CZ: [49.8, 15.5],
  SK: [48.7, 19.5],
  HU: [47.2, 19.5],
  RO: [45.9, 24.9],
  BG: [42.7, 25.5],
  GR: [39.0, 22.0],
  SE: [62.0, 15.0],
  NO: [64.5, 13.0],
  FI: [64.5, 26.0],
  DK: [56.0, 10.0],
  IS: [64.9, -18.9],
  EE: [58.6, 25.0],
  LV: [56.9, 24.6],
  LT: [55.2, 23.9],
  UA: [48.4, 31.2],
  RU: [61.5, 90.0],
  TR: [39.0, 35.0],
  US: [39.8, -98.6],
  CA: [56.1, -106.3],
  MX: [23.6, -102.5],
  BR: [-14.2, -51.9],
  AR: [-38.4, -63.6],
  CL: [-35.7, -71.5],
  CO: [4.6, -74.3],
  SG: [1.35, 103.8],
  JP: [36.2, 138.3],
  KR: [35.9, 127.8],
  CN: [35.9, 104.2],
  HK: [22.3, 114.2],
  IN: [21.0, 78.0],
  ID: [-0.8, 113.9],
  AU: [-25.3, 133.8],
  NZ: [-41.0, 174.9],
  ZA: [-30.6, 22.9],
  AE: [23.4, 53.8],
  IL: [31.0, 34.8],
  SA: [23.9, 45.1],
  EG: [26.8, 30.8],
  MA: [31.8, -7.1],
};

export function countryCentroid(countryCode?: string | null): [number, number] | null {
  if (!countryCode) return null;
  return COUNTRY_CENTROIDS[countryCode.toUpperCase()] ?? null;
}
