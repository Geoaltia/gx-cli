import { COLLECTION_ALIASES } from "@/core/stac/collections";
import { TAGLINE } from "@/ui/banner";
import { visibleWidth } from "@/ui/format";
import { icons, theme } from "@/ui/theme";
import { VERSION } from "@/version";

type Entry = [string, string, string?];

const COMMANDS: Entry[] = [
  ["scan [aoi]", "Describe el AOI y lista los datos Sentinel disponibles.", "comando por defecto: geoaltia <aoi> equivale a geoaltia scan <aoi>"],
  ["aoi [aoi]", "Solo métricas del AOI (superficie, CRS, bbox…). No usa la red."],
  ["collections", "Colecciones soportadas, con alias, resolución y bandas."],
];

const AOI_OPTIONS: Entry[] = [
  ["[aoi]", "Archivo con el área de interés, o - para leer de stdin.", ".geojson .json .kml .kmz .shp .zip .wkt"],
  ["-b, --bbox <minx,miny,maxx,maxy>", "Rectángulo en lugar de archivo."],
  ["-w, --wkt <wkt>", "Geometría WKT o EWKT (SRID=25830;POLYGON(...))."],
  ["    --crs <crs>", "CRS de las coordenadas de entrada si no es EPSG:4326.", "EPSG:25830 · 32630 · cadena proj4 · WKT (tiene prioridad sobre .prj)"],
];

const SEARCH_OPTIONS: Entry[] = [
  ["-c, --collections <lista>", "Colecciones a consultar, separadas por comas.", `${COLLECTION_ALIASES.join(" | ")} (por defecto: s2-l2a,s1-grd)`],
  ["    --from <AAAA-MM-DD>", "Inicio del periodo (incluido).", "por defecto: hace 90 días"],
  ["    --to <AAAA-MM-DD>", "Fin del periodo (incluido).", "por defecto: hoy"],
  ["    --days <n>", "Atajo: los últimos n días hasta --to."],
  ["    --max-cloud <0-100>", "Nubosidad máxima por escena. Solo colecciones ópticas."],
  ["    --max-items <n>", "Máximo de escenas por colección.", "por defecto: 500"],
  ["    --timeout <s>", "Tiempo máximo por petición al catálogo.", "por defecto: 60"],
];

const OUTPUT_OPTIONS: Entry[] = [
  ["-f, --format <formato>", "Formato de salida.", "table | json | geojson (por defecto: table)"],
  ["-o, --output <archivo>", "Guarda el resultado; el formato se deduce de la extensión.", ".json → informe completo · .geojson → AOI + huellas de escenas"],
  ["-s, --scenes", "Lista las escenas de cada colección, de la más reciente a la más antigua."],
  ["    --limit <n>", "Escenas listadas por colección con --scenes.", "por defecto: 20"],
  ["-y, --yes", "Sin preguntas: usa flags y valores por defecto."],
  ["    --no-color", "Desactiva los colores (también respeta NO_COLOR)."],
  ["-v, --version", "Muestra la versión."],
  ["-h, --help", "Muestra esta ayuda."],
];

const EXAMPLES: Array<[string, string]> = [
  ["geoaltia", "Modo guiado: pide AOI, colecciones, periodo y nubosidad."],
  ["geoaltia parcela.geojson", "Datos S2 L2A y S1 GRD de los últimos 90 días."],
  ["gx finca.kmz --days 30 --max-cloud 20", "Último mes, escenas ópticas con ≤ 20 % de nubes."],
  ["gx -b -3.8,40.35,-3.6,40.5 -c s1-grd -s", "Solo radar sobre un bbox, con listado de escenas."],
  ["gx lotes.zip --from 2026-01-01 --to 2026-06-30", "Shapefile comprimido; CRS leído del .prj."],
  ["gx -w 'POLYGON((440000 4470000, ...))' --crs EPSG:25830", "WKT en ETRS89 / UTM 30N."],
  ["gx zona.shp -o output/zona.geojson", "Exporta AOI + huellas de escenas a GeoJSON."],
  ["gx zona.geojson -f json -y | jq '.totals'", "JSON por stdout para scripts."],
  ["gx aoi recinto.kml", "Solo superficie, perímetro, CRS y validez."],
];

function section(title: string): string {
  return theme.brandBold(title.toUpperCase());
}

function renderEntries(entries: Entry[]): string[] {
  const width = Math.max(...entries.map(([left]) => visibleWidth(left)));
  const lines: string[] = [];

  for (const [left, description, hint] of entries) {
    const padding = " ".repeat(width - visibleWidth(left));
    lines.push(`  ${theme.code(left)}${padding}   ${description}`);
    if (hint) {
      lines.push(`  ${" ".repeat(width)}   ${theme.muted(hint)}`);
    }
  }

  return lines;
}

/** The full, colourized `--help` screen. */
export function renderHelp(): string {
  const header = `${theme.accent(icons.globe)} ${theme.brandBold("geoaltia")} ${theme.muted("·")} ${theme.muted(TAGLINE)} ${theme.dim(`v${VERSION}`)}`;

  const usage = [
    `  ${theme.code("geoaltia")} ${theme.muted("[comando] [aoi] [opciones]")}`,
    `  ${theme.code("gx")} ${theme.muted("[comando] [aoi] [opciones]")}  ${theme.dim("(alias corto)")}`,
  ];

  const description = [
    `  Pásale un polígono o área de interés y te dice ${theme.bold("qué datos satelitales existen")}`,
    `  sobre esa zona en el catálogo STAC de ${theme.bold("Copernicus Data Space")}: superficie, CRS,`,
    `  escenas Sentinel-1/Sentinel-2, fechas, nubosidad, cobertura, bandas y metadatos.`,
    `  ${theme.muted("Solo lee metadatos del catálogo: no descarga imágenes ni hace análisis.")}`,
  ];

  const examples = renderEntries(
    EXAMPLES.map(([command, text]) => [command, theme.muted(text)]),
  );

  const notes = [
    `  ${theme.dim(icons.bullet)} Todo se calcula en EPSG:4326; superficie y perímetro son geodésicos (esfera, error < 0,5 %).`,
    `  ${theme.dim(icons.bullet)} La cobertura indica qué % del AOI cae dentro de la huella de cada escena.`,
    `  ${theme.dim(icons.bullet)} La búsqueda en Copernicus es pública: no hace falta cuenta ni token.`,
    `  ${theme.dim(icons.bullet)} Con ${theme.code("-f json")} o ${theme.code("-f geojson")} sin ${theme.code("-o")}, stdout solo contiene el documento.`,
  ];

  return [
    "",
    header,
    "",
    section("uso"),
    ...usage,
    "",
    section("descripción"),
    ...description,
    "",
    section("comandos"),
    ...renderEntries(COMMANDS),
    "",
    section("área de interés"),
    ...renderEntries(AOI_OPTIONS),
    "",
    section("búsqueda"),
    ...renderEntries(SEARCH_OPTIONS),
    "",
    section("salida"),
    ...renderEntries(OUTPUT_OPTIONS),
    "",
    section("ejemplos"),
    ...examples,
    "",
    section("notas"),
    ...notes,
    "",
  ].join("\n");
}
