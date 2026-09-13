import { loadAoi, type LoadAoiInput } from "@/core/aoi/load";
import { discoverAoi, validateSearchOptions, type DiscoverOptions } from "@/core/discover";
import type { Aoi, DiscoveryHooks, DiscoveryReport } from "@/types";

/**
 * Describes an AOI and lists the satellite data available over it. Accepts an
 * already loaded AOI or anything `loadAoi` reads. Node only: use `parseAoi` +
 * `discoverAoi` in browsers.
 */
export async function discoverArea(
  aoiOrInput: Aoi | LoadAoiInput,
  options: DiscoverOptions,
  hooks: DiscoveryHooks = {},
): Promise<DiscoveryReport> {
  // Fail on bad search parameters before spending time reading the AOI.
  validateSearchOptions(options);
  const aoi = "geometry" in aoiOrInput ? aoiOrInput : await loadAoi(aoiOrInput);
  return discoverAoi(aoi, options, hooks);
}
