/**
 * `@geoaltia/gx-cli/browser` — the programmatic API without Node built-ins.
 *
 * Same functions as the main entry except the ones that read files or stdin
 * (`loadAoi`, `discoverArea`). Load the AOI from bytes or text with
 * `parseAoi` and search with `discoverAoi`:
 *
 * ```ts
 * import { discoverAoi, parseAoi } from "@geoaltia/gx-cli/browser";
 *
 * const file = input.files[0];
 * const aoi = await parseAoi({ files: [{ name: file.name, data: await file.arrayBuffer() }] });
 * const report = await discoverAoi(aoi, {
 *   collections: ["s2-l2a", "s1-grd"],
 *   from: "2026-06-01",
 *   to: "2026-08-31",
 *   maxItems: 500,
 *   timeoutMs: 60_000,
 * });
 * ```
 */

export { discoverAoi, buildSearchBody, validateSearchOptions } from "@/core/discover";
export type { DiscoverOptions } from "@/core/discover";
export { parseAoi, AOI_EXTENSIONS } from "@/core/aoi/parse";
export type { AoiFileInput, ParseAoiInput } from "@/core/aoi/parse";
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
