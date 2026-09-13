import type { CollectionAlias } from "@/types";

export interface CollectionInfo {
  alias: CollectionAlias;
  /** Collection id in the STAC catalogue. */
  id: string;
  title: string;
  mission: "Sentinel-1" | "Sentinel-2";
  kind: "optical" | "sar";
  level: string;
  /** Whether `eo:cloud_cover` exists and `--max-cloud` applies. */
  cloudFilter: boolean;
  description: string;
  /** Short band overview for offline listings. */
  bandsHint: string;
  resolution: string;
  revisit: string;
}

export const COLLECTIONS: readonly CollectionInfo[] = [
  {
    alias: "s2-l2a",
    id: "sentinel-2-l2a",
    title: "Sentinel-2 L2A",
    mission: "Sentinel-2",
    kind: "optical",
    level: "L2A",
    cloudFilter: true,
    description: "Reflectancia de superficie (BOA) corregida atmosféricamente, con clasificación de escena.",
    bandsHint: "B01–B12, B8A · SCL, CLD, SNW, AOT, WVP · TCI",
    resolution: "10 / 20 / 60 m",
    revisit: "≈5 días",
  },
  {
    alias: "s2-l1c",
    id: "sentinel-2-l1c",
    title: "Sentinel-2 L1C",
    mission: "Sentinel-2",
    kind: "optical",
    level: "L1C",
    cloudFilter: true,
    description: "Reflectancia en el techo de la atmósfera (TOA), ortorrectificada.",
    bandsHint: "B01–B12, B8A · TCI",
    resolution: "10 / 20 / 60 m",
    revisit: "≈5 días",
  },
  {
    alias: "s1-grd",
    id: "sentinel-1-grd",
    title: "Sentinel-1 GRD",
    mission: "Sentinel-1",
    kind: "sar",
    level: "L1 GRD",
    cloudFilter: false,
    description: "Radar de apertura sintética banda C, Ground Range Detected. Independiente de nubes y luz.",
    bandsHint: "VV, VH, HH, HV (según modo)",
    resolution: "10 m (IW)",
    revisit: "≈6–12 días",
  },
];

export const COLLECTION_ALIASES = COLLECTIONS.map((collection) => collection.alias);

export const DEFAULT_COLLECTIONS: CollectionAlias[] = ["s2-l2a", "s1-grd"];

/** Accepts an alias (`s2-l2a`) or a catalogue id (`sentinel-2-l2a`), case-insensitive. */
export function findCollection(value: string): CollectionInfo | undefined {
  const needle = value.trim().toLowerCase();
  return COLLECTIONS.find(
    (collection) => collection.alias === needle || collection.id === needle,
  );
}

export function getCollection(alias: CollectionAlias): CollectionInfo {
  const found = findCollection(alias);
  if (!found) throw new Error(`Colección desconocida: ${alias}`);
  return found;
}

/** Parses `s2-l2a,s1-grd` into aliases, failing on unknown names. */
export function parseCollectionList(value: string): CollectionAlias[] {
  const names = value
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0) {
    throw new Error("Indica al menos una colección.");
  }
  const aliases = names.map((name) => {
    const found = findCollection(name);
    if (!found) {
      throw new Error(
        `colección desconocida "${name}". Disponibles: ${COLLECTION_ALIASES.join(", ")}.`,
      );
    }
    return found.alias;
  });
  return [...new Set(aliases)];
}
