import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsdown";

const require = createRequire(import.meta.url);
const pkg = require("./package.json") as { version: string };

export default defineConfig({
  entry: ["src/index.ts", "src/cli.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  define: {
    __GX_VERSION__: JSON.stringify(pkg.version),
  },
  alias: {
    "@": fileURLToPath(new URL("src", import.meta.url)),
  },
});
