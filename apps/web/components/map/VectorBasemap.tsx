'use client';

import { useMemo } from 'react';
import { GeoJSON } from 'react-leaflet';
import type { FeatureCollection, Geometry } from 'geojson';
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
export function VectorBasemap() {
  const countries = useMemo(
    () =>
      // The JSON import widens every literal to `string`, so the topology
      // no longer satisfies topojson's `type: "Topology"` discriminant;
      // the shape is correct, only the inferred types are looser.
      feature(
        worldTopology as never,
        (worldTopology as { objects: { countries: unknown } }).objects.countries as never,
      ) as unknown as FeatureCollection<Geometry>,
    [],
  );

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
