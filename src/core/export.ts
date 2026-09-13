import type { Feature, FeatureCollection, Geometry } from "geojson";

import type {
  Aoi,
  AoiMetrics,
  CollectionSummary,
  DiscoveryReport,
  SceneSummary,
} from "@/types";

export type ExportFormat = "json" | "geojson";

export const EXPORT_FORMATS: ExportFormat[] = ["json", "geojson"];

/** Infers the export format from a file name (`.json`, `.geojson`). */
export function formatFromPath(file: string): ExportFormat | undefined {
  const lower = file.toLowerCase();
  if (lower.endsWith(".geojson")) return "geojson";
  if (lower.endsWith(".json")) return "json";
  return undefined;
}

const round = (value: number, decimals: number): number => Number(value.toFixed(decimals));

/**
 * Full report as JSON. Scene footprints are omitted (each keeps its bbox) so
 * the file stays small; use GeoJSON for geometries.
 */
export function toJson(report: DiscoveryReport): string {
  const collections = report.collections.map((collection): CollectionSummary => ({
    ...collection,
    scenes: collection.scenes.map((scene) => {
      const { footprint, ...rest } = scene;
      void footprint;
      return rest;
    }),
  }));
  return `${JSON.stringify({ ...report, collections }, null, 2)}\n`;
}

/** Flat, GIS friendly properties: scalars only, arrays joined with commas. */
function aoiProperties(metrics: AoiMetrics, crs: Aoi["crs"], source: Aoi["source"]) {
  return {
    role: "aoi",
    source: source.label,
    source_kind: source.kind,
    source_crs: crs.code ?? crs.name,
    area_m2: round(metrics.areaM2, 2),
    area_ha: round(metrics.areaM2 / 10_000, 4),
    area_km2: round(metrics.areaM2 / 1_000_000, 6),
    perimeter_m: round(metrics.perimeterM, 2),
    polygons: metrics.polygonCount,
    vertices: metrics.vertexCount,
    centroid_lon: round(metrics.centroid[0], 7),
    centroid_lat: round(metrics.centroid[1], 7),
    utm_epsg: metrics.utmZone.epsg,
    valid: metrics.valid,
    issues: metrics.issues.join(" | "),
  };
}

function sceneProperties(scene: SceneSummary, collection: CollectionSummary) {
  const properties: Record<string, string | number | boolean> = {
    role: "scene",
    id: scene.id,
    collection: collection.collection,
    alias: collection.alias,
    datetime: scene.datetime,
    date: scene.datetime.slice(0, 10),
  };
  const optional: Record<string, string | number | undefined> = {
    platform: scene.platform,
    product_type: scene.productType,
    processing_level: scene.processingLevel,
    processing_version: scene.processingVersion,
    cloud_cover: scene.cloudCover,
    snow_cover: scene.snowCover,
    tile: scene.tile,
    relative_orbit: scene.relativeOrbit,
    absolute_orbit: scene.absoluteOrbit,
    orbit_state: scene.orbitState,
    instrument_mode: scene.instrumentMode,
    polarizations: scene.polarizations?.join(","),
    gsd: scene.gsd,
    crs: scene.crs,
    aoi_coverage: scene.aoiCoverage !== undefined ? round(scene.aoiCoverage, 4) : undefined,
    product_bytes: scene.productBytes,
  };
  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) properties[key] = value;
  }
  return properties;
}

/**
 * A FeatureCollection with the AOI first and then one feature per scene
 * footprint. Opens directly in QGIS, ArcGIS, geojson.io or `ogr2ogr`.
 */
export function toGeoJson(report: DiscoveryReport): string {
  const features: Feature<Geometry | null>[] = [
    {
      type: "Feature",
      properties: aoiProperties(report.aoi.metrics, report.aoi.crs, report.aoi.source),
      geometry: report.aoi.geometry,
    },
  ];

  for (const collection of report.collections) {
    for (const scene of collection.scenes) {
      features.push({
        type: "Feature",
        properties: sceneProperties(scene, collection),
        geometry: scene.footprint ?? null,
      });
    }
  }

  const document: FeatureCollection<Geometry | null> & { metadata: unknown } = {
    type: "FeatureCollection",
    // Foreign member (RFC 7946 §6.1): ignored by GIS tools, handy for scripts.
    metadata: {
      generator: report.generator,
      generatedAt: report.generatedAt,
      provider: report.provider,
      search: report.search,
      totals: report.totals,
    },
    features,
  };
  return `${JSON.stringify(document)}\n`;
}

/** JSON/GeoJSON for the `aoi` command, which never touches the network. */
export function aoiToJson(aoi: Aoi, metrics: AoiMetrics): string {
  return `${JSON.stringify(
    {
      source: aoi.source,
      crs: aoi.crs,
      metrics,
      ignoredFeatures: aoi.ignoredFeatures,
      geometry: aoi.geometry,
    },
    null,
    2,
  )}\n`;
}

export function aoiToGeoJson(aoi: Aoi, metrics: AoiMetrics): string {
  const document: FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: aoiProperties(metrics, aoi.crs, aoi.source),
        geometry: aoi.geometry,
      },
    ],
  };
  return `${JSON.stringify(document)}\n`;
}
