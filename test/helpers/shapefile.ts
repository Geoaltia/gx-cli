/**
 * Writes a tiny polygon Shapefile in memory so tests do not need GDAL or
 * binary fixtures checked into the repo.
 */
export function writePolygonShp(rings: Array<Array<[number, number]>>): Uint8Array {
  const points = rings.flat();
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];

  const contentBytes = 4 + 32 + 4 + 4 + 4 * rings.length + 16 * points.length;
  const total = 100 + 8 + contentBytes;
  const view = new DataView(new ArrayBuffer(total));

  view.setInt32(0, 9994, false);
  view.setInt32(24, total / 2, false);
  view.setInt32(28, 1000, true);
  view.setInt32(32, 5, true);
  bbox.forEach((value, index) => view.setFloat64(36 + index * 8, value, true));

  let offset = 100;
  view.setInt32(offset, 1, false);
  view.setInt32(offset + 4, contentBytes / 2, false);
  offset += 8;

  view.setInt32(offset, 5, true);
  bbox.forEach((value, index) => view.setFloat64(offset + 4 + index * 8, value, true));
  view.setInt32(offset + 36, rings.length, true);
  view.setInt32(offset + 40, points.length, true);
  offset += 44;

  let start = 0;
  for (const ring of rings) {
    view.setInt32(offset, start, true);
    offset += 4;
    start += ring.length;
  }
  for (const [x, y] of points) {
    view.setFloat64(offset, x, true);
    view.setFloat64(offset + 8, y, true);
    offset += 16;
  }

  return new Uint8Array(view.buffer);
}

export const PRJ_ETRS89_UTM30N =
  'PROJCS["ETRS89 / UTM zone 30N",GEOGCS["ETRS89",DATUM["European_Terrestrial_Reference_System_1989",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-3],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",0],UNIT["metre",1],AUTHORITY["EPSG","25830"]]';

/** A 2 km × 2 km square in central Madrid, ETRS89 / UTM 30N, clockwise. */
export const MADRID_SQUARE_UTM: Array<[number, number]> = [
  [439000, 4473000],
  [439000, 4475000],
  [441000, 4475000],
  [441000, 4473000],
  [439000, 4473000],
];
