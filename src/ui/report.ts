import { COLLECTIONS } from "@/core/stac/collections";
import type {
  Aoi,
  AoiMetrics,
  BandSummary,
  CollectionSummary,
  CrsInfo,
  DiscoveryReport,
  SceneSummary,
  SearchOptions,
} from "@/types";
import {
  daysInclusive,
  formatArea,
  formatBytes,
  formatCoordinate,
  formatDate,
  formatDateTime,
  formatDuration,
  formatLength,
  formatNumber,
  truncateEnd,
} from "@/ui/format";
import { renderPanel, renderTable, type Column } from "@/ui/table";
import { colorCloud, colorCollection, colorCoverage, icons, theme } from "@/ui/theme";

type Row = [string, string];

function keyValuePanel(title: string, rows: Row[]): string {
  const keyWidth = Math.max(...rows.map(([key]) => key.length));
  const lines = rows.map(([key, value]) =>
    `${key === "" ? " ".repeat(keyWidth) : theme.label(key.padEnd(keyWidth))}  ${value}`,
  );
  return renderPanel(title, lines);
}

const CRS_ORIGIN: Record<CrsInfo["origin"], string> = {
  default: "por defecto (RFC 7946)",
  flag: "indicado con --crs",
  "geojson-crs": "miembro crs del GeoJSON",
  ewkt: "SRID del EWKT",
  prj: "archivo .prj",
};

function describeCrs(crs: CrsInfo): string {
  const code = crs.code && crs.code !== crs.name ? ` ${theme.muted(`(${crs.code})`)}` : "";
  const origin = theme.dim(`· ${CRS_ORIGIN[crs.origin]}`);
  return `${theme.bold(truncateEnd(crs.name, 48))}${code} ${origin}`;
}

/** The AOI recap: size, CRS, extent and validity. */
export function renderAoiPanel(
  aoi: Pick<Aoi, "source" | "crs" | "ignoredFeatures">,
  metrics: AoiMetrics,
  searchGeometry?: "aoi" | "bbox",
): string {
  const [minX, minY, maxX, maxY] = metrics.bbox;
  const hectares = formatNumber(metrics.areaM2 / 10_000, 2);

  const rows: Row[] = [
    ["Fuente", `${theme.bold(aoi.source.label)} ${theme.dim(`· ${aoi.source.kind}`)}`],
    ["Superficie", `${theme.accent(formatArea(metrics.areaM2))} ${theme.muted(`(${hectares} ha)`)}`],
    ["Perímetro", theme.accent(formatLength(metrics.perimeterM))],
    [
      "Geometría",
      theme.muted(
        `${metrics.featureCount} feature(s) · ${metrics.polygonCount} polígono(s) · ${formatNumber(metrics.vertexCount)} vértices`,
      ),
    ],
    ["CRS origen", describeCrs(aoi.crs)],
    [
      "CRS de trabajo",
      `${theme.bold("EPSG:4326")} ${theme.muted("WGS 84")}${aoi.crs.reprojected ? ` ${theme.dim("· reproyectado")}` : ""}`,
    ],
    [
      "UTM sugerido",
      `${theme.bold(metrics.utmZone.epsg)} ${theme.muted(`WGS 84 / UTM ${metrics.utmZone.zone}${metrics.utmZone.hemisphere}`)}`,
    ],
    [
      "BBox",
      theme.muted(
        `${formatCoordinate(minX)}, ${formatCoordinate(minY)}, ${formatCoordinate(maxX)}, ${formatCoordinate(maxY)}`,
      ),
    ],
    [
      "Centroide",
      theme.muted(`${formatCoordinate(metrics.centroid[1])}, ${formatCoordinate(metrics.centroid[0])} (lat, lon)`),
    ],
    [
      "Validez",
      metrics.valid
        ? `${theme.ok(icons.ok)} ${theme.ok("geometría válida")}`
        : `${theme.err(icons.fail)} ${theme.err("geometría con problemas")}`,
    ],
  ];

  for (const issue of metrics.issues) {
    rows.push(["", `${theme.warn(icons.warn)} ${theme.warn(issue)}`]);
  }
  if (aoi.ignoredFeatures > 0) {
    rows.push(["Ignorados", theme.warn(`${aoi.ignoredFeatures} punto(s)/línea(s) sin área`)]);
  }
  if (searchGeometry === "bbox") {
    rows.push(["Búsqueda", theme.warn("por envolvente (AOI con muchos vértices)")]);
  }

  return keyValuePanel(theme.brandBold("Área de interés"), rows);
}

/** What is about to be (or was) asked to the catalogue. */
export function renderSearchPanel(
  search: SearchOptions,
  provider: { name: string; url: string },
): string {
  const days = daysInclusive(search.from, search.to);
  const rows: Row[] = [
    ["Catálogo", `${theme.bold(provider.name)} ${theme.dim(provider.url)}`],
    [
      "Colecciones",
      search.collections.map((alias) => colorCollection(alias)).join(theme.muted(", ")),
    ],
    [
      "Periodo",
      `${theme.accent(search.from)} ${theme.dim(icons.arrow)} ${theme.accent(search.to)} ${theme.muted(`(${formatNumber(days)} días)`)}`,
    ],
    [
      "Nubosidad máx.",
      search.maxCloud === undefined
        ? theme.muted("sin límite")
        : `${theme.accent(`${search.maxCloud} %`)} ${theme.dim("· solo ópticas")}`,
    ],
    ["Máx. escenas", theme.muted(`${formatNumber(search.maxItems)} por colección`)],
  ];
  return keyValuePanel(theme.brandBold("Búsqueda"), rows);
}

function rangeText(
  range: { min: number; mean: number; max: number } | undefined,
  paint: (value: number, text: string) => string,
  format: (value: number) => string,
): string {
  if (!range) return theme.muted("—");
  return [range.min, range.mean, range.max]
    .map((value) => paint(value, format(value)))
    .join(theme.dim(" / "));
}

const percent = (value: number): string => `${formatNumber(value, 0)}%`;
const ratioPercent = (value: number): string => `${formatNumber(value * 100, 0)}%`;

/** One row per collection: the headline answer to "what is there?". */
export function renderCollectionsTable(collections: CollectionSummary[]): string {
  const columns: Column[] = [
    { header: "COLECCIÓN", align: "left" },
    { header: "ESCENAS", align: "right" },
    { header: "DÍAS", align: "right" },
    { header: "PRIMERA", align: "left" },
    { header: "ÚLTIMA", align: "left" },
    { header: "NUBES mín/med/máx", align: "left" },
    { header: "COBERTURA AOI mín/med/máx", align: "left" },
  ];

  const rows = collections.map((summary) => {
    const name = colorCollection(summary.alias);
    if (summary.error) {
      return [
        `${theme.err(icons.fail)} ${name}`,
        theme.err("error"),
        theme.muted("—"),
        theme.muted("—"),
        theme.muted("—"),
        theme.muted("—"),
        theme.muted("—"),
      ];
    }
    const icon = summary.sceneCount > 0 ? theme.ok(icons.ok) : theme.warn(icons.skip);
    const count = summary.truncated
      ? theme.warn(`${formatNumber(summary.sceneCount)}+`)
      : summary.sceneCount > 0
        ? theme.bold(formatNumber(summary.sceneCount))
        : theme.muted("0");

    return [
      `${icon} ${name}`,
      count,
      theme.muted(formatNumber(summary.acquisitionDates.length)),
      theme.muted(formatDate(summary.firstDate)),
      theme.muted(formatDate(summary.lastDate)),
      rangeText(summary.cloudCover, colorCloud, percent),
      rangeText(summary.aoiCoverage, colorCoverage, ratioPercent),
    ];
  });

  return renderTable(columns, rows);
}

function list(values: Array<string | number>, max = 12): string {
  if (values.length === 0) return theme.muted("—");
  const shown = values.slice(0, max).join(", ");
  const rest = values.length > max ? theme.dim(` (+${values.length - max})`) : "";
  return `${theme.bold(shown)}${rest}`;
}

function bandLines(bands: BandSummary[]): string[] {
  if (bands.length === 0) return [theme.muted("no disponible")];
  const entries = bands.map((band) => {
    const resolution = band.resolutions.length > 0 ? theme.muted(` ${band.resolutions.join("/")}m`) : "";
    const common = band.commonName ? theme.dim(` ${band.commonName}`) : "";
    return `${theme.bold(band.name)}${common}${resolution}`;
  });

  const lines: string[] = [];
  for (let index = 0; index < entries.length; index += 3) {
    lines.push(entries.slice(index, index + 3).join(theme.dim("  ·  ")));
  }
  return lines;
}

/** Metadata detail for one collection: platforms, tiles/orbits, bands… */
export function renderCollectionDetail(summary: CollectionSummary): string {
  const title = `${colorCollection(summary.alias, theme.bold(summary.title))} ${theme.dim(summary.collection)}`;

  if (summary.error) {
    return keyValuePanel(title, [["Error", theme.err(summary.error)]]);
  }
  if (summary.sceneCount === 0) {
    return keyValuePanel(title, [
      ["Escenas", theme.warn("ninguna en el periodo y filtros indicados")],
    ]);
  }

  const info = COLLECTIONS.find((collection) => collection.alias === summary.alias);
  const rows: Row[] = [
    [
      "Escenas",
      `${theme.bold(formatNumber(summary.sceneCount))} ${theme.muted(`en ${formatNumber(summary.acquisitionDates.length)} días distintos`)}${summary.truncated ? ` ${theme.warn(`${icons.warn} limitado a --max-items`)}` : ""}`,
    ],
    [
      "AOI completa",
      `${theme.bold(formatNumber(summary.fullCoverageScenes))} ${theme.muted("escenas cubren ≥ 99 % del AOI")}`,
    ],
    ["Plataformas", list(summary.platforms)],
    ["Producto", list(summary.productTypes)],
  ];

  if (info?.kind === "optical") {
    rows.push(["Tiles MGRS", list(summary.tiles)]);
  }
  rows.push([
    "Órbitas rel.",
    `${list(summary.relativeOrbits)}${summary.orbitStates.length > 0 ? theme.muted(` · ${summary.orbitStates.join(", ")}`) : ""}`,
  ]);
  if (info?.kind === "sar") {
    rows.push(["Modo", list(summary.instrumentModes)]);
    rows.push(["Polarización", list(summary.polarizations)]);
  }
  if (summary.crs.length > 0) rows.push(["CRS ráster", list(summary.crs)]);
  rows.push(["Procesado", list(summary.processingVersions)]);

  const sizes = summary.scenes
    .map((scene) => scene.productBytes)
    .filter((value): value is number => value !== undefined);
  if (sizes.length > 0) {
    const total = sizes.reduce((sum, value) => sum + value, 0);
    rows.push([
      "Volumen",
      `${theme.bold(formatBytes(total))} ${theme.muted(`(media ${formatBytes(total / sizes.length)} por producto)`)}`,
    ]);
  }

  const [firstBand, ...otherBands] = bandLines(summary.bands);
  rows.push([info?.kind === "sar" ? "Canales" : "Bandas", `${firstBand ?? ""}`]);
  if (summary.bands.length > 0) otherBands.push(theme.dim("según el catálogo de la colección"));
  for (const line of otherBands) rows.push(["", line]);

  return keyValuePanel(title, rows);
}

function sceneTileOrOrbit(scene: SceneSummary): string {
  if (scene.tile) return scene.tile;
  if (scene.relativeOrbit !== undefined) {
    const state = scene.orbitState ? ` ${scene.orbitState.slice(0, 3)}` : "";
    return `R${scene.relativeOrbit}${state}`;
  }
  return "—";
}

/** Per-scene listing, newest first. */
export function renderScenesTable(summary: CollectionSummary, limit: number): string {
  if (summary.scenes.length === 0) return "";
  const isSar = summary.scenes.some((scene) => scene.polarizations !== undefined);

  const columns: Column[] = [
    { header: "FECHA (UTC)", align: "left" },
    { header: "PLAT.", align: "left" },
    { header: isSar ? "ÓRBITA" : "TILE", align: "left" },
    { header: isSar ? "POL." : "NUBES", align: isSar ? "left" : "right" },
    { header: "COBERTURA", align: "right" },
    { header: "ID", align: "left" },
  ];

  const scenes = summary.scenes.slice(0, limit);
  const rows = scenes.map((scene) => [
    theme.muted(formatDateTime(scene.datetime)),
    theme.muted((scene.platform ?? "—").replace(/^sentinel-/i, "S").toUpperCase()),
    theme.bold(sceneTileOrOrbit(scene)),
    isSar
      ? theme.muted(scene.polarizations?.join("+") ?? "—")
      : scene.cloudCover !== undefined
        ? colorCloud(scene.cloudCover, `${formatNumber(scene.cloudCover, 1)}%`)
        : theme.muted("—"),
    scene.aoiCoverage !== undefined
      ? colorCoverage(scene.aoiCoverage, ratioPercent(scene.aoiCoverage))
      : theme.muted("—"),
    theme.dim(scene.id),
  ]);

  const lines = [
    `${colorCollection(summary.alias, theme.bold(summary.title))} ${theme.muted(`· escenas (${formatNumber(scenes.length)} de ${formatNumber(summary.sceneCount)})`)}`,
    renderTable(columns, rows),
  ];
  return lines.join("\n");
}

/** The closing line with totals. */
export function renderTotals(report: DiscoveryReport): string {
  const failed = report.collections.filter((summary) => summary.error).length;
  const icon = failed > 0 ? theme.warn(icons.warn) : theme.ok(icons.ok);
  const text = `${formatNumber(report.totals.scenes)} escenas en ${report.totals.collectionsWithData} de ${report.collections.length} colecciones`;
  const errors = failed > 0 ? ` ${theme.err(`· ${failed} con error`)}` : "";
  return `${icon} ${theme.bold(text)}${errors} ${theme.dim(`· ${formatDuration(report.totals.durationMs)}`)}`;
}

/** Offline catalogue listing for `geoaltia collections`. */
export function renderCollectionsCatalog(): string {
  const columns: Column[] = [
    { header: "ALIAS", align: "left" },
    { header: "COLECCIÓN STAC", align: "left" },
    { header: "TIPO", align: "left" },
    { header: "RESOLUCIÓN", align: "left" },
    { header: "REVISITA", align: "left" },
    { header: "NUBES", align: "center" },
  ];
  const rows = COLLECTIONS.map((collection) => [
    colorCollection(collection.alias, theme.bold(collection.alias)),
    theme.muted(collection.id),
    collection.kind === "optical" ? "óptico" : "radar (SAR)",
    theme.muted(collection.resolution),
    theme.muted(collection.revisit),
    collection.cloudFilter ? theme.ok(icons.ok) : theme.muted("—"),
  ]);

  const details = COLLECTIONS.map(
    (collection) =>
      `  ${colorCollection(collection.alias, theme.bold(collection.title))}  ${collection.description}\n  ${" ".repeat(collection.title.length)}  ${theme.muted(collection.bandsHint)}`,
  );

  return [renderTable(columns, rows), "", ...details].join("\n");
}
