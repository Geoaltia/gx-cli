import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { extractKmz, parseKml } from "@/core/aoi/kml";
import {
  buildAoi,
  fromBBoxText,
  fromGeoJsonText,
  fromText,
  fromWkt,
  kindFromExtension,
  type RawAoi,
} from "@/core/aoi/parse";
import { readShapefile } from "@/core/aoi/shapefile";
import { parseBBox } from "@/core/aoi/bbox";
import type { Aoi, AoiSource } from "@/types";

export { AOI_EXTENSIONS } from "@/core/aoi/parse";

/** Exactly one of `file`, `bbox` or `wkt` must be given. */
export interface LoadAoiInput {
  /** Path to a GeoJSON, KML, KMZ, Shapefile (.shp/.zip) or WKT file. `-` reads stdin. */
  file?: string;
  /** `minx,miny,maxx,maxy`. */
  bbox?: string;
  /** WKT or EWKT geometry. */
  wkt?: string;
  /** CRS of the input coordinates. Overrides whatever the input declares. */
  crs?: string;
  /** Text to use instead of reading `file` (used for stdin and tests). */
  text?: string;
}

async function readRaw(file: string, text: string | undefined): Promise<RawAoi> {
  if (text !== undefined || file === "-") {
    return fromText(text ?? (await readStdin()));
  }

  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error(`"${file}" no es un archivo.`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`No existe el archivo "${file}".`, { cause: error });
    }
    throw error;
  }

  const kind = kindFromExtension(file);
  switch (kind) {
    case "shapefile": {
      const { collection, prj } = await readShapefile(file);
      return {
        kind,
        geojson: collection,
        ...(prj ? { declaredCrs: { value: prj, origin: "prj" as const } } : {}),
      };
    }
    case "kmz":
      return { kind, geojson: parseKml(extractKmz(await readFile(file))) };
    case "kml":
      return { kind, geojson: parseKml(await readFile(file, "utf8")) };
    case "geojson":
      return fromGeoJsonText(await readFile(file, "utf8"));
    case "wkt-file":
      return fromWkt(await readFile(file, "utf8"));
    default:
      return fromText(await readFile(file, "utf8"));
  }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error("Se indicó \"-\" pero no hay datos en la entrada estándar.");
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Loads an AOI from a file, a bbox or WKT, detects its CRS and returns it in
 * EPSG:4326 with only its polygonal parts. Node only: use `parseAoi` in
 * browsers.
 */
export async function loadAoi(input: LoadAoiInput): Promise<Aoi> {
  const given = [input.file ?? input.text, input.bbox, input.wkt].filter(
    (value) => value !== undefined,
  );
  if (given.length === 0) {
    throw new Error("Falta el área de interés: pasa un archivo, --bbox o --wkt.");
  }
  if (given.length > 1) {
    throw new Error("Indica solo una fuente de AOI: un archivo, --bbox o --wkt.");
  }

  let raw: RawAoi;
  let source: AoiSource;

  if (input.bbox !== undefined) {
    const bbox = parseBBox(input.bbox);
    raw = fromBBoxText(input.bbox, input.crs !== undefined);
    source = { kind: "bbox", label: `--bbox ${bbox.join(",")}` };
  } else if (input.wkt !== undefined) {
    raw = fromWkt(input.wkt);
    source = { kind: "wkt", label: "--wkt" };
  } else {
    const file = input.file ?? "-";
    raw = await readRaw(file, input.text);
    const isStdin = file === "-" || input.text !== undefined;
    source = isStdin
      ? { kind: raw.kind, label: "entrada estándar" }
      : { kind: raw.kind, path: path.resolve(file), label: path.basename(file) };
  }

  return buildAoi(raw, source, input.crs);
}
