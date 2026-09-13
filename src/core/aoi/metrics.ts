import { area } from "@turf/area";
import { bbox as turfBbox } from "@turf/bbox";
import { centroid } from "@turf/centroid";
import { kinks } from "@turf/kinks";
import { length } from "@turf/length";
import type { Position } from "geojson";

import { utmZoneFor } from "@/core/aoi/crs";
import type { Aoi, AoiMetrics, BBox } from "@/types";

/** Self-intersection checks are quadratic; past this many vertices we skip them. */
const KINKS_VERTEX_LIMIT = 5000;

function ringsOf(aoi: Aoi): Position[][] {
  const geometry = aoi.geometry;
  return geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
}

/** Superficie, perímetro, bbox, centroide, zona UTM y validación básica del AOI. */
export function computeAoiMetrics(aoi: Aoi): AoiMetrics {
  const feature = { type: "Feature" as const, properties: {}, geometry: aoi.geometry };
  const rings = ringsOf(aoi);
  const issues: string[] = [];

  // Closing positions repeat the first one: they are not real vertices.
  const vertexCount = rings.reduce((total, ring) => total + Math.max(0, ring.length - 1), 0);

  rings.forEach((ring, index) => {
    if (ring.length < 4) {
      issues.push(`El anillo ${index + 1} tiene menos de 3 vértices distintos.`);
    }
  });

  const [minX, minY, maxX, maxY] = turfBbox(feature) as BBox;
  const box: BBox = [minX, minY, maxX, maxY];

  if (maxX - minX > 180) {
    issues.push("El AOI abarca más de 180° de longitud: puede cruzar el antimeridiano.");
  }

  if (vertexCount <= KINKS_VERTEX_LIMIT) {
    try {
      const found = kinks(feature).features.length;
      if (found > 0) {
        issues.push(`La geometría tiene ${found} auto-intersección(es).`);
      }
    } catch {
      issues.push("No se pudo comprobar si la geometría se auto-intersecta.");
    }
  } else {
    issues.push(`Auto-intersecciones no comprobadas (más de ${KINKS_VERTEX_LIMIT} vértices).`);
  }

  const areaM2 = area(feature);
  if (areaM2 === 0) issues.push("El área calculada es 0.");

  const [lon = 0, lat = 0] = centroid(feature).geometry.coordinates;
  const polygonCount = aoi.geometry.type === "Polygon" ? 1 : aoi.geometry.coordinates.length;

  return {
    areaM2,
    perimeterM: length(feature, { units: "kilometers" }) * 1000,
    bbox: box,
    centroid: [lon, lat],
    featureCount: aoi.features.features.length,
    polygonCount,
    vertexCount,
    utmZone: utmZoneFor(lon, lat),
    valid: !issues.some((issue) => /auto-intersección|menos de 3|área calculada/.test(issue)),
    issues,
  };
}
