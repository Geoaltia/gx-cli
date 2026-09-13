// Built from a char code so the source file stays free of raw control chars.
const ESC = String.fromCharCode(27);
const ANSI_PATTERN = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

/** Length of a string as the terminal renders it, ignoring colour codes. */
export function visibleWidth(text: string): number {
  return text.replace(ANSI_PATTERN, "").length;
}

/** Removes every colour code from a string. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

/**
 * Shortens a plain (uncoloured) string to `max` characters, keeping the tail
 * visible — file names are far easier to recognise by their ending.
 */
export function truncateStart(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(-max);
  return `…${text.slice(-(max - 1))}`;
}

/** Shortens a plain string keeping its beginning. */
export function truncateEnd(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, max);
  return `${text.slice(0, max - 1)}…`;
}

const numberFormats = new Map<number, Intl.NumberFormat>();

/** Spanish number formatting (`1234.5` → `1234,5`, `12345.6` → `12.345,6`). */
export function formatNumber(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return "—";
  let format = numberFormats.get(decimals);
  if (!format) {
    format = new Intl.NumberFormat("es-ES", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    numberFormats.set(decimals, format);
  }
  return format.format(value);
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** `1536` becomes `1,5 KB`. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return "—";
  const sign = bytes < 0 ? "-" : "";
  let value = Math.abs(bytes);
  let unit = 0;

  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const decimals = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${sign}${formatNumber(value, decimals)} ${BYTE_UNITS[unit]}`;
}

/** `2450` becomes `2.4s`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/** `0.624` becomes `62,4 %`. */
export function formatRatio(ratio: number, decimals = 1): string {
  if (!Number.isFinite(ratio)) return "—";
  return `${formatNumber(ratio * 100, decimals)} %`;
}

/** Area with the unit that reads best: m², ha or km². */
export function formatArea(m2: number): string {
  if (!Number.isFinite(m2)) return "—";
  if (m2 < 10_000) return `${formatNumber(m2, 1)} m²`;
  if (m2 < 1_000_000) return `${formatNumber(m2 / 10_000, 2)} ha`;
  return `${formatNumber(m2 / 1_000_000, 2)} km²`;
}

/** Length in m or km. */
export function formatLength(m: number): string {
  if (!Number.isFinite(m)) return "—";
  if (m < 1000) return `${formatNumber(m, 1)} m`;
  return `${formatNumber(m / 1000, 2)} km`;
}

/** `2026-08-30T10:56:21.025Z` → `2026-08-30`. */
export function formatDate(iso: string | undefined): string {
  return iso ? iso.slice(0, 10) : "—";
}

/** `2026-08-30T10:56:21.025Z` → `2026-08-30 10:56 UTC`. */
export function formatDateTime(iso: string): string {
  if (iso.length < 16) return iso || "—";
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** Decimal degrees with a fixed precision (6 decimals ≈ 0.1 m). */
export function formatCoordinate(value: number, decimals = 6): string {
  return Number.isFinite(value) ? value.toFixed(decimals) : "—";
}

/** Whole days between two `YYYY-MM-DD` dates, both inclusive. */
export function daysInclusive(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000) + 1;
}
