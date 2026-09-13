// Replaced at build time by tsdown (`define` in tsdown.config.ts) so the CLI
// never has to read package.json from disk at runtime.
declare const __GEOALTIA_VERSION__: string;

export const VERSION: string =
  typeof __GEOALTIA_VERSION__ === "string" ? __GEOALTIA_VERSION__ : "0.0.0-dev";
