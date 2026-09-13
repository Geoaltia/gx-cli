import colors from "picocolors";

// Colour support is resolved once, here, instead of relying on import order:
// picocolors reads NO_COLOR at import time, and `--no-color` must win too.
const enabled =
  colors.isColorSupported && !process.argv.includes("--no-color");
const pc = colors.createColors(enabled);

/**
 * Central palette. Everything the CLI prints goes through here so the whole
 * output keeps a single, coherent colour language.
 */
export const theme = {
  /** Brand accent: banner, headings, primary highlights. */
  brand: pc.cyan,
  brandBold: (text: string) => pc.bold(pc.cyan(text)),
  /** Secondary accent: values the user chose (dates, collections, limits…). */
  accent: pc.magenta,
  /** Success, data found, "done". */
  ok: pc.green,
  /** Warnings, truncated results, "careful". */
  warn: pc.yellow,
  /** Errors and collections that failed. */
  err: pc.red,
  /** Structural chrome: borders, hints, units. */
  muted: pc.gray,
  dim: pc.dim,
  bold: pc.bold,
  /** Flags, commands and anything the user is meant to type. */
  code: (text: string) => pc.bold(pc.cyan(text)),
  label: (text: string) => pc.dim(text),
} as const;

/** One signature colour per collection, reused everywhere. */
const COLLECTION_COLORS: Record<string, (text: string) => string> = {
  "s2-l2a": pc.green,
  "sentinel-2-l2a": pc.green,
  "s2-l1c": pc.yellow,
  "sentinel-2-l1c": pc.yellow,
  "s1-grd": pc.blue,
  "sentinel-1-grd": pc.blue,
};

/** Colours a collection alias or id with its signature colour. */
export function colorCollection(name: string, label = name): string {
  const paint = COLLECTION_COLORS[name.toLowerCase()] ?? pc.white;
  return paint(label);
}

/** Green for clear skies, yellow for partly cloudy, red for overcast. */
export function colorCloud(percent: number, text: string): string {
  if (percent <= 10) return pc.green(text);
  if (percent <= 40) return pc.yellow(text);
  return pc.red(text);
}

/** Green when a scene covers the whole AOI, yellow when most, red otherwise. */
export function colorCoverage(ratio: number, text: string): string {
  if (ratio >= 0.99) return pc.green(text);
  if (ratio >= 0.5) return pc.yellow(text);
  return pc.red(text);
}

/** Icons used across the output. Kept in one place to stay consistent. */
export const icons = {
  arrow: "→",
  bullet: "•",
  ok: "✔",
  fail: "✖",
  skip: "◦",
  warn: "!",
  info: "ℹ",
  spark: "✦",
  globe: "◍",
  satellite: "⌖",
  times: "×",
} as const;

/** Whether we can draw animations (progress bar, spinner). */
export const isInteractive = (): boolean =>
  process.stdout.isTTY === true && process.env["CI"] === undefined;
