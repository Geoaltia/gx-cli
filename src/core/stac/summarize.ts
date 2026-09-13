import type { CollectionInfo } from "@/core/stac/collections";
import type {
  BandSummary,
  CollectionSummary,
  NumericRange,
  SceneSummary,
} from "@/types";

/** Scenes at or above this share of the AOI count as full coverage. */
export const FULL_COVERAGE = 0.99;

function range(values: Array<number | undefined>): NumericRange | undefined {
  const present = values.filter((value): value is number => value !== undefined);
  if (present.length === 0) return undefined;
  const total = present.reduce((sum, value) => sum + value, 0);
  return {
    min: Math.min(...present),
    max: Math.max(...present),
    mean: total / present.length,
  };
}

function distinct<T extends string | number>(values: Array<T | undefined>): T[] {
  const unique = [...new Set(values.filter((value): value is T => value !== undefined))];
  return unique.sort((a, b) =>
    typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a).localeCompare(String(b), "en", { numeric: true }),
  );
}

export interface SummarizeInput {
  info: CollectionInfo;
  scenes: SceneSummary[];
  bands: BandSummary[];
  truncated: boolean;
  durationMs: number;
  error?: string;
}

/** Aggregates the scenes of one collection into the numbers shown in the report. */
export function summarizeCollection(input: SummarizeInput): CollectionSummary {
  const scenes = [...input.scenes].sort((a, b) => b.datetime.localeCompare(a.datetime));
  const dates = distinct(scenes.map((scene) => scene.datetime.slice(0, 10) || undefined));

  const cloudCover = range(scenes.map((scene) => scene.cloudCover));
  const aoiCoverage = range(scenes.map((scene) => scene.aoiCoverage));

  return {
    collection: input.info.id,
    alias: input.info.alias,
    title: input.info.title,
    mission: input.info.mission,
    sceneCount: scenes.length,
    truncated: input.truncated,
    ...(dates.length > 0 ? { firstDate: dates[0], lastDate: dates.at(-1) } : {}),
    acquisitionDates: dates,
    ...(cloudCover ? { cloudCover } : {}),
    ...(aoiCoverage ? { aoiCoverage } : {}),
    fullCoverageScenes: scenes.filter((scene) => (scene.aoiCoverage ?? 0) >= FULL_COVERAGE).length,
    platforms: distinct(scenes.map((scene) => scene.platform)),
    tiles: distinct(scenes.map((scene) => scene.tile)),
    relativeOrbits: distinct(scenes.map((scene) => scene.relativeOrbit)),
    orbitStates: distinct(scenes.map((scene) => scene.orbitState)),
    instrumentModes: distinct(scenes.map((scene) => scene.instrumentMode)),
    polarizations: distinct(scenes.flatMap((scene) => scene.polarizations ?? [])),
    productTypes: distinct(scenes.map((scene) => scene.productType)),
    processingVersions: distinct(scenes.map((scene) => scene.processingVersion)),
    crs: distinct(scenes.map((scene) => scene.crs)),
    bands: input.bands,
    scenes,
    durationMs: input.durationMs,
    ...(input.error ? { error: input.error } : {}),
  };
}
