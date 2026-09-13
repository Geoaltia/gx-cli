import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { Position } from "geojson";

import { bboxToPolygon, parseBBox } from "@/core/aoi/bbox";
import { reprojectToWgs84, resolveCrs, WGS84_CRS, type ResolvedCrs } from "@/core/aoi/crs";
import {
  legacyCrsName,
  normalizeGeoJson,
  parseGeoJsonText,
  type AnyGeoJson,
} from "@/core/aoi/geojson";
import { extractKmz, parseKml } from "@/core/aoi/kml";
import { readShapefile } from "@/core/aoi/shapefile";
import { parseWkt } from "@/core/aoi/wkt";
import type {
  Aoi,
  AoiFeature,
  AoiSource,
  AoiSourceKind,
  AreaGeometry,
  CrsInfo,
  CrsOrigin,
} from "@/types";

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

/** Extensions geoaltia understands, for help texts and prompts. */
export const AOI_EXTENSIONS = [".geojson", ".json", ".kml", ".kmz", ".shp", ".zip", ".wkt"] as const;

interface RawAoi {
  kind: AoiSourceKind;
  geojson: AnyGeoJson;
  declaredCrs?: { value: string; origin: CrsOrigin };
}

function kindFromExtension(file: string): AoiSourceKind | "wkt-file" | undefined {
  switch (path.extname(file).toLowerCase()) {
    case ".geojson":
    case ".json":
      return "geojson";
    case ".kml":
      return "kml";
    case ".kmz":
      return "kmz";
    case ".shp":
    case ".zip":
      return "shapefile";
    case ".wkt":
    case ".txt":
      return "wkt-file";
    default:
      return undefined;
  }
}

function fromText(text: string): RawAoi {
  const trimmed = text.trimStart();
  if (trimmed === "") {
    throw new Error("Falta el área de interés: la entrada está vacía. Pasa un archivo, --bbox o --wkt.");
  }
  if (trimmed.startsWith("{")) return fromGeoJsonText(text);
  if (trimmed.startsWith("<")) return { kind: "kml", geojson: parseKml(text) };
  return fromWkt(text);
}

function fromGeoJsonText(text: string): RawAoi {
  const geojson = parseGeoJsonText(text);
  const declared = legacyCrsName(geojson);
  return {
    kind: "geojson",
    geojson,
    ...(declared ? { declaredCrs: { value: declared, origin: "geojson-crs" as const } } : {}),
  };
}

function fromWkt(text: string): RawAoi {
  const { geometry, srid } = parseWkt(text);
  return {
    kind: "wkt",
    geojson: geometry,
    ...(srid !== undefined ? { declaredCrs: { value: `EPSG:${srid}`, origin: "ewkt" as const } } : {}),
  };
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

function mergeGeometries(features: AoiFeature[]): AreaGeometry {
  const polygons = features.flatMap((feature) =>
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates,
  );
  if (polygons.length === 1 && polygons[0]) {
    return { type: "Polygon", coordinates: polygons[0] };
  }
  return { type: "MultiPolygon", coordinates: polygons };
}

function firstOutOfRange(geometry: AreaGeometry): Position | undefined {
  const rings =
    geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
  for (const ring of rings) {
    for (const position of ring) {
      const [lon = NaN, lat = NaN] = position;
      if (!(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90)) return position;
    }
  }
  return undefined;
}

function crsInfo(crs: ResolvedCrs, origin: CrsOrigin): CrsInfo {
  return {
    ...(crs.code ? { code: crs.code } : {}),
    name: crs.name,
    origin,
    reprojected: !crs.isWgs84Geographic,
  };
}

/**
 * Loads an AOI from a file, a bbox or WKT, detects its CRS and returns it in
 * EPSG:4326 with only its polygonal parts.
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
    raw = { kind: "bbox", geojson: bboxToPolygon(bbox, input.crs ? 16 : 1) };
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

  let crs = WGS84_CRS;
  let origin: CrsOrigin = "default";
  if (input.crs !== undefined) {
    crs = resolveCrs(input.crs);
    origin = "flag";
  } else if (raw.declaredCrs) {
    crs = resolveCrs(raw.declaredCrs.value);
    origin = raw.declaredCrs.origin;
  }

  const { features, ignored } = normalizeGeoJson(raw.geojson);
  if (features.length === 0) {
    throw new Error(
      ignored > 0
        ? `La entrada solo contiene puntos o líneas (${ignored}); geoaltia necesita polígonos. Usa --bbox si solo tienes un punto de referencia.`
        : "La entrada no contiene ninguna geometría.",
    );
  }

  const projected = features.map((feature) => ({
    ...feature,
    geometry: reprojectToWgs84(feature.geometry, crs),
  }));

  const geometry = mergeGeometries(projected);
  const outside = firstOutOfRange(geometry);
  if (outside) {
    const shown = outside.map((value) => Number(value.toFixed(3))).join(", ");
    throw new Error(
      origin === "default"
        ? `Las coordenadas no parecen lon/lat en grados (${shown}). Indica el CRS de origen con --crs, p. ej. --crs EPSG:25830.`
        : `Tras reproyectar desde ${crs.code ?? crs.name} hay coordenadas fuera de rango (${shown}). Revisa el CRS indicado.`,
    );
  }

  return {
    source,
    crs: crsInfo(crs, origin),
    features: { type: "FeatureCollection", features: projected },
    geometry,
    ignoredFeatures: ignored,
  };
}
