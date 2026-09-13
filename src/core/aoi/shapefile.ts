import { readFile } from "node:fs/promises";
import path from "node:path";

import { strFromU8 } from "fflate";

import {
  layerFromParts,
  layersFromZip,
  parseShapefileLayers,
  type ParsedShapefile,
  type ShapefileLayer,
} from "@/core/aoi/shapefile-parse";

export type { ParsedShapefile } from "@/core/aoi/shapefile-parse";

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

async function layerFromShp(file: string): Promise<ShapefileLayer> {
  const base = file.slice(0, -path.extname(file).length);
  const [shp, dbf, prj, cpg] = await Promise.all([
    readFile(file),
    sibling(base, "dbf"),
    sibling(base, "prj"),
    sibling(base, "cpg"),
  ]);
  return layerFromParts(base, {
    shp,
    ...(dbf ? { dbf } : {}),
    ...(prj ? { prj: strFromU8(prj) } : {}),
    ...(cpg ? { cpg: strFromU8(cpg) } : {}),
  });
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
  return parseShapefileLayers(layers);
}
