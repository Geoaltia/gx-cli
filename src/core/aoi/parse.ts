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
import {
  baseName,
  layerFromParts,
  layersFromZip,
  parseShapefileLayers,
} from "@/core/aoi/shapefile-parse";
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

/**
 * Everything in this module runs in any JavaScript runtime: no `node:*`
 * imports, no `process`, no `Buffer`. `load.ts` adds file and stdin reading
 * on top of it for Node.
 */

/** An AOI parsed from its input, before CRS handling. */
export interface RawAoi {
  kind: AoiSourceKind;
  geojson: AnyGeoJson;
  declaredCrs?: { value: string; origin: CrsOrigin };
}

/** A file handed over as bytes: a browser `File`, a fetched asset… */
export interface AoiFileInput {
  /** File name; its extension decides the format. */
  name: string;
  data: Uint8Array | ArrayBuffer;
}

/** Exactly one source per call. `crs` overrides whatever the input declares. */
export type ParseAoiInput =
  | { bbox: string; crs?: string }
  | { wkt: string; crs?: string }
  | { text: string; crs?: string; label?: string }
  | { files: AoiFileInput[]; crs?: string };

/** Extensions gx understands, for help texts and prompts. */
export const AOI_EXTENSIONS = [".geojson", ".json", ".kml", ".kmz", ".shp", ".zip", ".wkt"] as const;

/** Lower-case extension with its dot (`.geojson`), or `""`. */
export function extensionOf(file: string): string {
  const name = baseName(file);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

export function kindFromExtension(file: string): AoiSourceKind | "wkt-file" | undefined {
  switch (extensionOf(file)) {
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

export function fromText(text: string): RawAoi {
  const trimmed = text.trimStart();
  if (trimmed === "") {
    throw new Error("Falta el área de interés: la entrada está vacía. Pasa un archivo, --bbox o --wkt.");
  }
  if (trimmed.startsWith("{")) return fromGeoJsonText(text);
  if (trimmed.startsWith("<")) return { kind: "kml", geojson: parseKml(text) };
  return fromWkt(text);
}

export function fromGeoJsonText(text: string): RawAoi {
  const geojson = parseGeoJsonText(text);
  const declared = legacyCrsName(geojson);
  return {
    kind: "geojson",
    geojson,
    ...(declared ? { declaredCrs: { value: declared, origin: "geojson-crs" as const } } : {}),
  };
}

export function fromWkt(text: string): RawAoi {
  const { geometry, srid } = parseWkt(text);
  return {
    kind: "wkt",
    geojson: geometry,
    ...(srid !== undefined ? { declaredCrs: { value: `EPSG:${srid}`, origin: "ewkt" as const } } : {}),
  };
}

export function fromBBoxText(text: string, projected: boolean): RawAoi {
  return { kind: "bbox", geojson: bboxToPolygon(parseBBox(text), projected ? 16 : 1) };
}

/** Wraps a parsed Shapefile as a raw AOI, keeping its `.prj` as the declared CRS. */
export async function fromShapefileLayers(
  layers: Parameters<typeof parseShapefileLayers>[0],
): Promise<RawAoi> {
  const { collection, prj } = await parseShapefileLayers(layers);
  return {
    kind: "shapefile",
    geojson: collection,
    ...(prj ? { declaredCrs: { value: prj, origin: "prj" as const } } : {}),
  };
}

const textDecoder = new TextDecoder("utf-8");

function toBytes(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array ? data : new Uint8Array(data);
}

/**
 * Parses files given as bytes. A single file of any supported format, or a
 * loose `.shp` together with its `.dbf`, `.prj` and `.cpg` sidecars.
 */
export async function fromFiles(files: AoiFileInput[]): Promise<RawAoi> {
  if (files.length === 0) {
    throw new Error("Falta el área de interés: no se ha recibido ningún archivo.");
  }

  const shp = files.filter((file) => extensionOf(file.name) === ".shp");
  if (shp.length > 1) {
    throw new Error("Hay varios .shp: carga una sola capa (o un .zip con todas).");
  }
  if (shp[0]) {
    const base = baseName(shp[0].name).slice(0, -4).toLowerCase();
    const sidecar = (extension: string) =>
      files.find((file) => baseName(file.name).toLowerCase() === `${base}${extension}`);
    const dbf = sidecar(".dbf");
    const prj = sidecar(".prj");
    const cpg = sidecar(".cpg");
    return fromShapefileLayers([
      layerFromParts(baseName(shp[0].name).slice(0, -4), {
        shp: toBytes(shp[0].data),
        ...(dbf ? { dbf: toBytes(dbf.data) } : {}),
        ...(prj ? { prj: textDecoder.decode(toBytes(prj.data)) } : {}),
        ...(cpg ? { cpg: textDecoder.decode(toBytes(cpg.data)) } : {}),
      }),
    ]);
  }

  if (files.length > 1) {
    throw new Error("Carga un solo archivo (solo un Shapefile suelto admite varios: .shp, .dbf, .prj y .cpg).");
  }

  const [file] = files as [AoiFileInput];
  const bytes = toBytes(file.data);
  const kind = kindFromExtension(file.name);
  switch (kind) {
    case "shapefile":
      return fromShapefileLayers(layersFromZip(bytes));
    case "kmz":
      return { kind, geojson: parseKml(extractKmz(bytes)) };
    case "kml":
      return { kind, geojson: parseKml(textDecoder.decode(bytes)) };
    case "geojson":
      return fromGeoJsonText(textDecoder.decode(bytes));
    case "wkt-file":
      return fromWkt(textDecoder.decode(bytes));
    default:
      return fromText(textDecoder.decode(bytes));
  }
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
 * Turns a raw AOI into the final one: resolves the CRS (override first, then
 * what the input declares, then EPSG:4326), keeps only polygons, reprojects
 * to EPSG:4326 and checks the result lands on the planet.
 */
export function buildAoi(
  raw: RawAoi,
  source: AoiSource,
  crsOverride?: string,
  context: "cli" | "api" = "cli",
): Aoi {
  const cli = context === "cli";
  let crs = WGS84_CRS;
  let origin: CrsOrigin = "default";
  if (crsOverride !== undefined) {
    crs = resolveCrs(crsOverride);
    origin = "flag";
  } else if (raw.declaredCrs) {
    crs = resolveCrs(raw.declaredCrs.value);
    origin = raw.declaredCrs.origin;
  }

  const { features, ignored } = normalizeGeoJson(raw.geojson);
  if (features.length === 0) {
    throw new Error(
      ignored > 0
        ? `La entrada solo contiene puntos o líneas (${ignored}); se necesitan polígonos. Usa ${cli ? "--bbox" : "un bbox"} si solo tienes un punto de referencia.`
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
        ? cli
          ? `Las coordenadas no parecen lon/lat en grados (${shown}). Indica el CRS de origen con --crs, p. ej. --crs EPSG:25830.`
          : `Las coordenadas no parecen lon/lat en grados (${shown}). Indica el CRS de origen, p. ej. EPSG:25830.`
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

/**
 * Loads an AOI from a bbox, WKT, text or in-memory files, detects its CRS and
 * returns it in EPSG:4326 with only its polygonal parts. Works in browsers:
 * it never touches the file system.
 */
export async function parseAoi(input: ParseAoiInput): Promise<Aoi> {
  const given = (["bbox", "wkt", "text", "files"] as const).filter(
    (key) => (input as Record<string, unknown>)[key] !== undefined,
  );
  if (given.length === 0) {
    throw new Error("Falta el área de interés: pasa bbox, wkt, text o files.");
  }
  if (given.length > 1) {
    throw new Error("Indica solo una fuente de AOI: bbox, wkt, text o files.");
  }

  const source = given[0];
  if (source === "bbox" && "bbox" in input) {
    const bbox = parseBBox(input.bbox);
    const raw = fromBBoxText(input.bbox, input.crs !== undefined);
    return buildAoi(raw, { kind: "bbox", label: `bbox ${bbox.join(",")}` }, input.crs, "api");
  }
  if (source === "wkt" && "wkt" in input) {
    return buildAoi(fromWkt(input.wkt), { kind: "wkt", label: "WKT" }, input.crs, "api");
  }
  if (source === "text" && "text" in input) {
    if (input.text.trim() === "") {
      throw new Error("Falta el área de interés: el texto está vacío.");
    }
    const raw = fromText(input.text);
    return buildAoi(raw, { kind: raw.kind, label: input.label ?? "texto" }, input.crs, "api");
  }
  if (!("files" in input)) throw new Error("Fuente de AOI no reconocida.");

  const raw = await fromFiles(input.files);
  const main =
    input.files.find((file) => extensionOf(file.name) === ".shp") ?? input.files[0]!;
  return buildAoi(raw, { kind: raw.kind, label: baseName(main.name) }, input.crs, "api");
}
