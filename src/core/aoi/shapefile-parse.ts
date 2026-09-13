import { strFromU8, unzipSync } from "fflate";
import type { FeatureCollection } from "geojson";

/**
 * Shapefile parsing from bytes. Runtime-agnostic: `shapefile.ts` reads the
 * files from disk on Node and hands them over here.
 */

export interface ParsedShapefile {
  collection: FeatureCollection;
  /** Content of the `.prj`, when the dataset has one. */
  prj?: string;
  layers: string[];
}

export interface ShapefileLayer {
  name: string;
  shp: Uint8Array;
  dbf?: Uint8Array;
  prj?: string;
  cpg?: string;
}

/** Last segment of a `/` or `\` separated path. */
export function baseName(file: string): string {
  return file.split(/[\\/]/).pop() ?? file;
}

export function layerFromParts(
  name: string,
  parts: { shp: Uint8Array; dbf?: Uint8Array; prj?: string; cpg?: string },
): ShapefileLayer {
  return {
    name: baseName(name),
    shp: parts.shp,
    ...(parts.dbf ? { dbf: parts.dbf } : {}),
    ...(parts.prj ? { prj: parts.prj } : {}),
    ...(parts.cpg ? { cpg: parts.cpg } : {}),
  };
}

export function layersFromZip(data: Uint8Array): ShapefileLayer[] {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data, {
      filter: (file) =>
        !file.name.includes("__MACOSX") && /\.(shp|dbf|prj|cpg)$/i.test(file.name),
    });
  } catch {
    throw new Error("El archivo .zip no es un ZIP válido.");
  }

  const byBase = new Map<string, Map<string, Uint8Array>>();
  for (const [name, content] of Object.entries(entries)) {
    const extension = name.slice(-3).toLowerCase();
    const base = name.slice(0, -4);
    const parts = byBase.get(base) ?? new Map<string, Uint8Array>();
    parts.set(extension, content);
    byBase.set(base, parts);
  }

  const layers: ShapefileLayer[] = [];
  for (const [base, parts] of byBase) {
    const shp = parts.get("shp");
    if (!shp) continue;
    const dbf = parts.get("dbf");
    const prj = parts.get("prj");
    const cpg = parts.get("cpg");
    layers.push(
      layerFromParts(base, {
        shp,
        ...(dbf ? { dbf } : {}),
        ...(prj ? { prj: strFromU8(prj) } : {}),
        ...(cpg ? { cpg: strFromU8(cpg) } : {}),
      }),
    );
  }

  if (layers.length === 0) {
    throw new Error("El .zip no contiene ninguna capa Shapefile (.shp).");
  }
  return layers;
}

/**
 * Parses Shapefile layers. Coordinates are returned **untransformed**; the
 * caller reprojects them with the `.prj` so every input goes through the same
 * CRS logic.
 */
export async function parseShapefileLayers(layers: ShapefileLayer[]): Promise<ParsedShapefile> {
  const projections = new Set(layers.map((layer) => layer.prj?.trim()).filter(Boolean));
  if (projections.size > 1) {
    throw new Error("Las capas del .zip usan CRS distintos: exporta una sola capa o unifica el CRS.");
  }

  // Loaded lazily and always through `import()`: the CommonJS entry of shpjs is
  // a browser bundle that crashes on Node, so `require` must never reach it.
  const { getShapefile } = await import("shpjs");

  const collection: FeatureCollection = { type: "FeatureCollection", features: [] };
  for (const layer of layers) {
    // The .prj is deliberately not passed: shpjs would reproject on its own.
    const parsed = await getShapefile({
      shp: layer.shp,
      ...(layer.dbf ? { dbf: layer.dbf } : {}),
      ...(layer.cpg ? { cpg: layer.cpg } : {}),
    });
    for (const part of Array.isArray(parsed) ? parsed : [parsed]) {
      collection.features.push(...part.features);
    }
  }

  const prj = [...projections][0];
  return { collection, layers: layers.map((layer) => layer.name), ...(prj ? { prj } : {}) };
}
