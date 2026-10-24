'use client';

import { useMemo } from 'react';
import { GeoJSON } from 'react-leaflet';
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson';
import { feature } from 'topojson-client';
import worldTopology from 'world-atlas/countries-110m.json';

/**
 * The basemap, drawn from a bundled Natural Earth country outline rather
 * than fetched as raster tiles.
 *
 * The map used CARTO's `dark_all` tiles, which stopped being free: every
 * tile now comes back stamped "API KEY REQUIRED", so the network page's
 * map was a grid of watermarks. Every remaining keyless raster provider is
 * either a light-themed basemap that fights this interface, or one whose
 * terms don't cover an app hammering it on every page view.
 *
 * Drawing the countries ourselves settles both problems at once: no key,
 * no third-party request at all (the topology ships in the bundle, 108 KB
 * for the 110m resolution), and the land, borders and water are literally
 * the interface's own surface tokens, so the map reads as part of the page
 * instead of a photograph pasted into it.
 *
 * The trade-off is resolution: 110m carries no detail below country
 * outlines, which is why the map caps its zoom. A fleet map answers "which
 * regions am I in and what links them", never "which street".
 */

const ANTIMERIDIAN_JUMP = 180;
const FULL_TURN = 360;

/**
 * Natural Earth stores Russia, Fiji and Antarctica with rings that run off
 * one edge of the world at +180 and resume at -180 on the very next vertex.
 * Leaflet projects longitudes literally, so that single step is drawn as a
 * segment straight back across the entire map — and because the ring then
 * closes, the whole span between the country's northern and southern limits
 * is filled in. That is the grey band readers saw lying across Eurasia on
 * the network and DNS maps, with the real coastlines clipped behind it.
 *
 * Unwrapping the ring removes the jump: each vertex is kept within half a
 * turn of the one before it, so Russia's Chukotka tip is described at 181°
 * instead of -179° and the outline stays continuous.
 */
function unwrapRing(ring: Position[]): Position[] {
  let previousLng: number | null = null;
  return ring.map((position) => {
    let lng = position[0];
    if (previousLng !== null) {
      while (lng - previousLng > ANTIMERIDIAN_JUMP) lng -= FULL_TURN;
      while (lng - previousLng < -ANTIMERIDIAN_JUMP) lng += FULL_TURN;
    }
    previousLng = lng;
    return [lng, position[1], ...position.slice(2)] as Position;
  });
}

function shiftRing(ring: Position[], offset: number): Position[] {
  return ring.map((position) => [position[0] + offset, position[1], ...position.slice(2)] as Position);
}

/**
 * Unwrapping alone leaves the overhanging part drawn past the edge of the
 * world, where nothing can see it. A copy of the polygon shifted a full turn
 * back puts that part where it belongs — Chukotka on the left edge, Fiji's
 * eastern islands on the right — so the geography is complete rather than
 * merely un-broken.
 */
function normalizePolygon(rings: Position[][]): Position[][][] {
  const unwrapped = rings.map(unwrapRing);
  const longitudes = unwrapped.flat().map((position) => position[0]);
  const max = Math.max(...longitudes);
  const min = Math.min(...longitudes);

  const polygons = [unwrapped];
  if (max > ANTIMERIDIAN_JUMP) {
    polygons.push(unwrapped.map((ring) => shiftRing(ring, -FULL_TURN)));
  }
  if (min < -ANTIMERIDIAN_JUMP) {
    polygons.push(unwrapped.map((ring) => shiftRing(ring, FULL_TURN)));
  }
  return polygons;
}

function normalizeFeature(input: Feature<Geometry>): Feature<Geometry> {
  const geometry = input.geometry;
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon') return input;

  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return {
    ...input,
    geometry: {
      type: 'MultiPolygon',
      coordinates: polygons.flatMap(normalizePolygon),
    },
  };
}

export function VectorBasemap() {
  const countries = useMemo(() => {
    // The JSON import widens every literal to `string`, so the topology
    // no longer satisfies topojson's `type: "Topology"` discriminant;
    // the shape is correct, only the inferred types are looser.
    const collection = feature(
      worldTopology as never,
      (worldTopology as { objects: { countries: unknown } }).objects.countries as never,
    ) as unknown as FeatureCollection<Geometry>;

    return {
      ...collection,
      features: collection.features.map(normalizeFeature),
    } satisfies FeatureCollection<Geometry>;
  }, []);

  return (
    <GeoJSON
      data={countries}
      // Flat landmass a single step above the water behind it, with a
      // hairline border - the same two-token relationship every card on
      // the page uses, so nothing about the map reads as foreign.
      style={{
        fillColor: 'hsl(240 5% 13%)',
        fillOpacity: 1,
        color: 'hsl(240 5% 20%)',
        weight: 0.6,
        opacity: 1,
      }}
      interactive={false}
    />
  );
}
