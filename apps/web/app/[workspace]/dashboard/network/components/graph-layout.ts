import { packEnclose, packSiblings } from 'd3-hierarchy';

/**
 * Layout of the private-network graph as nested "parcels": region → country
 * → city → nodes, each level a bubble packed tightly around its children.
 * Pure functions, no React: the page computes default node positions once
 * per fleet shape, then re-encloses parcels around wherever nodes actually
 * are (so a dragged node stretches its bubbles instead of escaping them).
 */

export type LayoutMember = {
  id: string;
  region: string | null;
  country: string;
  countryCode: string | null;
  city: string;
};

export type ParcelKind = 'region' | 'country' | 'city';

export type Parcel = {
  id: string;
  kind: ParcelKind;
  region: string;
  label: string;
  // What's left of the label when it doesn't fit (the country without its city).
  shortLabel: string;
  countryCode: string | null;
  nodeIds: string[];
  x: number;
  y: number;
  r: number;
};

type Point = { x: number; y: number };

// A node draws as a disc at (x, y) with a name plate below it: this circle,
// centred a little lower, is what the packing keeps apart. The plate's
// corners may poke slightly past it, into the parcel padding.
export const NODE_DISC_RADIUS = 22;
export const NODE_FOOTPRINT_RADIUS = 54;
const NODE_FOOTPRINT_DY = 20;

// Room between a parcel's edge and its children: also where the parcel's
// label sits, along its top edge.
const PADDING: Record<ParcelKind, number> = { city: 16, country: 22, region: 28 };
// Gap between neighbouring region bubbles.
const REGION_GAP = 36;

type Circle = { x: number; y: number; r: number };

type GroupNode = {
  key: string;
  kind: ParcelKind;
  region: string;
  label: string;
  shortLabel: string;
  countryCode: string | null;
  children: GroupNode[];
  memberIds: string[];
};

const UNKNOWN_REGION = 'unknown';

const sortKey = (label: string) => label.toLocaleLowerCase('fr');

/**
 * Builds the region → country → (city) tree. The city level is dropped for a
 * country with a single city (the country label carries it instead), which
 * removes one ring of bubbles in the common case.
 */
function buildTree(members: LayoutMember[]): GroupNode[] {
  const regions = new Map<string, Map<string, Map<string, LayoutMember[]>>>();
  for (const member of members) {
    const region = member.region ?? UNKNOWN_REGION;
    const countries = regions.get(region) ?? new Map<string, Map<string, LayoutMember[]>>();
    regions.set(region, countries);
    const cities = countries.get(member.country) ?? new Map<string, LayoutMember[]>();
    countries.set(member.country, cities);
    const list = cities.get(member.city) ?? [];
    list.push(member);
    cities.set(member.city, list);
  }

  const byLabel = (a: [string, unknown], b: [string, unknown]) => sortKey(a[0]).localeCompare(sortKey(b[0]), 'fr');
  return Array.from(regions.entries())
    // Known regions first, unknown last; then alphabetical.
    .sort((a, b) => Number(a[0] === UNKNOWN_REGION) - Number(b[0] === UNKNOWN_REGION) || byLabel(a, b))
    .map(([region, countries]) => ({
      key: `region:${region}`,
      kind: 'region' as const,
      region,
      label: region,
      shortLabel: region,
      countryCode: null,
      memberIds: [],
      children: Array.from(countries.entries())
        .sort(byLabel)
        .map(([country, cities]) => {
          const cityEntries = Array.from(cities.entries()).sort(byLabel);
          const sample = cityEntries[0][1][0];
          const single = cityEntries.length === 1;
          return {
            key: `country:${region}:${country}`,
            kind: 'country' as const,
            region,
            label: single ? countryWithCity(country, cityEntries[0][0]) : country,
            shortLabel: country,
            countryCode: sample.countryCode,
            memberIds: single ? sortedIds(cityEntries[0][1]) : [],
            children: single
              ? []
              : cityEntries.map(([city, list]) => ({
                  key: `city:${region}:${country}:${city}`,
                  kind: 'city' as const,
                  region,
                  label: city,
                  shortLabel: city,
                  countryCode: sample.countryCode,
                  memberIds: sortedIds(list),
                  children: [],
                })),
          };
        }),
    }));
}

// "Singapour · Singapour" and "France · Ville inconnue" say nothing more
// than the country alone.
const UNKNOWN_CITY = 'Ville inconnue';
function countryWithCity(country: string, city: string) {
  return city === UNKNOWN_CITY || city.toLocaleLowerCase('fr') === country.toLocaleLowerCase('fr') ? country : `${country} · ${city}`;
}

function sortedIds(list: LayoutMember[]) {
  return list.map((member) => member.id).sort();
}

/**
 * Packs a set of circles around the origin and returns their offsets plus
 * the enclosing radius (including `padding`). The children are re-centred
 * on the enclosing circle, not on the packing's own origin, so the parent's
 * centre really is the middle of its bubble.
 */
function packGroup(radii: number[], padding: number): { offsets: Point[]; r: number } {
  const circles: Circle[] = radii.map((r) => ({ x: 0, y: 0, r }));
  packSiblings(circles);
  const enclosing = packEnclose(circles) ?? { x: 0, y: 0, r: 0 };
  return {
    offsets: circles.map((circle) => ({ x: circle.x - enclosing.x, y: circle.y - enclosing.y })),
    r: enclosing.r + padding,
  };
}

type Placed = { r: number; place: (cx: number, cy: number, out: Map<string, Point>) => void };

function layoutGroup(group: GroupNode): Placed {
  const items: Placed[] = [
    ...group.children.map(layoutGroup),
    ...group.memberIds.map(
      (id): Placed => ({
        r: NODE_FOOTPRINT_RADIUS,
        place: (cx, cy, out) => out.set(id, { x: cx, y: cy - NODE_FOOTPRINT_DY }),
      }),
    ),
  ];
  const { offsets, r } = packGroup(
    items.map((item) => item.r),
    PADDING[group.kind],
  );
  return {
    r,
    place: (cx, cy, out) => items.forEach((item, index) => item.place(cx + offsets[index].x, cy + offsets[index].y, out)),
  };
}

type Arrangement = { offsets: Point[]; width: number; height: number };

function boundsOf(offsets: Point[], radii: number[]): Arrangement {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  offsets.forEach((offset, index) => {
    minX = Math.min(minX, offset.x - radii[index]);
    minY = Math.min(minY, offset.y - radii[index]);
    maxX = Math.max(maxX, offset.x + radii[index]);
    maxY = Math.max(maxY, offset.y + radii[index]);
  });
  // Re-centre the arrangement on (0, 0).
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { offsets: offsets.map((offset) => ({ x: offset.x - cx, y: offset.y - cy })), width: maxX - minX, height: maxY - minY };
}

/** Regions laid out in `rows` shelves, each row centred, biggest first. */
function shelves(radii: number[], rows: number): Arrangement {
  const order = radii.map((r, index) => ({ r, index })).sort((a, b) => b.r - a.r);
  const lines: Array<typeof order> = Array.from({ length: rows }, () => []);
  const widths = new Array(rows).fill(0);
  // Greedy: each region goes on the currently narrowest row.
  for (const item of order) {
    const row = widths.indexOf(Math.min(...widths));
    lines[row].push(item);
    widths[row] += item.r * 2;
  }
  const offsets: Point[] = new Array(radii.length);
  let y = 0;
  for (const line of lines.filter((items) => items.length > 0)) {
    const height = Math.max(...line.map((item) => item.r)) * 2;
    let x = 0;
    for (const item of line) {
      offsets[item.index] = { x: x + item.r, y: y + height / 2 };
      x += item.r * 2;
    }
    const shift = x / 2;
    for (const item of line) offsets[item.index].x -= shift;
    y += height;
  }
  return boundsOf(offsets, radii);
}

/**
 * Picks how the region bubbles sit next to each other for a viewport of
 * this aspect ratio: tightly packed, or in one or more rows. Whichever lets
 * the whole graph be drawn the biggest wins — a wide card favours a row,
 * a phone a column.
 */
function arrangeRegions(radii: number[], aspect: number): Arrangement {
  const circles = radii.map((r) => ({ x: 0, y: 0, r }));
  packSiblings(circles);
  const candidates = [boundsOf(circles, radii)];
  for (let rows = 1; rows <= radii.length; rows++) candidates.push(shelves(radii, rows));
  const fit = (candidate: Arrangement) => Math.min(aspect / candidate.width, 1 / candidate.height);
  return candidates.reduce((best, candidate) => (fit(candidate) > fit(best) * 1.02 ? candidate : best));
}

/**
 * Default position of every node, the whole layout centred on (0, 0).
 * `aspect` is the viewport's width / height.
 */
export function computeDefaultPositions(members: LayoutMember[], aspect = 16 / 9): Map<string, Point> {
  const out = new Map<string, Point>();
  if (members.length === 0) return out;
  const regions = buildTree(members).map(layoutGroup);
  const { offsets } = arrangeRegions(
    regions.map((region) => region.r + REGION_GAP / 2),
    aspect,
  );
  regions.forEach((region, index) => region.place(offsets[index].x, offsets[index].y, out));
  return out;
}

/** A string that changes only when the layout's shape does (not on every poll). */
export function layoutSignature(members: LayoutMember[]): string {
  return members
    .map((member) => `${member.id}|${member.region ?? ''}|${member.country}|${member.city}`)
    .sort()
    .join(';');
}

/**
 * The parcels around nodes' *actual* positions, smallest first (cities,
 * then countries, then regions) — draw them in reverse for big-behind-small.
 */
export function computeParcels(members: LayoutMember[], positions: Map<string, Point>): Parcel[] {
  const parcels: Parcel[] = [];
  const enclose = (group: GroupNode): (Circle & { nodeIds: string[] }) | null => {
    const childCircles: Circle[] = [];
    const nodeIds: string[] = [];
    for (const child of group.children) {
      const circle = enclose(child);
      if (circle) {
        childCircles.push(circle);
        nodeIds.push(...circle.nodeIds);
      }
    }
    for (const id of group.memberIds) {
      const position = positions.get(id);
      if (!position) continue;
      childCircles.push({ x: position.x, y: position.y + NODE_FOOTPRINT_DY, r: NODE_FOOTPRINT_RADIUS });
      nodeIds.push(id);
    }
    if (childCircles.length === 0) return null;
    // packEnclose reorders its input in place: hand it a copy.
    const enclosing = packEnclose(childCircles.map((circle) => ({ ...circle })));
    if (!enclosing) return null;
    const parcel: Parcel = {
      id: group.key,
      kind: group.kind,
      region: group.region,
      label: group.label,
      shortLabel: group.shortLabel,
      countryCode: group.countryCode,
      nodeIds,
      x: enclosing.x,
      y: enclosing.y,
      r: enclosing.r + PADDING[group.kind],
    };
    parcels.push(parcel);
    return { x: parcel.x, y: parcel.y, r: parcel.r, nodeIds };
  };
  buildTree(members).forEach(enclose);
  return parcels;
}

/** Bounding box of everything drawn: region bubbles plus every node's plate. */
export function contentBounds(parcels: Parcel[], positions: Iterable<Point>) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x: number, y: number, r: number) => {
    minX = Math.min(minX, x - r);
    minY = Math.min(minY, y - r);
    maxX = Math.max(maxX, x + r);
    maxY = Math.max(maxY, y + r);
  };
  for (const parcel of parcels) include(parcel.x, parcel.y, parcel.r);
  for (const position of positions) include(position.x, position.y + NODE_FOOTPRINT_DY, NODE_FOOTPRINT_RADIUS);
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * The pan/zoom that fits `bounds` in a `width` × `height` viewport, centred
 * in what's left once the margins are taken off: `top` leaves room for the
 * region tags that straddle the top of their bubble, `bottom` for the
 * legend drawn over the graph.
 */
export function fitTransform(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  width: number,
  height: number,
  { side = 22, top = 34, bottom = 22, minScale = 0.2, maxScale = 1.15 } = {},
) {
  const contentWidth = Math.max(bounds.maxX - bounds.minX, 1);
  const contentHeight = Math.max(bounds.maxY - bounds.minY, 1);
  const availableHeight = Math.max(height - top - bottom, 1);
  const scale = Math.max(
    minScale,
    Math.min(maxScale, Math.max(width - side * 2, 1) / contentWidth, availableHeight / contentHeight),
  );
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return { scale, tx: width / 2 - centerX * scale, ty: top + availableHeight / 2 - centerY * scale };
}

// Each region gets its own faint tint so parcels read apart at a glance.
// Hues stay clear of the status colours (green / amber / red) that nodes
// and links use: those must remain the only loud colours on the graph.
const REGION_HUES: Record<string, number> = {
  europe: 258,
  'north-america': 205,
  'south-america': 182,
  asia: 292,
  oceania: 228,
  africa: 322,
};

/** HSL hue of a region's parcels, or null for the neutral "unknown" grey. */
export function regionHue(region: string | null | undefined): number | null {
  return region ? (REGION_HUES[region] ?? null) : null;
}
