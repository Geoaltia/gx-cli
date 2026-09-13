#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { Command, InvalidArgumentError } from "commander";

import { loadAoi, type LoadAoiInput } from "@/core/aoi/load";
import { computeAoiMetrics } from "@/core/aoi/metrics";
import { validateSearchOptions } from "@/core/discover";
import { discoverArea } from "@/core/discover-area";
import {
  aoiToGeoJson,
  aoiToJson,
  formatFromPath,
  toGeoJson,
  toJson,
} from "@/core/export";
import {
  COLLECTIONS,
  DEFAULT_COLLECTIONS,
  parseCollectionList,
} from "@/core/stac/collections";
import { COPERNICUS_CDSE } from "@/core/stac/providers/copernicus";
import {
  confirmRun,
  isoDaysAgo,
  promptAoiPath,
  runPrompts,
  type PromptableOptions,
} from "@/prompts";
import type { CollectionAlias, DiscoveryReport, SearchOptions } from "@/types";
import { renderBanner } from "@/ui/banner";
import { formatNumber } from "@/ui/format";
import { renderHelp } from "@/ui/help";
import { installCursorGuard, Spinner } from "@/ui/progress";
import {
  renderAoiPanel,
  renderCollectionDetail,
  renderCollectionsCatalog,
  renderCollectionsTable,
  renderScenesTable,
  renderSearchPanel,
  renderTotals,
} from "@/ui/report";
import { colorCollection, icons, theme } from "@/ui/theme";
import { VERSION } from "@/version";

type OutputFormat = "table" | "json" | "geojson";

const OUTPUT_FORMATS: OutputFormat[] = ["table", "json", "geojson"];

const DEFAULTS = {
  days: 90,
  maxItems: 500,
  timeoutSeconds: 60,
  scenesShown: 20,
};

interface AoiCliOptions {
  bbox?: string;
  wkt?: string;
  crs?: string;
  format?: OutputFormat;
  output?: string;
  yes?: boolean;
}

interface ScanCliOptions extends AoiCliOptions {
  collections?: CollectionAlias[];
  from?: string;
  to?: string;
  days?: number;
  maxCloud?: number;
  maxItems?: number;
  timeout?: number;
  scenes?: boolean;
  limit?: number;
}

// ─── Argument parsers ───────────────────────────────────────────────────────

function parseFormat(value: string): OutputFormat {
  const normalized = value.toLowerCase() as OutputFormat;
  if (!OUTPUT_FORMATS.includes(normalized)) {
    throw new InvalidArgumentError(`formato desconocido "${value}". Válidos: ${OUTPUT_FORMATS.join(", ")}.`);
  }
  return normalized;
}

function parseCollections(value: string): CollectionAlias[] {
  try {
    return parseCollectionList(value);
  } catch (error) {
    throw new InvalidArgumentError(error instanceof Error ? error.message : String(error));
  }
}

function integerIn(min: number, max: number, what: string) {
  return (value: string): number => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
      throw new InvalidArgumentError(`${what}: se esperaba un entero entre ${min} y ${max}.`);
    }
    return parsed;
  };
}

function parseDate(value: string): string {
  const trimmed = value.trim();
  const date = new Date(`${trimmed}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed) || Number.isNaN(date.getTime()) || !date.toISOString().startsWith(trimmed)) {
    throw new InvalidArgumentError(`fecha inválida "${value}": usa AAAA-MM-DD.`);
  }
  return trimmed;
}

// ─── Output helpers ─────────────────────────────────────────────────────────

function printLine(text = ""): void {
  process.stdout.write(`${text}\n`);
}

function printError(message: string): void {
  process.stderr.write(`${theme.err(icons.fail)} ${theme.err(message)}\n`);
}

/** `-f` wins; otherwise `-o` decides by extension; otherwise a table. */
function resolveFormat(options: AoiCliOptions): OutputFormat {
  if (options.output) {
    const fromPath = formatFromPath(options.output);
    if (options.format === undefined || options.format === "table") {
      if (!fromPath) {
        throw new Error(`No se puede deducir el formato de "${options.output}": usa .json o .geojson, o indica -f.`);
      }
      return fromPath;
    }
    return options.format;
  }
  return options.format ?? "table";
}

async function writeOutput(file: string, content: string): Promise<string> {
  const target = path.resolve(file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
  return target;
}

function aoiInput(aoi: string | undefined, options: AoiCliOptions): LoadAoiInput {
  return {
    ...(aoi !== undefined ? { file: aoi } : {}),
    ...(options.bbox !== undefined ? { bbox: options.bbox } : {}),
    ...(options.wkt !== undefined ? { wkt: options.wkt } : {}),
    ...(options.crs !== undefined ? { crs: options.crs } : {}),
  };
}

function isInteractiveRun(options: AoiCliOptions, format: OutputFormat): boolean {
  const dataToStdout = format !== "table" && !options.output;
  return (
    !dataToStdout &&
    options.yes !== true &&
    process.stdin.isTTY === true &&
    process.stdout.isTTY === true
  );
}

/** No AOI flag and data piped in: read the AOI from stdin. */
function stdinAoi(aoi: string | undefined, options: AoiCliOptions): string | undefined {
  if (aoi !== undefined || options.bbox !== undefined || options.wkt !== undefined) return aoi;
  return process.stdin.isTTY ? undefined : "-";
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function runScan(aoiArg: string | undefined, options: ScanCliOptions): Promise<number> {
  const format = resolveFormat(options);
  const dataToStdout = format !== "table" && !options.output;
  const interactive = isInteractiveRun(options, format);
  const aoiArgument = interactive ? aoiArg : stdinAoi(aoiArg, options);

  const to = options.to ?? isoDaysAgo(0);
  const days = options.days ?? DEFAULTS.days;
  const from = options.from ?? isoDaysAgo(days - 1, new Date(`${to}T00:00:00Z`));

  let chosen: PromptableOptions = {
    ...(aoiArgument !== undefined ? { aoi: aoiArgument } : {}),
    collections: options.collections ?? DEFAULT_COLLECTIONS,
    from,
    to,
    ...(options.maxCloud !== undefined ? { maxCloud: options.maxCloud } : {}),
  };

  const hasAoi = aoiArgument !== undefined || options.bbox !== undefined || options.wkt !== undefined;

  if (!dataToStdout) {
    printLine();
    printLine(renderBanner());
    printLine();
  }

  if (interactive) {
    chosen = await runPrompts(
      {
        aoi: hasAoi,
        collections: options.collections !== undefined,
        period: options.from !== undefined || options.to !== undefined || options.days !== undefined,
        maxCloud: options.maxCloud !== undefined,
      },
      chosen,
    );
    printLine();
  } else if (!hasAoi) {
    throw new Error("Falta el área de interés: pasa un archivo, --bbox o --wkt (o usa el modo guiado en una terminal).");
  }

  const search: SearchOptions = {
    collections: chosen.collections,
    from: chosen.from,
    to: chosen.to,
    ...(chosen.maxCloud !== undefined ? { maxCloud: chosen.maxCloud } : {}),
    maxItems: options.maxItems ?? DEFAULTS.maxItems,
    timeoutMs: (options.timeout ?? DEFAULTS.timeoutSeconds) * 1000,
  };
  validateSearchOptions(search);

  const aoi = await loadAoi(aoiInput(chosen.aoi, options));
  const metrics = computeAoiMetrics(aoi);

  if (!dataToStdout) {
    printLine(renderAoiPanel(aoi, metrics));
    printLine();
    printLine(renderSearchPanel(search, COPERNICUS_CDSE));
    printLine();
  }

  if (interactive && !(await confirmRun())) {
    printLine();
    printLine(`${theme.muted(icons.bullet)} ${theme.muted("Cancelado — no se consultó nada.")}`);
    printLine();
    return 0;
  }

  const spinner = new Spinner();
  const counts = new Map<CollectionAlias, { count: number; done: boolean }>(
    search.collections.map((alias) => [alias, { count: 0, done: false }]),
  );
  const spinnerLabel = (): string =>
    `${theme.muted("Consultando catálogo")}  ${[...counts]
      .map(
        ([alias, state]) =>
          `${colorCollection(alias)} ${state.done ? theme.ok(formatNumber(state.count)) : theme.bold(formatNumber(state.count))}`,
      )
      .join(theme.dim("  ·  "))}`;

  spinner.start(spinnerLabel());
  let report: DiscoveryReport;
  try {
    report = await discoverArea(aoi, search, {
      onPage: (alias, count) => {
        counts.set(alias, { count, done: false });
        spinner.setLabel(spinnerLabel());
      },
      onCollectionDone: (summary) => {
        counts.set(summary.alias, { count: summary.sceneCount, done: true });
        spinner.setLabel(spinnerLabel());
      },
    });
  } finally {
    spinner.stop();
  }

  const failed = report.collections.filter((summary) => summary.error);
  const document = format === "geojson" ? toGeoJson(report) : format === "json" ? toJson(report) : undefined;

  if (dataToStdout && document) {
    process.stdout.write(document);
    for (const summary of failed) printError(`${summary.alias}: ${summary.error}`);
    return failed.length > 0 ? 1 : 0;
  }

  printLine(renderCollectionsTable(report.collections));
  printLine();

  for (const summary of report.collections) {
    printLine(renderCollectionDetail(summary));
    printLine();
  }

  if (options.scenes === true) {
    const limit = options.limit ?? DEFAULTS.scenesShown;
    for (const summary of report.collections) {
      const table = renderScenesTable(summary, limit);
      if (table) {
        printLine(table);
        printLine();
      }
    }
  }

  printLine(renderTotals(report));

  if (options.output && document) {
    const target = await writeOutput(options.output, document);
    printLine(`${theme.ok(icons.ok)} ${theme.muted(`Exportado (${format}) a`)} ${theme.bold(target)}`);
  } else if (report.totals.scenes > 0) {
    const scenesHint = options.scenes !== true
      ? `${theme.code("-s")} ${theme.muted("para ver las escenas u ")}`
      : "";
    printLine(
      `${theme.dim(icons.bullet)} ${theme.muted("Añade")} ${scenesHint}${theme.code("-o informe.geojson")} ${theme.muted("para exportarlas.")}`,
    );
  }
  printLine();

  return failed.length > 0 ? 1 : 0;
}

async function runAoi(aoiArg: string | undefined, options: AoiCliOptions): Promise<number> {
  const format = resolveFormat(options);
  const dataToStdout = format !== "table" && !options.output;
  const interactive = isInteractiveRun(options, format);
  let aoiArgument = interactive ? aoiArg : stdinAoi(aoiArg, options);

  if (!dataToStdout) {
    printLine();
    printLine(renderBanner());
    printLine();
  }

  if (aoiArgument === undefined && options.bbox === undefined && options.wkt === undefined) {
    if (!interactive) throw new Error("Falta el área de interés: pasa un archivo, --bbox o --wkt.");
    aoiArgument = await promptAoiPath();
    printLine();
  }

  const aoi = await loadAoi(aoiInput(aoiArgument, options));
  const metrics = computeAoiMetrics(aoi);
  const document =
    format === "geojson" ? aoiToGeoJson(aoi, metrics) : format === "json" ? aoiToJson(aoi, metrics) : undefined;

  if (dataToStdout && document) {
    process.stdout.write(document);
    return 0;
  }

  printLine(renderAoiPanel(aoi, metrics));
  if (options.output && document) {
    const target = await writeOutput(options.output, document);
    printLine(`${theme.ok(icons.ok)} ${theme.muted(`Exportado (${format}) a`)} ${theme.bold(target)}`);
  }
  printLine();
  return metrics.valid ? 0 : 1;
}

function runCollections(options: { format?: OutputFormat }): number {
  if (options.format === "json") {
    process.stdout.write(`${JSON.stringify(COLLECTIONS, null, 2)}\n`);
    return 0;
  }
  printLine();
  printLine(renderBanner());
  printLine();
  printLine(renderCollectionsCatalog());
  printLine();
  return 0;
}

// ─── Program ────────────────────────────────────────────────────────────────

/** Commander only speaks English; these are the messages users actually hit. */
function translateCommanderError(message: string): string {
  return message
    .replace(/^option '([^']+)' argument '([^']*)' is invalid\.\s*/, (_match, flag: string) => `${flag.split(/[\s,]+/).find((part) => part.startsWith("--")) ?? flag}: `)
    .replace(/^option '([^']+)' argument missing/, "falta el valor de la opción '$1'")
    .replace(/^unknown option '([^']+)'/, "opción desconocida '$1'")
    .replace(/^unknown command '([^']+)'/, "comando desconocido '$1'")
    .replace(/^too many arguments.*/, "demasiados argumentos: indica un solo archivo de AOI")
    .replace(/\(Did you mean ([^?]+)\?\)/, "(¿quisiste decir $1?)");
}

function withAoiOptions(command: Command): Command {
  return command
    .argument("[aoi]", "Archivo con el área de interés (- para stdin)")
    .option("-b, --bbox <minx,miny,maxx,maxy>", "Rectángulo")
    .option("-w, --wkt <wkt>", "Geometría WKT o EWKT")
    .option("--crs <crs>", "CRS de las coordenadas de entrada");
}

function withOutputOptions(command: Command): Command {
  return command
    .option("-f, --format <formato>", "table | json | geojson", parseFormat)
    .option("-o, --output <archivo>", "Guarda el resultado en un archivo")
    .option("-y, --yes", "Sin preguntas")
    .option("--no-color", "Sin colores");
}

function finish(code: number): void {
  process.exitCode = code;
}

function buildProgram(): Command {
  const program = new Command();

  program
    .name("gx")
    .description("Descubre qué datos satelitales existen sobre un área de interés.")
    .helpOption("-h, --help", "Muestra la ayuda")
    .option("-v, --version", "Muestra la versión")
    .option("--no-color", "Sin colores")
    .showSuggestionAfterError(true);

  // Our own hand-drawn, colourized help screen replaces commander's default.
  // Configured before adding commands so every subcommand inherits it.
  program.configureHelp({ formatHelp: () => renderHelp() });
  program.configureOutput({
    writeErr: (text) =>
      process.stderr.write(
        text.startsWith("error:")
          ? `${theme.err(icons.fail)} ${theme.err(translateCommanderError(text.slice("error:".length).trim()))}\n`
          : text,
      ),
  });

  program.hook("preSubcommand", (thisCommand) => {
    if (thisCommand.opts<{ version?: boolean }>().version) {
      printLine(`${theme.brandBold("gx")} ${theme.accent(`v${VERSION}`)}`);
      process.exit(0);
    }
  });

  const scan = program
    .command("scan", { isDefault: true })
    .description("Describe el AOI y lista los datos disponibles");
  withAoiOptions(scan)
    .option("-c, --collections <lista>", "Colecciones separadas por comas", parseCollections)
    .option("--from <AAAA-MM-DD>", "Inicio del periodo", parseDate)
    .option("--to <AAAA-MM-DD>", "Fin del periodo", parseDate)
    .option("--days <n>", "Últimos n días", integerIn(1, 36_500, "--days"))
    .option("--max-cloud <0-100>", "Nubosidad máxima", integerIn(0, 100, "--max-cloud"))
    .option("--max-items <n>", "Máximo de escenas por colección", integerIn(1, 100_000, "--max-items"))
    .option("--timeout <s>", "Timeout por petición", integerIn(1, 600, "--timeout"))
    .option("-s, --scenes", "Lista las escenas")
    .option("--limit <n>", "Escenas listadas por colección", integerIn(1, 100_000, "--limit"));
  withOutputOptions(scan).action(async (aoi: string | undefined, options: ScanCliOptions) => {
    finish(await runScan(aoi, options));
  });

  const aoi = program.command("aoi").description("Solo métricas del área de interés");
  withOutputOptions(withAoiOptions(aoi)).action(async (file: string | undefined, options: AoiCliOptions) => {
    finish(await runAoi(file, options));
  });

  program
    .command("collections")
    .description("Colecciones soportadas")
    .option("-f, --format <formato>", "table | json", parseFormat)
    .option("--no-color", "Sin colores")
    .action((options: { format?: OutputFormat }) => {
      finish(runCollections(options));
    });

  return program;
}

async function main(): Promise<void> {
  installCursorGuard();
  await buildProgram().parseAsync(process.argv);
}

main().catch((error: unknown) => {
  printError(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
