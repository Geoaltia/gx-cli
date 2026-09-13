import path from "node:path";

import { discoverArea, toGeoJson } from "@geoaltia/gx-cli";

/**
 * Playground for the programmatic API. Edit `aoi.geojson` (or point `file` to
 * your own AOI) and run `pnpm sample` from the repo root.
 */
const today = new Date().toISOString().slice(0, 10);
const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

const report = await discoverArea(
  { file: path.join(import.meta.dirname, "aoi.geojson") },
  {
    collections: ["s2-l2a", "s1-grd"],
    from: monthAgo,
    to: today,
    maxCloud: 40,
    maxItems: 200,
    timeoutMs: 60_000,
  },
  {
    onCollectionDone: (summary) => {
      console.log(`${summary.alias}: ${summary.sceneCount} escenas`);
    },
  },
);

console.log("\nResumen:", {
  superficieHa: Math.round(report.aoi.metrics.areaM2 / 100) / 100,
  utm: report.aoi.metrics.utmZone.epsg,
  escenas: report.totals.scenes,
});

console.log(`\nGeoJSON: ${toGeoJson(report).length} bytes`);
