import { cancel, confirm, isCancel, multiselect, select, text } from "@clack/prompts";

import { COLLECTIONS } from "@/core/stac/collections";
import type { CollectionAlias } from "@/types";
import { theme } from "@/ui/theme";

/** What the guided mode is allowed to fill in. */
export interface PromptableOptions {
  aoi?: string;
  collections: CollectionAlias[];
  from: string;
  to: string;
  maxCloud?: number;
}

/** Aborts the process cleanly when the user hits Ctrl+C in a prompt. */
function ensure<T>(value: T | symbol): T {
  if (isCancel(value)) {
    cancel(theme.muted("Cancelado — no se consultó nada."));
    process.exit(130);
  }
  return value;
}

/** `YYYY-MM-DD` of today minus `days`, in UTC. */
export function isoDaysAgo(days: number, from = new Date()): string {
  const date = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

const validDate = (value: string | undefined): string | undefined =>
  value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) && !Number.isNaN(Date.parse(value.trim()))
    ? undefined
    : "Usa el formato AAAA-MM-DD";

/** Asks for the AOI file when none was given. */
export async function promptAoiPath(): Promise<string> {
  return ensure(
    await text({
      message: "Archivo del área de interés",
      placeholder: "parcela.geojson · finca.kmz · lotes.zip",
      validate: (value) =>
        value === undefined || value.trim() === "" ? "Indica la ruta de un archivo" : undefined,
    }),
  ).trim();
}

export interface ProvidedOptions {
  aoi?: boolean;
  collections?: boolean;
  period?: boolean;
  maxCloud?: boolean;
}

/**
 * Guided setup. Only asks about what the user did not already pass as a flag,
 * so `gx zona.geojson -c s1-grd` just asks for the period.
 */
export async function runPrompts(
  provided: ProvidedOptions,
  current: PromptableOptions,
): Promise<PromptableOptions> {
  const result: PromptableOptions = { ...current };

  if (!provided.aoi) {
    result.aoi = await promptAoiPath();
  }

  if (!provided.collections) {
    result.collections = ensure(
      await multiselect<CollectionAlias>({
        message: "Colecciones a consultar",
        initialValues: current.collections,
        required: true,
        options: COLLECTIONS.map((collection) => ({
          value: collection.alias,
          label: collection.title,
          hint: `${collection.kind === "optical" ? "óptico" : "radar"} · ${collection.resolution}`,
        })),
      }),
    );
  }

  if (!provided.period) {
    const period = ensure(
      await select<number | "custom">({
        message: "Periodo",
        initialValue: 90,
        options: [
          { value: 30, label: "Últimos 30 días" },
          { value: 90, label: "Últimos 90 días", hint: "recomendado" },
          { value: 180, label: "Últimos 6 meses" },
          { value: 365, label: "Último año" },
          { value: "custom", label: "Fechas concretas" },
        ],
      }),
    );

    if (period === "custom") {
      result.from = ensure(
        await text({ message: "Desde (AAAA-MM-DD)", initialValue: current.from, validate: validDate }),
      ).trim();
      result.to = ensure(
        await text({ message: "Hasta (AAAA-MM-DD)", initialValue: current.to, validate: validDate }),
      ).trim();
    } else {
      result.to = isoDaysAgo(0);
      result.from = isoDaysAgo(period - 1);
    }
  }

  const hasOptical = result.collections.some(
    (alias) => COLLECTIONS.find((collection) => collection.alias === alias)?.cloudFilter,
  );
  if (!provided.maxCloud && hasOptical) {
    const cloud = ensure(
      await select<number | "none">({
        message: "Nubosidad máxima (colecciones ópticas)",
        initialValue: "none",
        options: [
          { value: "none", label: "Sin límite", hint: "ver todo lo que hay" },
          { value: 10, label: "≤ 10 %", hint: "cielos despejados" },
          { value: 30, label: "≤ 30 %" },
          { value: 60, label: "≤ 60 %" },
        ],
      }),
    );
    if (cloud === "none") delete result.maxCloud;
    else result.maxCloud = cloud;
  }

  return result;
}

/** Final go/no-go before querying the catalogue. */
export async function confirmRun(): Promise<boolean> {
  return ensure(
    await confirm({ message: "¿Consultar el catálogo ahora?", initialValue: true }),
  );
}
