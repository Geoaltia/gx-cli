// shpjs ships no type declarations; this covers the small surface we use.
declare module "shpjs" {
  import type { FeatureCollection } from "geojson";

  type BufferLike = ArrayBuffer | ArrayBufferView;

  interface ShapefileParts {
    shp: BufferLike;
    dbf?: BufferLike;
    prj?: string | BufferLike;
    cpg?: string | BufferLike;
  }

  export function getShapefile(
    input: BufferLike | ShapefileParts,
  ): Promise<FeatureCollection | FeatureCollection[]>;

  export default getShapefile;
}
