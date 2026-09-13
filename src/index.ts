/**
 * `@geoaltia/cli` — programmatic API.
 *
 * The CLI (`geoaltia` / `gx`) is a thin layer on top of these functions, so
 * anything the command line can do is available from code as well.
 *
 * ```ts
 * import { discoverArea, toGeoJson } from "@geoaltia/cli";
 *
 * const report = await discoverArea(
 *   { file: "parcela.geojson" },
 *   {
 *     collections: ["s2-l2a", "s1-grd"],
 *     from: "2026-06-01",
 *     to: "2026-08-31",
 *     maxCloud: 30,
 *     maxItems: 500,
 *     timeoutMs: 60_000,
 *   },
 * );
 *
 * console.log(report.aoi.metrics.areaM2, report.totals.scenes);
 * ```
 */

export { discoverArea, buildSearchBody, validateSearchOptions } from "@/core/discover";
export type { DiscoverOptions } from "@/core/discover";
export { loadAoi, AOI_EXTENSIONS } from "@/core/aoi/load";
export type { LoadAoiInput } from "@/core/aoi/load";
export { computeAoiMetrics } from "@/core/aoi/metrics";
export { parseWkt } from "@/core/aoi/wkt";
export { parseBBox, bboxToPolygon } from "@/core/aoi/bbox";
export { resolveCrs, reprojectToWgs84, utmZoneFor, crsForMgrsTile } from "@/core/aoi/crs";
export { searchStac, fetchCollection } from "@/core/stac/client";
export type { StacItem, StacSearchBody, SearchStacOptions, SearchStacResult } from "@/core/stac/client";
export {
  COLLECTIONS,
  DEFAULT_COLLECTIONS,
  findCollection,
  parseCollectionList,
} from "@/core/stac/collections";
export type { CollectionInfo } from "@/core/stac/collections";
export { COPERNICUS_CDSE } from "@/core/stac/providers/copernicus";
export type { StacProvider } from "@/core/stac/providers/copernicus";
export { normalizeItem, bandsFromAssets } from "@/core/stac/normalize";
export { summarizeCollection } from "@/core/stac/summarize";
export { toJson, toGeoJson, aoiToJson, aoiToGeoJson, formatFromPath } from "@/core/export";
export type { ExportFormat } from "@/core/export";
export { VERSION } from "@/version";

export type {
  Aoi,
  AoiMetrics,
  AoiSource,
  AoiSourceKind,
  AreaGeometry,
  BandSummary,
  BBox,
  CollectionAlias,
  CollectionSummary,
  CrsInfo,
  DiscoveryHooks,
  DiscoveryReport,
  NumericRange,
  SceneSummary,
  SearchOptions,
  UtmZone,
} from "@/types";
