import proj4 from "proj4";
import type { Position } from "geojson";

import type { AreaGeometry, UtmZone } from "@/types";

/** A CRS proj4 can work with, plus how we present it. */
export interface ResolvedCrs {
  code?: string;
  name: string;
  /** proj4 string or WKT understood by proj4. */
  definition: string;
  /** Geographic lon/lat on a WGS 84 compatible datum: no transform needed. */
  isWgs84Geographic: boolean;
}

const WGS84 = "+proj=longlat +datum=WGS84 +no_defs";

const ED50_TOWGS84 = "+towgs84=-87,-98,-121,0,0,0,0";

/** Well known codes that do not follow a numeric pattern. */
const NAMED: Record<number, Omit<ResolvedCrs, "code">> = {
  4326: { name: "WGS 84", definition: WGS84, isWgs84Geographic: true },
  4258: {
    name: "ETRS89",
    definition: "+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs",
    isWgs84Geographic: true,
  },
  4269: {
    name: "NAD83",
    definition: "+proj=longlat +datum=NAD83 +no_defs",
    isWgs84Geographic: true,
  },
  4674: {
    name: "SIRGAS 2000",
    definition: "+proj=longlat +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +no_defs",
    isWgs84Geographic: true,
  },
  3857: {
    name: "WGS 84 / Pseudo-Mercator",
    definition:
      "+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +no_defs",
    isWgs84Geographic: false,
  },
};

function utm(zone: number, south: boolean, datum: string): string {
  return `+proj=utm +zone=${zone}${south ? " +south" : ""} ${datum} +units=m +no_defs`;
}

/** Builds UTM definitions for the numeric EPSG families we recognise. */
function fromEpsgNumber(code: number): Omit<ResolvedCrs, "code"> | undefined {
  const named = NAMED[code === 900913 ? 3857 : code];
  if (named) return named;

  if (code >= 32601 && code <= 32660) {
    const zone = code - 32600;
    return { name: `WGS 84 / UTM zone ${zone}N`, definition: utm(zone, false, "+datum=WGS84"), isWgs84Geographic: false };
  }
  if (code >= 32701 && code <= 32760) {
    const zone = code - 32700;
    return { name: `WGS 84 / UTM zone ${zone}S`, definition: utm(zone, true, "+datum=WGS84"), isWgs84Geographic: false };
  }
  if (code >= 25828 && code <= 25838) {
    const zone = code - 25800;
    return { name: `ETRS89 / UTM zone ${zone}N`, definition: utm(zone, false, "+ellps=GRS80 +towgs84=0,0,0,0,0,0,0"), isWgs84Geographic: false };
  }
  if (code >= 23028 && code <= 23038) {
    const zone = code - 23000;
    return { name: `ED50 / UTM zone ${zone}N`, definition: utm(zone, false, `+ellps=intl ${ED50_TOWGS84}`), isWgs84Geographic: false };
  }
  if (code >= 31965 && code <= 31976) {
    const zone = code - 31954;
    return { name: `SIRGAS 2000 / UTM zone ${zone}N`, definition: utm(zone, false, "+ellps=GRS80 +towgs84=0,0,0,0,0,0,0"), isWgs84Geographic: false };
  }
  if (code >= 31977 && code <= 31985) {
    const zone = code - 31960;
    return { name: `SIRGAS 2000 / UTM zone ${zone}S`, definition: utm(zone, true, "+ellps=GRS80 +towgs84=0,0,0,0,0,0,0"), isWgs84Geographic: false };
  }
  return undefined;
}

/** Extracts the EPSG number from `EPSG:25830`, `urn:ogc:def:crs:EPSG::25830`, URLs or a bare `25830`. */
function parseEpsgNumber(input: string): number | undefined {
  const trimmed = input.trim();
  if (/^\d{4,6}$/.test(trimmed)) return Number(trimmed);
  const match =
    /EPSG(?::+|\/\d+\/|\/)(\d{4,6})$/i.exec(trimmed) ??
    /^EPSG\s*[: ]\s*(\d{4,6})$/i.exec(trimmed);
  return match?.[1] ? Number(match[1]) : undefined;
}

/** Name of a WKT CRS: the first quoted string. */
function wktName(wkt: string): string | undefined {
  return /"([^"]+)"/.exec(wkt)?.[1];
}

/** EPSG code declared at the top level of a WKT (`AUTHORITY["EPSG","25830"]` / `ID["EPSG",25830]`). */
function wktEpsg(wkt: string): number | undefined {
  const matches = [
    ...wkt.matchAll(/(?:AUTHORITY|ID)\[\s*"EPSG"\s*,\s*"?(\d{4,6})"?\s*\]/gi),
  ];
  const last = matches.at(-1)?.[1];
  return last ? Number(last) : undefined;
}

/**
 * Turns whatever the user or the file declared (EPSG code, OGC URN, proj4
 * string or WKT) into something proj4 can use. Throws a readable error when
 * the CRS is unknown.
 */
export function resolveCrs(input: string): ResolvedCrs {
  const trimmed = input.trim();

  if (/^(urn:ogc:def:crs:OGC:(1\.3:)?CRS84|OGC:CRS84|CRS84|WGS84)$/i.test(trimmed)) {
    return { code: "EPSG:4326", ...NAMED[4326]! };
  }

  const epsg = parseEpsgNumber(trimmed);
  if (epsg !== undefined) {
    const known = fromEpsgNumber(epsg);
    if (!known) {
      throw new Error(
        `CRS EPSG:${epsg} no reconocido. Pasa su definición proj4 o WKT con --crs "<definición>".`,
      );
    }
    return { code: `EPSG:${epsg}`, ...known };
  }

  if (trimmed.startsWith("+proj=")) {
    const isGeographic = /\+proj=longlat/.test(trimmed) && /(\+datum=WGS84|\+ellps=WGS84)/.test(trimmed);
    return { name: trimmed, definition: trimmed, isWgs84Geographic: isGeographic };
  }

  if (/^(PROJCS|GEOGCS|PROJCRS|GEOGCRS|GEODCRS|COMPD_CS)\s*\[/i.test(trimmed)) {
    const declared = wktEpsg(trimmed);
    const known = declared !== undefined ? fromEpsgNumber(declared) : undefined;
    const name = wktName(trimmed) ?? "CRS WKT";
    if (known) {
      return { code: `EPSG:${declared}`, ...known, name };
    }
    try {
      proj4(trimmed, WGS84);
    } catch {
      throw new Error(`No se pudo interpretar el CRS WKT "${name}".`);
    }
    const isGeographic =
      /^(GEOGCS|GEOGCRS)/i.test(trimmed) && /WGS[_ ]?(19)?84/i.test(trimmed);
    return { name, definition: trimmed, isWgs84Geographic: isGeographic };
  }

  throw new Error(
    `CRS "${trimmed}" no reconocido. Usa un código EPSG (EPSG:25830), una cadena proj4 o WKT.`,
  );
}

export const WGS84_CRS: ResolvedCrs = { code: "EPSG:4326", ...NAMED[4326]! };

function mapGeometry(
  geometry: AreaGeometry,
  fn: (position: Position) => Position,
): AreaGeometry {
  const ring = (positions: Position[]) => positions.map(fn);
  if (geometry.type === "Polygon") {
    return { type: "Polygon", coordinates: geometry.coordinates.map(ring) };
  }
  return {
    type: "MultiPolygon",
    coordinates: geometry.coordinates.map((polygon) => polygon.map(ring)),
  };
}

/** Transforms a polygonal geometry from `crs` to EPSG:4326. */
export function reprojectToWgs84(geometry: AreaGeometry, crs: ResolvedCrs): AreaGeometry {
  if (crs.isWgs84Geographic) return geometry;
  const converter = proj4(crs.definition, WGS84);
  return mapGeometry(geometry, (position) => {
    const [x, y] = converter.forward([position[0] ?? NaN, position[1] ?? NaN]);
    return [x ?? NaN, y ?? NaN];
  });
}

/** UTM zone (WGS 84) containing a lon/lat point, honouring the Norway/Svalbard exceptions. */
export function utmZoneFor(lon: number, lat: number): UtmZone {
  let zone = Math.floor((lon + 180) / 6) + 1;
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;
  if (lat >= 72 && lat < 84) {
    if (lon >= 0 && lon < 9) zone = 31;
    else if (lon >= 9 && lon < 21) zone = 33;
    else if (lon >= 21 && lon < 33) zone = 35;
    else if (lon >= 33 && lon < 42) zone = 37;
  }
  zone = Math.min(60, Math.max(1, zone));
  const hemisphere = lat >= 0 ? "N" : "S";
  return {
    zone,
    hemisphere,
    epsg: `EPSG:${hemisphere === "N" ? 32600 + zone : 32700 + zone}`,
  };
}

/** CRS of a Sentinel-2 MGRS tile (`30TVK` → `EPSG:32630`). */
export function crsForMgrsTile(tile: string): string | undefined {
  const match = /^(\d{1,2})([C-X])/i.exec(tile);
  if (!match?.[1] || !match[2]) return undefined;
  const zone = Number(match[1]);
  const north = match[2].toUpperCase() >= "N";
  return `EPSG:${(north ? 32600 : 32700) + zone}`;
}
