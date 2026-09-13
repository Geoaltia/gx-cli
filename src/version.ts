// Replaced at build time by tsdown (`define` in tsdown.config.ts) so the CLI
// never has to read package.json from disk at runtime.
declare const __GX_VERSION__: string;

export const VERSION: string =
  typeof __GX_VERSION__ === "string" ? __GX_VERSION__ : "0.0.0-dev";
