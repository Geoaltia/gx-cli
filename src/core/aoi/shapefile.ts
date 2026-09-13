import { readFile } from "node:fs/promises";
import path from "node:path";

import { strFromU8, unzipSync } from "fflate";
import type { FeatureCollection } from "geojson";

export interface ParsedShapefile {
  collection: FeatureCollection;
  /** Content of the `.prj`, when the dataset has one. */
  prj?: string;
  layers: string[];
}

interface Layer {
  name: string;
  shp: Uint8Array;
  dbf?: Uint8Array;
  prj?: string;
  cpg?: string;
}

async function readOptional(file: string): Promise<Uint8Array | undefined> {
  try {
    return await readFile(file);
  } catch {
    return undefined;
  }
}

/** Finds a sibling file regardless of the extension's case (`.PRJ`, `.prj`). */
async function sibling(base: string, extension: string): Promise<Uint8Array | undefined> {
  return (
    (await readOptional(`${base}.${extension}`)) ??
    (await readOptional(`${base}.${extension.toUpperCase()}`))
  );
}

function layersFromZip(data: Uint8Array): Layer[] {
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

  const layers: Layer[] = [];
  for (const [base, parts] of byBase) {
    const shp = parts.get("shp");
    if (!shp) continue;
    const dbf = parts.get("dbf");
    const prj = parts.get("prj");
    const cpg = parts.get("cpg");
    layers.push({
      name: path.basename(base),
      shp,
      ...(dbf ? { dbf } : {}),
      ...(prj ? { prj: strFromU8(prj) } : {}),
      ...(cpg ? { cpg: strFromU8(cpg) } : {}),
    });
  }

  if (layers.length === 0) {
    throw new Error("El .zip no contiene ninguna capa Shapefile (.shp).");
  }
  return layers;
}

async function layerFromShp(file: string): Promise<Layer> {
  const base = file.slice(0, -path.extname(file).length);
  const [shp, dbf, prj, cpg] = await Promise.all([
    readFile(file),
    sibling(base, "dbf"),
    sibling(base, "prj"),
    sibling(base, "cpg"),
  ]);
  return {
    name: path.basename(base),
    shp,
    ...(dbf ? { dbf } : {}),
    ...(prj ? { prj: strFromU8(prj) } : {}),
    ...(cpg ? { cpg: strFromU8(cpg) } : {}),
  };
}

/**
 * Reads a Shapefile, either zipped or as a loose `.shp` with its sidecars.
 * Coordinates are returned **untransformed**; the caller reprojects them with
 * the `.prj` so every input goes through the same CRS logic.
 */
export async function readShapefile(file: string): Promise<ParsedShapefile> {
  const layers = file.toLowerCase().endsWith(".zip")
    ? layersFromZip(await readFile(file))
    : [await layerFromShp(file)];

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
