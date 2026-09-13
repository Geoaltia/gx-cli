import { area } from "@turf/area";
import { intersect } from "@turf/intersect";

import { crsForMgrsTile } from "@/core/aoi/crs";
import type { StacAsset, StacItem } from "@/core/stac/client";
import type { AreaGeometry, BandSummary, BBox, SceneSummary } from "@/types";

/** Properties requested through the fields extension: everything we summarise, nothing more. */
export const SCENE_FIELDS = [
  "id",
  "collection",
  "bbox",
  "geometry",
  "properties.datetime",
  "properties.platform",
  "properties.product:type",
  "properties.processing:level",
  "properties.processing:version",
  "properties.eo:cloud_cover",
  "properties.eo:snow_cover",
  "properties.grid:code",
  "properties.sat:relative_orbit",
  "properties.sat:absolute_orbit",
  "properties.sat:orbit_state",
  "properties.sar:instrument_mode",
  "properties.sar:polarizations",
  "properties.gsd",
  "properties.proj:code",
  "properties.proj:epsg",
  "properties._private.product_size",
];

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const strList = (value: unknown): string[] | undefined =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : undefined;

function isArea(geometry: StacItem["geometry"]): geometry is AreaGeometry {
  return geometry?.type === "Polygon" || geometry?.type === "MultiPolygon";
}

/** The AOI and its area, prepared once and reused for every scene. */
export interface CoverageTarget {
  geometry: AreaGeometry;
  areaM2: number;
}

/** Share of the AOI that falls inside a scene footprint, 0–1. */
export function aoiCoverage(target: CoverageTarget, footprint: AreaGeometry): number | undefined {
  if (target.areaM2 <= 0) return undefined;
  try {
    const overlap = intersect({
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: target.geometry },
        { type: "Feature", properties: {}, geometry: footprint },
      ],
    });
    if (!overlap) return 0;
    return Math.min(1, area(overlap) / target.areaM2);
  } catch {
    return undefined;
  }
}

/** Reduces a STAC item to the metadata gx reports. */
export function normalizeItem(item: StacItem, target?: CoverageTarget): SceneSummary {
  const p = item.properties;
  const privateProps = (p["_private"] ?? {}) as Record<string, unknown>;
  const tile = str(p["grid:code"])?.replace(/^MGRS-/, "");
  const epsg = num(p["proj:epsg"]);
  const crs =
    str(p["proj:code"]) ??
    (epsg !== undefined ? `EPSG:${epsg}` : undefined) ??
    (tile ? crsForMgrsTile(tile) : undefined);
  const footprint = isArea(item.geometry) ? item.geometry : undefined;
  const coverage = target && footprint ? aoiCoverage(target, footprint) : undefined;
  const bbox = item.bbox?.length === 4 ? (item.bbox as BBox) : undefined;

  const scene: SceneSummary = {
    id: item.id,
    collection: item.collection ?? "",
    datetime: str(p["datetime"]) ?? "",
  };

  const optional: Partial<SceneSummary> = {
    platform: str(p["platform"]),
    productType: str(p["product:type"]),
    processingLevel: str(p["processing:level"]),
    processingVersion: str(p["processing:version"]),
    cloudCover: num(p["eo:cloud_cover"]),
    snowCover: num(p["eo:snow_cover"]),
    tile,
    relativeOrbit: num(p["sat:relative_orbit"]),
    absoluteOrbit: num(p["sat:absolute_orbit"]),
    orbitState: str(p["sat:orbit_state"]),
    instrumentMode: str(p["sar:instrument_mode"]),
    polarizations: strList(p["sar:polarizations"]),
    gsd: num(p["gsd"]),
    crs,
    aoiCoverage: coverage,
    productBytes: num(privateProps["product_size"]),
    bbox,
    footprint,
  };

  for (const [key, value] of Object.entries(optional)) {
    if (value !== undefined) (scene as unknown as Record<string, unknown>)[key] = value;
  }
  return scene;
}

function assetResolution(key: string, asset: StacAsset): number | undefined {
  if (typeof asset.gsd === "number") return asset.gsd;
  const role = asset.roles?.find((entry) => /^gsd:\d+m$/.test(entry));
  const match = /_(\d+)m$/.exec(key) ?? (role ? /(\d+)/.exec(role) : null);
  return match?.[1] ? Number(match[1]) : undefined;
}

/**
 * Bands and polarizations offered by a collection, read from its
 * `item_assets`. Metadata, archives, thumbnails and RGB previews are left out.
 */
export function bandsFromAssets(assets: Record<string, StacAsset> | undefined): BandSummary[] {
  const bands = new Map<string, BandSummary>();

  for (const [key, asset] of Object.entries(assets ?? {})) {
    const roles = asset.roles ?? [];
    if (!roles.includes("data") || roles.includes("archive") || roles.includes("metadata")) {
      continue;
    }

    const band = asset["eo:bands"]?.[0] ?? asset.bands?.[0];
    const name = band?.name ?? key.replace(/_\d+m$/, "").toUpperCase();
    const existing = bands.get(name) ?? { name, resolutions: [] };

    const description = band?.description ?? asset.title ?? asset.description;
    if (!existing.description && description) existing.description = description;
    const commonName = band?.["eo:common_name"];
    if (!existing.commonName && commonName) existing.commonName = commonName;
    const wavelength = band?.["eo:center_wavelength"];
    if (existing.centerWavelength === undefined && wavelength !== undefined) {
      existing.centerWavelength = wavelength;
    }

    const resolution = assetResolution(key, asset);
    if (resolution !== undefined && !existing.resolutions.includes(resolution)) {
      existing.resolutions.push(resolution);
      existing.resolutions.sort((a, b) => a - b);
    }
    bands.set(name, existing);
  }

  return [...bands.values()].sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
}
