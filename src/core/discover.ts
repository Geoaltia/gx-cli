import { computeAoiMetrics } from "@/core/aoi/metrics";
import { bboxToPolygon } from "@/core/aoi/bbox";
import { loadAoi, type LoadAoiInput } from "@/core/aoi/load";
import {
  fetchCollection,
  searchStac,
  type StacSearchBody,
} from "@/core/stac/client";
import { getCollection, type CollectionInfo } from "@/core/stac/collections";
import { bandsFromAssets, normalizeItem, SCENE_FIELDS, type CoverageTarget } from "@/core/stac/normalize";
import { COPERNICUS_CDSE, type StacProvider } from "@/core/stac/providers/copernicus";
import { summarizeCollection } from "@/core/stac/summarize";
import type {
  Aoi,
  AreaGeometry,
  CollectionSummary,
  DiscoveryHooks,
  DiscoveryReport,
  SearchOptions,
} from "@/types";
import { VERSION } from "@/version";

/** Above this many vertices the AOI envelope is sent to the catalogue instead. */
export const SEARCH_VERTEX_LIMIT = 1000;

export interface DiscoverOptions extends SearchOptions {
  provider?: StacProvider;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** Throws a readable error when the search parameters make no sense. */
export function validateSearchOptions(options: SearchOptions): void {
  if (options.collections.length === 0) {
    throw new Error("Indica al menos una colección.");
  }
  for (const [label, value] of [["--from", options.from], ["--to", options.to]] as const) {
    if (!isRealDate(value)) {
      throw new Error(`Fecha ${label} inválida "${value}": usa el formato AAAA-MM-DD.`);
    }
  }
  if (options.from > options.to) {
    throw new Error(`El periodo está invertido: ${options.from} es posterior a ${options.to}.`);
  }
  if (options.maxCloud !== undefined && !(options.maxCloud >= 0 && options.maxCloud <= 100)) {
    throw new Error("La nubosidad máxima debe estar entre 0 y 100.");
  }
  if (!Number.isInteger(options.maxItems) || options.maxItems < 1) {
    throw new Error("El máximo de escenas debe ser un entero positivo.");
  }
}

/** Builds the STAC search for one collection. */
export function buildSearchBody(
  info: CollectionInfo,
  geometry: AreaGeometry,
  options: SearchOptions,
): StacSearchBody {
  const body: StacSearchBody = {
    collections: [info.id],
    intersects: geometry,
    datetime: `${options.from}T00:00:00Z/${options.to}T23:59:59Z`,
    sortby: [{ field: "properties.datetime", direction: "desc" }],
    fields: { include: SCENE_FIELDS, exclude: ["assets", "links"] },
  };
  if (info.cloudFilter && options.maxCloud !== undefined) {
    body.filter = { op: "<=", args: [{ property: "eo:cloud_cover" }, options.maxCloud] };
    body["filter-lang"] = "cql2-json";
  }
  return body;
}

async function discoverCollection(
  info: CollectionInfo,
  searchGeometry: AreaGeometry,
  target: CoverageTarget,
  options: DiscoverOptions,
  provider: StacProvider,
  hooks: DiscoveryHooks,
): Promise<CollectionSummary> {
  const started = performance.now();
  hooks.onCollectionStart?.(info.alias);
  const request = {
    timeoutMs: options.timeoutMs,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  };

  try {
    // Band listing is a nice-to-have: a failure there must not hide the scenes.
    const [result, collection] = await Promise.all([
      searchStac(provider, buildSearchBody(info, searchGeometry, options), {
        ...request,
        maxItems: options.maxItems,
        onPage: (count) => hooks.onPage?.(info.alias, count),
      }),
      fetchCollection(provider, info.id, request).catch(() => undefined),
    ]);

    const summary = summarizeCollection({
      info,
      scenes: result.items.map((item) => normalizeItem(item, target)),
      bands: bandsFromAssets(collection?.item_assets),
      truncated: result.truncated,
      durationMs: performance.now() - started,
    });
    hooks.onCollectionDone?.(summary);
    return summary;
  } catch (error) {
    const summary = summarizeCollection({
      info,
      scenes: [],
      bands: [],
      truncated: false,
      durationMs: performance.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    hooks.onCollectionDone?.(summary);
    return summary;
  }
}

/**
 * Describes an AOI and lists the satellite data available over it. Only
 * catalogue metadata is read: nothing is downloaded or processed.
 */
export async function discoverArea(
  aoiOrInput: Aoi | LoadAoiInput,
  options: DiscoverOptions,
  hooks: DiscoveryHooks = {},
): Promise<DiscoveryReport> {
  validateSearchOptions(options);
  const started = performance.now();
  const aoi = "geometry" in aoiOrInput ? aoiOrInput : await loadAoi(aoiOrInput);
  const metrics = computeAoiMetrics(aoi);
  const provider = options.provider ?? COPERNICUS_CDSE;

  const useBbox = metrics.vertexCount > SEARCH_VERTEX_LIMIT;
  const searchGeometry = useBbox ? bboxToPolygon(metrics.bbox) : aoi.geometry;
  const target: CoverageTarget = { geometry: aoi.geometry, areaM2: metrics.areaM2 };

  const collections = await Promise.all(
    options.collections.map((alias) =>
      discoverCollection(getCollection(alias), searchGeometry, target, options, provider, hooks),
    ),
  );

  const search: SearchOptions = {
    collections: options.collections,
    from: options.from,
    to: options.to,
    ...(options.maxCloud !== undefined ? { maxCloud: options.maxCloud } : {}),
    maxItems: options.maxItems,
    timeoutMs: options.timeoutMs,
  };

  return {
    generator: { name: "@geoaltia/cli", version: VERSION },
    generatedAt: new Date().toISOString(),
    provider: { id: provider.id, name: provider.name, url: provider.url },
    aoi: {
      source: aoi.source,
      crs: aoi.crs,
      metrics,
      ignoredFeatures: aoi.ignoredFeatures,
      searchGeometry: useBbox ? "bbox" : "aoi",
      geometry: aoi.geometry,
    },
    search,
    collections,
    totals: {
      scenes: collections.reduce((total, summary) => total + summary.sceneCount, 0),
      collectionsWithData: collections.filter((summary) => summary.sceneCount > 0).length,
      durationMs: performance.now() - started,
    },
  };
}
