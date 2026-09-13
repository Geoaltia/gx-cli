import { existsSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";

import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { computeAoiMetrics, discoverAoi, normalizeItem, parseAoi } from "@/browser";
import { loadAoi } from "@/core/aoi/load";
import type { StacItem } from "@/core/stac/client";

import { MADRID_SQUARE_UTM, PRJ_ETRS89_UTM30N, writePolygonShp } from "./helpers/shapefile";

const SRC = path.join(import.meta.dirname, "..", "src");
const BUILTINS = new Set(builtinModules);

/** Runtime imports of a module (type-only imports are erased by the build). */
function runtimeImports(source: string): string[] {
  const specifiers: string[] = [];
  const pattern = /^\s*(import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/gm;
  for (const match of source.matchAll(pattern)) {
    if (!match[2]) specifiers.push(match[3]!);
  }
  for (const match of source.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) specifiers.push(match[1]!);
  return specifiers;
}

function resolveLocal(specifier: string, from: string): string | undefined {
  const base = specifier.startsWith("@/")
    ? path.join(SRC, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(from), specifier)
      : undefined;
  if (!base) return undefined;
  return [`${base}.ts`, path.join(base, "index.ts")].find((file) => existsSync(file));
}

describe("browser entry", () => {
  it("never reaches Node built-ins, process or Buffer", () => {
    const seen = new Set<string>();
    const offenders: string[] = [];
    const queue = [path.join(SRC, "browser.ts")];

    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const source = readFileSync(file, "utf8");
      const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const where = path.relative(SRC, file);

      if (/\bprocess\./.test(code)) offenders.push(`${where}: process`);
      if (/\bBuffer\b/.test(code)) offenders.push(`${where}: Buffer`);

      for (const specifier of runtimeImports(source)) {
        if (specifier.startsWith("node:") || BUILTINS.has(specifier)) {
          offenders.push(`${where}: ${specifier}`);
          continue;
        }
        const local = resolveLocal(specifier, file);
        if (local) queue.push(local);
      }
    }

    expect(seen.size).toBeGreaterThan(10);
    expect(offenders).toEqual([]);
  });
});

const KML = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>finca</name><Polygon><outerBoundaryIs><LinearRing><coordinates>-3.72,40.40 -3.68,40.40 -3.68,40.43 -3.72,40.43 -3.72,40.40</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;

function expectMadridSquare(areaM2: number) {
  expect(areaM2 / 1_000_000).toBeGreaterThan(3.95);
  expect(areaM2 / 1_000_000).toBeLessThan(4.05);
}

describe("parseAoi", () => {
  it("reads bbox, WKT and GeoJSON text like loadAoi", async () => {
    const wkt = `SRID=25830;POLYGON((${MADRID_SQUARE_UTM.map(([x, y]) => `${x} ${y}`).join(", ")}))`;
    const fromApi = await parseAoi({ wkt });
    const fromCli = await loadAoi({ wkt });
    expect(fromApi.geometry).toEqual(fromCli.geometry);
    expect(fromApi.crs).toEqual(fromCli.crs);
    expect(fromApi.source).toEqual({ kind: "wkt", label: "WKT" });

    const bbox = await parseAoi({ bbox: "439000,4473000,441000,4475000", crs: "EPSG:25830" });
    expect(bbox.crs.origin).toBe("flag");
    expectMadridSquare(computeAoiMetrics(bbox).areaM2);

    const text = JSON.stringify({ type: "Polygon", coordinates: [[[-3.72, 40.4], [-3.68, 40.4], [-3.68, 40.43], [-3.72, 40.4]]] });
    const geojson = await parseAoi({ text, label: "vértices" });
    expect(geojson.source).toEqual({ kind: "geojson", label: "vértices" });
  });

  it("reads KML and KMZ bytes", async () => {
    const kml = await parseAoi({ files: [{ name: "finca.kml", data: strToU8(KML) }] });
    const kmz = await parseAoi({ files: [{ name: "finca.kmz", data: zipSync({ "doc.kml": strToU8(KML) }).buffer as ArrayBuffer }] });
    expect(kml.source).toEqual({ kind: "kml", label: "finca.kml" });
    expect(kmz.source.kind).toBe("kmz");
    expect(computeAoiMetrics(kmz).areaM2).toBeCloseTo(computeAoiMetrics(kml).areaM2, 0);
  });

  it("reads zipped and loose Shapefiles with their .prj", async () => {
    const shp = writePolygonShp([MADRID_SQUARE_UTM]);
    const zipped = await parseAoi({
      files: [{ name: "lotes.zip", data: zipSync({ "lotes/lotes.shp": shp, "lotes/lotes.prj": strToU8(PRJ_ETRS89_UTM30N) }) }],
    });
    const loose = await parseAoi({
      files: [
        { name: "recinto.PRJ", data: strToU8(PRJ_ETRS89_UTM30N) },
        { name: "recinto.shp", data: shp },
      ],
    });
    for (const aoi of [zipped, loose]) {
      expect(aoi.source.kind).toBe("shapefile");
      expect(aoi.crs).toMatchObject({ code: "EPSG:25830", origin: "prj" });
      expectMadridSquare(computeAoiMetrics(aoi).areaM2);
    }
    expect(loose.source.label).toBe("recinto.shp");
  });

  it("explains bad input without mentioning CLI flags", async () => {
    await expect(parseAoi({ bbox: "439000,4473000,441000,4475000" })).rejects.toThrow(/EPSG:25830/);
    await expect(parseAoi({ bbox: "439000,4473000,441000,4475000" })).rejects.not.toThrow(/--crs/);
    await expect(parseAoi({ text: "  " })).rejects.toThrow(/vacío/);
    await expect(parseAoi({ files: [] })).rejects.toThrow(/ningún archivo/);
    await expect(parseAoi({ files: [{ name: "a.kml", data: strToU8(KML) }, { name: "b.kml", data: strToU8(KML) }] })).rejects.toThrow(/un solo archivo/);
    await expect(parseAoi({ bbox: "0,0,1,1", wkt: "POLYGON((0 0, 1 0, 1 1, 0 0))" } as never)).rejects.toThrow(/solo una fuente/);
  });
});

describe("discoverAoi", () => {
  it("searches an already parsed AOI and keeps scene thumbnails", async () => {
    const S2 = JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures", "sentinel-2-l2a-item.json"), "utf8")) as StacItem;
    const thumbnail = "https://datahub.creodias.eu/odata/v1/Assets(abc)/$value";
    const item: StacItem = { ...S2, assets: { thumbnail: { href: thumbnail, roles: ["thumbnail"] } } };
    expect(normalizeItem(item).thumbnail).toBe(thumbnail);

    const bodies: string[] = [];
    const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
      if (init?.body) bodies.push(String(init.body));
      const payload = String(input).includes("/collections/")
        ? { id: "sentinel-2-l2a", item_assets: S2.assets }
        : { type: "FeatureCollection", features: [item], links: [] };
      return new Response(JSON.stringify(payload), { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    const aoi = await parseAoi({ bbox: "-3.8,40.35,-3.6,40.5" });
    const report = await discoverAoi(aoi, {
      collections: ["s2-l2a"],
      from: "2026-08-01",
      to: "2026-08-31",
      maxItems: 10,
      timeoutMs: 1000,
      fetch: fetchMock,
    });
    expect(report.aoi.source.kind).toBe("bbox");
    expect(report.collections[0]?.scenes[0]?.thumbnail).toBe(thumbnail);
    expect(JSON.parse(bodies[0]!)).toMatchObject({ fields: { include: expect.arrayContaining(["assets.thumbnail.href"]) } });
  });
});
