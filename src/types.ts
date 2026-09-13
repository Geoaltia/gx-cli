import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Polygon,
} from "geojson";

/** `[minLon, minLat, maxLon, maxLat]` in EPSG:4326. */
export type BBox = [number, number, number, number];

/** Polygonal geometries: the only ones that describe an area of interest. */
export type AreaGeometry = Polygon | MultiPolygon;

/** Every way an AOI can be handed to gx. */
export type AoiSourceKind =
  | "geojson"
  | "wkt"
  | "bbox"
  | "kml"
  | "kmz"
  | "shapefile";

/** Where the coordinate reference system of the input came from. */
export type CrsOrigin =
  | "default"
  | "flag"
  | "geojson-crs"
  | "ewkt"
  | "prj";

export interface CrsInfo {
  /** Normalized code such as `EPSG:4326`, when one could be identified. */
  code?: string;
  /** Human readable name (`WGS 84`, `ETRS89 / UTM zone 30N`, …). */
  name: string;
  origin: CrsOrigin;
  /** `true` when coordinates had to be transformed to EPSG:4326. */
  reprojected: boolean;
}

/** Where the AOI was read from, in a form that is safe to print. */
export interface AoiSource {
  kind: AoiSourceKind;
  /** Absolute path when the AOI came from a file. */
  path?: string;
  /** Short label for display: file name, `--bbox` or `--wkt`. */
  label: string;
}

/** A loaded area of interest, always in EPSG:4326 (RFC 7946). */
export interface Aoi {
  source: AoiSource;
  crs: CrsInfo;
  /** Polygonal features of the input, with their original properties. */
  features: FeatureCollection<AreaGeometry>;
  /** All polygons merged into a single geometry, used for the search. */
  geometry: AreaGeometry;
  /** Points/lines found in the input and left out of the AOI. */
  ignoredFeatures: number;
}

export interface UtmZone {
  zone: number;
  hemisphere: "N" | "S";
  /** WGS 84 / UTM code, e.g. `EPSG:32630`. */
  epsg: string;
}

/** Basic, descriptive numbers about the AOI. Geodesic, on a sphere of WGS 84 mean radius. */
export interface AoiMetrics {
  areaM2: number;
  perimeterM: number;
  bbox: BBox;
  /** `[lon, lat]`. */
  centroid: [number, number];
  featureCount: number;
  polygonCount: number;
  vertexCount: number;
  /** UTM zone that contains the centroid: a sensible metric CRS for the area. */
  utmZone: UtmZone;
  valid: boolean;
  /** Human readable problems found while validating the geometry. */
  issues: string[];
}

/** Short aliases accepted by `--collections`. */
export type CollectionAlias = "s2-l2a" | "s2-l1c" | "s1-grd";

/** A band or polarization offered by a collection. */
export interface BandSummary {
  name: string;
  description?: string;
  /** STAC `eo:common_name` (`red`, `nir`, …). */
  commonName?: string;
  /** Centre wavelength in micrometres. */
  centerWavelength?: number;
  /** Available ground sample distances, in metres, ascending. */
  resolutions: number[];
}

/** The metadata we keep for each scene: enough to decide, nothing to process. */
export interface SceneSummary {
  id: string;
  collection: string;
  /** ISO 8601 acquisition time. */
  datetime: string;
  platform?: string;
  productType?: string;
  processingLevel?: string;
  processingVersion?: string;
  cloudCover?: number;
  snowCover?: number;
  /** MGRS tile for Sentinel-2 (`30TVK`). */
  tile?: string;
  relativeOrbit?: number;
  absoluteOrbit?: number;
  orbitState?: string;
  instrumentMode?: string;
  polarizations?: string[];
  gsd?: number;
  /** CRS of the scene rasters, when the catalogue publishes it. */
  crs?: string;
  /** Share of the AOI inside the scene footprint, 0–1. */
  aoiCoverage?: number;
  /** Size of the full product archive in bytes, when published. */
  productBytes?: number;
  thumbnail?: string;
  bbox?: BBox;
  footprint?: AreaGeometry;
}

export interface NumericRange {
  min: number;
  max: number;
  mean: number;
}

/** Aggregated view of every scene found for one collection. */
export interface CollectionSummary {
  collection: string;
  alias: CollectionAlias;
  title: string;
  mission: string;
  sceneCount: number;
  /** `true` when the search stopped at `maxItems` and more scenes exist. */
  truncated: boolean;
  firstDate?: string;
  lastDate?: string;
  /** Distinct acquisition days (`YYYY-MM-DD`), ascending. */
  acquisitionDates: string[];
  cloudCover?: NumericRange;
  aoiCoverage?: NumericRange;
  /** Scenes that cover (almost) the whole AOI (≥ 99 %). */
  fullCoverageScenes: number;
  platforms: string[];
  tiles: string[];
  relativeOrbits: number[];
  orbitStates: string[];
  instrumentModes: string[];
  polarizations: string[];
  productTypes: string[];
  processingVersions: string[];
  crs: string[];
  bands: BandSummary[];
  scenes: SceneSummary[];
  durationMs: number;
  /** Set when the query for this collection failed. */
  error?: string;
}

/** Everything a discovery run needs, already validated. */
export interface SearchOptions {
  collections: CollectionAlias[];
  /** `YYYY-MM-DD`, inclusive. */
  from: string;
  /** `YYYY-MM-DD`, inclusive. */
  to: string;
  /** Maximum cloud cover (0–100). Only applies to optical collections. */
  maxCloud?: number;
  /** Stop paginating a collection after this many scenes. */
  maxItems: number;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
}

/** The full result of `discoverArea`: what the CLI prints and exports. */
export interface DiscoveryReport {
  generator: { name: string; version: string };
  generatedAt: string;
  provider: { id: string; name: string; url: string };
  aoi: {
    source: AoiSource;
    crs: CrsInfo;
    metrics: AoiMetrics;
    ignoredFeatures: number;
    /** `bbox` when the AOI was too detailed and its envelope was searched. */
    searchGeometry: "aoi" | "bbox";
    geometry: AreaGeometry;
  };
  search: SearchOptions;
  collections: CollectionSummary[];
  totals: { scenes: number; collectionsWithData: number; durationMs: number };
}

/** Callbacks used by the CLI to render live progress. */
export interface DiscoveryHooks {
  onCollectionStart?: (alias: CollectionAlias) => void;
  onPage?: (alias: CollectionAlias, scenesSoFar: number) => void;
  onCollectionDone?: (summary: CollectionSummary) => void;
}

export type AoiFeature = Feature<AreaGeometry>;
