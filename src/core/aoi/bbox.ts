import type { Polygon, Position } from "geojson";

import type { BBox } from "@/types";

/** Parses `minx,miny,maxx,maxy` (commas and/or spaces). */
export function parseBBox(text: string): BBox {
  const parts = text
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number);

  if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
    throw new Error(`BBox inválido "${text}": usa minx,miny,maxx,maxy (p. ej. -3.8,40.35,-3.6,40.5).`);
  }

  const [minX, minY, maxX, maxY] = parts as BBox;
  if (minX >= maxX || minY >= maxY) {
    throw new Error("BBox inválido: minx debe ser menor que maxx y miny menor que maxy.");
  }
  return [minX, minY, maxX, maxY];
}

/**
 * Rectangle polygon for a bbox. Edges are densified so it stays a faithful
 * shape once reprojected from a projected CRS.
 */
export function bboxToPolygon([minX, minY, maxX, maxY]: BBox, segments = 1): Polygon {
  const edge = (from: Position, to: Position): Position[] =>
    Array.from({ length: segments }, (_, index) => {
      const t = index / segments;
      return [from[0]! + (to[0]! - from[0]!) * t, from[1]! + (to[1]! - from[1]!) * t];
    });

  const corners: Position[] = [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
  const ring = corners.flatMap((corner, index) => edge(corner, corners[(index + 1) % 4]!));
  ring.push([minX, minY]);
  return { type: "Polygon", coordinates: [ring] };
}
