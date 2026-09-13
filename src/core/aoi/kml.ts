import { kml } from "@tmcw/togeojson";
import { DOMParser } from "@xmldom/xmldom";
import { strFromU8, unzipSync } from "fflate";
import type { FeatureCollection, Geometry } from "geojson";

/** Converts KML text to GeoJSON (KML is always WGS 84 lon/lat). */
export function parseKml(text: string): FeatureCollection<Geometry | null> {
  let document;
  try {
    document = new DOMParser().parseFromString(text, "text/xml");
  } catch (error) {
    throw new Error(
      `KML inválido: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return kml(document);
}

/** Extracts the main KML document of a KMZ archive (`doc.kml`, or the first `.kml`). */
export function extractKmz(data: Uint8Array): string {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data, {
      filter: (file) => file.name.toLowerCase().endsWith(".kml"),
    });
  } catch {
    throw new Error("El archivo KMZ no es un ZIP válido.");
  }

  const names = Object.keys(entries);
  const main =
    names.find((name) => name.toLowerCase() === "doc.kml") ??
    names.sort((a, b) => a.split("/").length - b.split("/").length)[0];

  if (!main || !entries[main]) {
    throw new Error("El KMZ no contiene ningún documento .kml.");
  }
  return strFromU8(entries[main]);
}
