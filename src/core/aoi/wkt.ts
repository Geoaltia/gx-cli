import type { Geometry, Position } from "geojson";

export interface ParsedWkt {
  geometry: Geometry;
  /** `SRID=25830;POLYGON(...)` (EWKT) declares its CRS inline. */
  srid?: number;
}

/**
 * Minimal WKT/EWKT reader covering the 2D simple-feature types. Z/M ordinates
 * are accepted and dropped: an AOI only needs lon/lat.
 */
class WktReader {
  private position = 0;

  constructor(private readonly text: string) {}

  read(): Geometry {
    const geometry = this.geometry();
    this.skipSpace();
    if (this.position < this.text.length) {
      this.fail("texto inesperado tras la geometría");
    }
    return geometry;
  }

  private geometry(): Geometry {
    const type = this.word().toUpperCase();
    const dimension = this.peekWord().toUpperCase();
    if (dimension === "Z" || dimension === "M" || dimension === "ZM") this.word();

    if (this.peekWord().toUpperCase() === "EMPTY") {
      this.fail(`la geometría ${type} está vacía`);
    }

    switch (type) {
      case "POINT":
        return { type: "Point", coordinates: this.wrapped(() => this.coordinate()) };
      case "LINESTRING":
        return { type: "LineString", coordinates: this.coordinates() };
      case "POLYGON":
        return { type: "Polygon", coordinates: this.rings() };
      case "MULTIPOINT":
        return { type: "MultiPoint", coordinates: this.list(() => this.multiPointMember()) };
      case "MULTILINESTRING":
        return { type: "MultiLineString", coordinates: this.list(() => this.coordinates()) };
      case "MULTIPOLYGON":
        return { type: "MultiPolygon", coordinates: this.list(() => this.rings()) };
      case "GEOMETRYCOLLECTION":
        return { type: "GeometryCollection", geometries: this.list(() => this.geometry()) };
      default:
        return this.fail(`tipo de geometría "${type || "?"}" no soportado`);
    }
  }

  private multiPointMember(): Position {
    this.skipSpace();
    return this.text[this.position] === "(" ? this.wrapped(() => this.coordinate()) : this.coordinate();
  }

  private rings(): Position[][] {
    return this.list(() => this.coordinates());
  }

  private coordinates(): Position[] {
    return this.list(() => this.coordinate());
  }

  private coordinate(): Position {
    const values: number[] = [];
    this.skipSpace();
    while (this.position < this.text.length && /[-+\d.eE]/.test(this.text[this.position] ?? "")) {
      values.push(this.number());
      this.skipSpace();
    }
    if (values.length < 2) this.fail("se esperaban al menos dos ordenadas (x y)");
    return [values[0]!, values[1]!];
  }

  private number(): number {
    const match = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(this.text.slice(this.position));
    if (!match) return this.fail("se esperaba un número");
    this.position += match[0].length;
    return Number(match[0]);
  }

  private list<T>(item: () => T): T[] {
    return this.wrapped(() => {
      const items = [item()];
      while (this.consume(",")) items.push(item());
      return items;
    });
  }

  private wrapped<T>(inner: () => T): T {
    this.expect("(");
    const value = inner();
    this.expect(")");
    return value;
  }

  private word(): string {
    this.skipSpace();
    const match = /^[A-Za-z]+/.exec(this.text.slice(this.position));
    if (!match) return "";
    this.position += match[0].length;
    return match[0];
  }

  private peekWord(): string {
    const saved = this.position;
    const word = this.word();
    this.position = saved;
    return word;
  }

  private consume(char: string): boolean {
    this.skipSpace();
    if (this.text[this.position] !== char) return false;
    this.position += 1;
    return true;
  }

  private expect(char: string): void {
    if (!this.consume(char)) this.fail(`se esperaba "${char}"`);
  }

  private skipSpace(): void {
    while (/\s/.test(this.text[this.position] ?? "")) this.position += 1;
  }

  private fail(reason: string): never {
    throw new Error(`WKT inválido (posición ${this.position + 1}): ${reason}.`);
  }
}

/** Parses WKT or EWKT (`SRID=4326;POLYGON((...))`). */
export function parseWkt(text: string): ParsedWkt {
  const trimmed = text.trim();
  const ewkt = /^SRID=(\d+);/i.exec(trimmed);
  const body = ewkt ? trimmed.slice(ewkt[0].length) : trimmed;
  const geometry = new WktReader(body).read();
  return ewkt?.[1] ? { geometry, srid: Number(ewkt[1]) } : { geometry };
}
