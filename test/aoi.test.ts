import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { strToU8, zipSync } from "fflate";
import { beforeAll, describe, expect, it } from "vitest";

import { bboxToPolygon, parseBBox } from "@/core/aoi/bbox";
import { crsForMgrsTile, resolveCrs, utmZoneFor } from "@/core/aoi/crs";
import { loadAoi } from "@/core/aoi/load";
import { computeAoiMetrics } from "@/core/aoi/metrics";
import { parseWkt } from "@/core/aoi/wkt";

import { MADRID_SQUARE_UTM, PRJ_ETRS89_UTM30N, writePolygonShp } from "./helpers/shapefile";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "gx-test-"));
});

const SQUARE_WKT = "POLYGON((-3.72 40.40, -3.68 40.40, -3.68 40.43, -3.72 40.43, -3.72 40.40))";

function firstPosition(geometry: { type: string; coordinates: unknown }): [number, number] {
  const coordinates = geometry.coordinates as number[][][] | number[][][][];
  const ring = geometry.type === "Polygon" ? (coordinates as number[][][])[0]! : (coordinates as number[][][][])[0]![0]!;
  return ring[0] as [number, number];
}

/** ≈ 2 km × 2 km, allowing for projection scale and datum differences. */
function expectMadridSquare(areaM2: number, geometry: { type: string; coordinates: unknown }) {
  expect(areaM2 / 1_000_000).toBeGreaterThan(3.95);
  expect(areaM2 / 1_000_000).toBeLessThan(4.05);
  const [lon, lat] = firstPosition(geometry);
  expect(lon).toBeCloseTo(-3.715, 1);
  expect(lat).toBeCloseTo(40.40, 1);
}

describe("bbox", () => {
  it("parses commas and spaces", () => {
    expect(parseBBox("-3.8, 40.35 -3.6,40.5")).toEqual([-3.8, 40.35, -3.6, 40.5]);
  });

  it("rejects malformed or inverted boxes", () => {
    expect(() => parseBBox("1,2,3")).toThrow(/minx,miny,maxx,maxy/);
    expect(() => parseBBox("3,2,1,4")).toThrow(/menor/);
  });

  it("densifies edges on request", () => {
    expect(bboxToPolygon([0, 0, 1, 1], 4).coordinates[0]).toHaveLength(17);
  });
});

describe("wkt", () => {
  it("reads polygons, multipolygons and EWKT", () => {
    expect(parseWkt(SQUARE_WKT).geometry.type).toBe("Polygon");
    expect(parseWkt("MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), ((2 2, 3 2, 3 3, 2 2)))").geometry.type).toBe("MultiPolygon");
    const ewkt = parseWkt("SRID=25830;POLYGON Z ((439000 4473000 5, 441000 4473000 5, 441000 4475000 5, 439000 4473000 5))");
    expect(ewkt.srid).toBe(25830);
  });

  it("explains syntax errors", () => {
    expect(() => parseWkt("POLYGON((0 0, 1 1)")).toThrow(/WKT inválido/);
    expect(() => parseWkt("CIRCLE(0 0 5)")).toThrow(/no soportado/);
  });
});

describe("crs", () => {
  it("resolves EPSG codes in their usual spellings", () => {
    expect(resolveCrs("EPSG:25830").name).toBe("ETRS89 / UTM zone 30N");
    expect(resolveCrs("urn:ogc:def:crs:EPSG::32719").code).toBe("EPSG:32719");
    expect(resolveCrs("http://www.opengis.net/def/crs/EPSG/0/3857").code).toBe("EPSG:3857");
    expect(resolveCrs("urn:ogc:def:crs:OGC:1.3:CRS84").isWgs84Geographic).toBe(true);
    expect(resolveCrs(PRJ_ETRS89_UTM30N).code).toBe("EPSG:25830");
  });

  it("fails clearly on unknown codes", () => {
    expect(() => resolveCrs("EPSG:2154")).toThrow(/no reconocido/);
  });

  it("suggests the UTM zone of a location", () => {
    expect(utmZoneFor(-3.7, 40.4).epsg).toBe("EPSG:32630");
    expect(utmZoneFor(-70.6, -33.4).epsg).toBe("EPSG:32719");
    expect(utmZoneFor(5, 60).zone).toBe(32);
  });

  it("derives Sentinel-2 raster CRS from the MGRS tile", () => {
    expect(crsForMgrsTile("30TVK")).toBe("EPSG:32630");
    expect(crsForMgrsTile("19HCC")).toBe("EPSG:32719");
  });
});

describe("loadAoi", () => {
  it("loads a bbox and computes geodesic metrics", async () => {
    const aoi = await loadAoi({ bbox: "0,0,1,1" });
    const metrics = computeAoiMetrics(aoi);
    // 1° × 1° at the equator on the WGS 84 authalic sphere ≈ 12 364 km².
    expect(metrics.areaM2 / 1_000_000).toBeCloseTo(12_364, -1);
    expect(metrics.vertexCount).toBe(4);
    expect(metrics.valid).toBe(true);
    expect(aoi.crs.origin).toBe("default");
  });

  it("keeps polygons and counts points and lines out", async () => {
    const text = JSON.stringify({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: { name: "a" }, geometry: parseWkt(SQUARE_WKT).geometry },
        { type: "Feature", properties: {}, geometry: { type: "Point", coordinates: [0, 0] } },
        { type: "Feature", properties: {}, geometry: null },
      ],
    });
    const aoi = await loadAoi({ text });
    expect(aoi.features.features).toHaveLength(1);
    expect(aoi.features.features[0]?.properties).toEqual({ name: "a" });
    expect(aoi.ignoredFeatures).toBe(2);
  });

  it("reprojects GeoJSON with a legacy crs member", async () => {
    const text = JSON.stringify({
      type: "Feature",
      crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::25830" } },
      properties: {},
      geometry: { type: "Polygon", coordinates: [MADRID_SQUARE_UTM] },
    });
    const aoi = await loadAoi({ text });
    expect(aoi.crs).toMatchObject({ code: "EPSG:25830", origin: "geojson-crs", reprojected: true });
    expectMadridSquare(computeAoiMetrics(aoi).areaM2, aoi.geometry);
  });

  it("reprojects EWKT and --crs input", async () => {
    const wkt = `POLYGON((${MADRID_SQUARE_UTM.map(([x, y]) => `${x} ${y}`).join(", ")}))`;
    const ewkt = await loadAoi({ wkt: `SRID=25830;${wkt}` });
    expect(ewkt.crs.origin).toBe("ewkt");
    expectMadridSquare(computeAoiMetrics(ewkt).areaM2, ewkt.geometry);

    const flagged = await loadAoi({ bbox: "439000,4473000,441000,4475000", crs: "25830" });
    expect(flagged.crs.origin).toBe("flag");
    expectMadridSquare(computeAoiMetrics(flagged).areaM2, flagged.geometry);
  });

  it("asks for --crs when coordinates are clearly projected", async () => {
    await expect(loadAoi({ bbox: "439000,4473000,441000,4475000" })).rejects.toThrow(/--crs/);
  });

  it("reads KML and KMZ", async () => {
    const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>finca</name><Polygon><outerBoundaryIs><LinearRing><coordinates>-3.72,40.40 -3.68,40.40 -3.68,40.43 -3.72,40.43 -3.72,40.40</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;
    const kmlFile = path.join(dir, "finca.kml");
    const kmzFile = path.join(dir, "finca.kmz");
    await writeFile(kmlFile, kml);
    await writeFile(kmzFile, zipSync({ "doc.kml": strToU8(kml) }));

    const fromKml = await loadAoi({ file: kmlFile });
    const fromKmz = await loadAoi({ file: kmzFile });
    expect(fromKml.source.kind).toBe("kml");
    expect(fromKmz.source.kind).toBe("kmz");
    expect(fromKml.features.features[0]?.properties).toMatchObject({ name: "finca" });
    expect(computeAoiMetrics(fromKmz).areaM2).toBeCloseTo(computeAoiMetrics(fromKml).areaM2, 0);
  });

  it("reads zipped and loose Shapefiles, using the .prj", async () => {
    const shp = writePolygonShp([MADRID_SQUARE_UTM]);
    const zipFile = path.join(dir, "lotes.zip");
    await writeFile(zipFile, zipSync({ "lotes/lotes.shp": shp, "lotes/lotes.prj": strToU8(PRJ_ETRS89_UTM30N) }));
    const looseFile = path.join(dir, "recinto.shp");
    await writeFile(looseFile, shp);
    await writeFile(path.join(dir, "recinto.prj"), PRJ_ETRS89_UTM30N);

    for (const file of [zipFile, looseFile]) {
      const aoi = await loadAoi({ file });
      expect(aoi.source.kind).toBe("shapefile");
      expect(aoi.crs).toMatchObject({ code: "EPSG:25830", origin: "prj" });
      expectMadridSquare(computeAoiMetrics(aoi).areaM2, aoi.geometry);
    }
  });

  it("rejects missing files, point-only input and ambiguous sources", async () => {
    await expect(loadAoi({ file: path.join(dir, "nope.geojson") })).rejects.toThrow(/No existe/);
    await expect(loadAoi({ text: '{"type":"Point","coordinates":[0,0]}' })).rejects.toThrow(/polígonos/);
    await expect(loadAoi({ bbox: "0,0,1,1", wkt: SQUARE_WKT })).rejects.toThrow(/solo una fuente/);
  });

  it("flags self-intersecting polygons", async () => {
    const aoi = await loadAoi({ wkt: "POLYGON((0 0, 1 1, 1 0, 0 1, 0 0))" });
    const metrics = computeAoiMetrics(aoi);
    expect(metrics.valid).toBe(false);
    expect(metrics.issues.join()).toMatch(/auto-intersección/);
  });
});
