import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadAoi } from "@/core/aoi/load";
import { buildSearchBody, validateSearchOptions } from "@/core/discover";
import { discoverArea } from "@/core/discover-area";
import { toGeoJson, toJson } from "@/core/export";
import { searchStac, type StacItem } from "@/core/stac/client";
import { getCollection } from "@/core/stac/collections";
import { bandsFromAssets, normalizeItem } from "@/core/stac/normalize";
import { COPERNICUS_CDSE } from "@/core/stac/providers/copernicus";
import type { SearchOptions } from "@/types";

const fixture = (name: string): StacItem =>
  JSON.parse(readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8")) as StacItem;

const S2 = fixture("sentinel-2-l2a-item.json");
const S1 = fixture("sentinel-1-grd-item.json");

const BASE: SearchOptions = {
  collections: ["s2-l2a"],
  from: "2026-08-01",
  to: "2026-08-31",
  maxItems: 500,
  timeoutMs: 5000,
};

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

/** Fake catalogue: serves `items` in pages of `pageSize` using POST `next` tokens. */
function fakeCatalogue(items: StacItem[], pageSize: number) {
  const calls: Array<{ url: string; body?: Record<string, unknown> }> = [];
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined;
    calls.push({ url, ...(body ? { body } : {}) });
    if (url.includes("/collections/")) return json({ id: "x", item_assets: S2.assets });

    const start = Number(body?.["token"] ?? 0);
    const limit = Math.min(pageSize, Number(body?.["limit"] ?? pageSize));
    const page = items.slice(start, start + limit);
    const nextStart = start + page.length;
    return json({
      type: "FeatureCollection",
      features: page,
      links:
        nextStart < items.length
          ? [{ rel: "next", href: url, method: "POST", body: { token: String(nextStart) } }]
          : [],
    });
  }) as typeof fetch;
  return { fetchMock, calls };
}

const clone = (item: StacItem, index: number): StacItem => ({ ...item, id: `${item.id}-${index}` });

describe("searchStac", () => {
  it("follows next links and keeps the original query", async () => {
    const { fetchMock, calls } = fakeCatalogue([0, 1, 2, 3, 4].map((i) => clone(S2, i)), 2);
    const body = buildSearchBody(getCollection("s2-l2a"), S2.geometry as never, BASE);
    const result = await searchStac(COPERNICUS_CDSE, body, { maxItems: 100, timeoutMs: 1000, fetch: fetchMock });

    expect(result.items).toHaveLength(5);
    expect(result.truncated).toBe(false);
    expect(calls).toHaveLength(3);
    expect(calls[1]?.body).toMatchObject({ collections: ["sentinel-2-l2a"], token: "2" });
  });

  it("reports truncation exactly", async () => {
    const four = [0, 1, 2, 3].map((i) => clone(S2, i));
    const exact = await searchStac(COPERNICUS_CDSE, { collections: ["x"] }, {
      maxItems: 4, timeoutMs: 1000, fetch: fakeCatalogue(four, 2).fetchMock,
    });
    expect(exact).toMatchObject({ truncated: false });
    expect(exact.items).toHaveLength(4);

    const cut = await searchStac(COPERNICUS_CDSE, { collections: ["x"] }, {
      maxItems: 3, timeoutMs: 1000, fetch: fakeCatalogue(four, 2).fetchMock,
    });
    expect(cut.truncated).toBe(true);
    expect(cut.items).toHaveLength(3);
  });

  it("retries 429 and surfaces API error messages", async () => {
    let attempts = 0;
    const flaky = (async () => {
      attempts += 1;
      return attempts === 1
        ? json({}, { status: 429, headers: { "Retry-After": "0" } })
        : json({ features: [S1], links: [] });
    }) as typeof fetch;
    const ok = await searchStac(COPERNICUS_CDSE, { collections: ["x"] }, { maxItems: 10, timeoutMs: 1000, fetch: flaky });
    expect(ok.items).toHaveLength(1);
    expect(attempts).toBe(2);

    const broken = (async () =>
      json({ detail: { code: "LimitValidationError", message: "Limit too big" } }, { status: 400 })) as typeof fetch;
    await expect(
      searchStac(COPERNICUS_CDSE, { collections: ["x"] }, { maxItems: 10, timeoutMs: 1000, fetch: broken }),
    ).rejects.toThrow("El catálogo respondió 400: Limit too big");
  });
});

describe("search body and validation", () => {
  it("adds the cloud filter only to optical collections", () => {
    const geometry = S2.geometry as never;
    const optical = buildSearchBody(getCollection("s2-l2a"), geometry, { ...BASE, maxCloud: 20 });
    const radar = buildSearchBody(getCollection("s1-grd"), geometry, { ...BASE, maxCloud: 20 });
    expect(optical.filter).toEqual({ op: "<=", args: [{ property: "eo:cloud_cover" }, 20] });
    expect(radar.filter).toBeUndefined();
    expect(optical.datetime).toBe("2026-08-01T00:00:00Z/2026-08-31T23:59:59Z");
  });

  it("rejects impossible periods", () => {
    expect(() => validateSearchOptions({ ...BASE, from: "2026-09-01" })).toThrow(/invertido/);
    expect(() => validateSearchOptions({ ...BASE, to: "2026-02-30" })).toThrow(/AAAA-MM-DD/);
  });
});

describe("normalization", () => {
  it("extracts Sentinel-2 metadata", async () => {
    const aoi = await loadAoi({ bbox: "-3.8,40.35,-3.6,40.5" });
    const scene = normalizeItem(S2, { geometry: aoi.geometry, areaM2: 282_372_685 });
    expect(scene).toMatchObject({
      collection: "sentinel-2-l2a",
      platform: "sentinel-2c",
      tile: "30TVK",
      crs: "EPSG:32630",
      relativeOrbit: 94,
      cloudCover: 0,
    });
    expect(scene.aoiCoverage).toBeCloseTo(1, 2);
    expect(scene.productBytes).toBeGreaterThan(0);
  });

  it("extracts Sentinel-1 metadata", () => {
    const scene = normalizeItem(S1);
    expect(scene).toMatchObject({ instrumentMode: "IW", polarizations: ["VV", "VH"], orbitState: "ascending" });
    expect(scene.cloudCover).toBeUndefined();
  });

  it("lists bands with every available resolution", () => {
    const bands = bandsFromAssets(S2.assets);
    const b02 = bands.find((band) => band.name === "B02");
    expect(b02).toMatchObject({ commonName: "blue", resolutions: [10, 20, 60] });
    expect(bands.map((band) => band.name)).not.toContain("TCI");
    expect(bandsFromAssets(S1.assets).map((band) => band.name)).toEqual(["VH", "VV"]);
  });
});

describe("discoverArea + export", () => {
  it("builds a report and valid exports", async () => {
    const items = [0, 1, 2].map((i) => ({
      ...clone(S2, i),
      properties: { ...S2.properties, "eo:cloud_cover": i * 10, datetime: `2026-08-0${i + 1}T10:56:21Z` },
    }));
    const { fetchMock } = fakeCatalogue(items, 200);
    const report = await discoverArea({ bbox: "-3.8,40.35,-3.6,40.5" }, { ...BASE, fetch: fetchMock });

    const [summary] = report.collections;
    expect(summary).toMatchObject({
      sceneCount: 3,
      firstDate: "2026-08-01",
      lastDate: "2026-08-03",
      fullCoverageScenes: 3,
      tiles: ["30TVK"],
    });
    expect(summary?.cloudCover).toEqual({ min: 0, max: 20, mean: 10 });
    expect(summary?.bands.length).toBeGreaterThan(10);

    const geojson = JSON.parse(toGeoJson(report)) as { type: string; features: Array<{ properties: Record<string, unknown>; geometry: unknown }> };
    expect(geojson.type).toBe("FeatureCollection");
    expect(geojson.features).toHaveLength(4);
    expect(geojson.features[0]?.properties).toMatchObject({ role: "aoi", utm_epsg: "EPSG:32630" });
    expect(geojson.features[1]?.properties).toMatchObject({ role: "scene", tile: "30TVK" });
    expect(geojson.features[1]?.geometry).toMatchObject({ type: "Polygon" });

    const jsonReport = JSON.parse(toJson(report)) as { collections: Array<{ scenes: Array<Record<string, unknown>> }> };
    expect(jsonReport.collections[0]?.scenes[0]).not.toHaveProperty("footprint");
  });

  it("keeps going when one collection fails", async () => {
    const failing = (async (input: string | URL | Request, init?: RequestInit) => {
      const body = init?.body ? String(init.body) : "";
      if (body.includes("sentinel-1-grd")) return json({ description: "boom" }, { status: 400 });
      return json({ features: [S2], links: [] });
    }) as typeof fetch;
    const report = await discoverArea({ bbox: "-3.8,40.35,-3.6,40.5" }, {
      ...BASE,
      collections: ["s2-l2a", "s1-grd"],
      fetch: failing,
    });
    expect(report.collections.map((summary) => summary.error)).toEqual([undefined, "El catálogo respondió 400: boom"]);
    expect(report.totals.scenes).toBe(1);
  });
});
