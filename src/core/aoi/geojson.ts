import type { Feature, GeoJSON, Geometry, Position } from "geojson";

/** GeoJSON as real files contain it: features may carry `null` geometries. */
export type AnyGeoJson = GeoJSON<Geometry | null>;

import type { AoiFeature, AreaGeometry } from "@/types";

export interface NormalizedFeatures {
  features: AoiFeature[];
  /** Points, lines and null geometries that are not part of the area. */
  ignored: number;
}

/** Makes sure every ring is explicitly closed, as GeoJSON requires. */
function closeRing(ring: Position[]): Position[] {
  const first = ring[0];
  const last = ring.at(-1);
  if (!first || !last) return ring;
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

function toArea(geometry: Geometry): AreaGeometry[] {
  switch (geometry.type) {
    case "Polygon":
      return [{ type: "Polygon", coordinates: geometry.coordinates.map(closeRing) }];
    case "MultiPolygon":
      return [
        {
          type: "MultiPolygon",
          coordinates: geometry.coordinates.map((polygon) => polygon.map(closeRing)),
        },
      ];
    case "GeometryCollection":
      return geometry.geometries.flatMap(toArea);
    default:
      return [];
  }
}

/**
 * Flattens any GeoJSON object into polygonal features. Properties are kept so
 * they can be exported back; everything that is not an area is counted.
 */
export function normalizeGeoJson(input: AnyGeoJson): NormalizedFeatures {
  const features: AoiFeature[] = [];
  let ignored = 0;

  const addFeature = (feature: Feature<Geometry | null>) => {
    if (!feature.geometry) {
      ignored += 1;
      return;
    }
    const areas = toArea(feature.geometry);
    if (areas.length === 0) {
      ignored += 1;
      return;
    }
    for (const geometry of areas) {
      features.push({ type: "Feature", properties: feature.properties ?? {}, geometry });
    }
  };

  if (input === null) return { features, ignored: 1 };

  switch (input.type) {
    case "FeatureCollection":
      input.features.forEach(addFeature);
      break;
    case "Feature":
      addFeature(input);
      break;
    default:
      addFeature({ type: "Feature", properties: {}, geometry: input });
  }

  return { features, ignored };
}

/** Legacy (pre RFC 7946) `crs` member: `{ "type": "name", "properties": { "name": "EPSG:25830" } }`. */
export function legacyCrsName(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null || !("crs" in input)) return undefined;
  const crs = (input as { crs?: { properties?: { name?: unknown } } }).crs;
  const name = crs?.properties?.name;
  return typeof name === "string" ? name : undefined;
}

const GEOJSON_TYPES = new Set([
  "FeatureCollection",
  "Feature",
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
]);

/** Parses GeoJSON text, failing with a message a GIS user can act on. */
export function parseGeoJsonText(text: string): AnyGeoJson {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `El archivo no es JSON válido: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  const type = (parsed as { type?: unknown } | null)?.type;
  if (typeof type !== "string" || !GEOJSON_TYPES.has(type)) {
    throw new Error("El JSON no es GeoJSON: falta un \"type\" válido (Feature, FeatureCollection, Polygon…).");
  }
  return parsed as AnyGeoJson;
}
