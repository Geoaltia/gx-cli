import { visibleWidth } from "@/ui/format";
import { theme } from "@/ui/theme";

export type Align = "left" | "right" | "center";

export interface Column {
  /** Header text, printed as-is (already coloured or not). */
  header: string;
  /** Horizontal alignment for this column's cells. Defaults to `left`. */
  align?: Align;
}

const BORDER = {
  topLeft: "╭",
  topRight: "╮",
  bottomLeft: "╰",
  bottomRight: "╯",
  horizontal: "─",
  vertical: "│",
  topJoin: "┬",
  bottomJoin: "┴",
  leftJoin: "├",
  rightJoin: "┤",
  cross: "┼",
} as const;

/** Pads a possibly-coloured cell to `width` visible characters. */
function pad(text: string, width: number, align: Align): string {
  const missing = Math.max(0, width - visibleWidth(text));
  if (missing === 0) return text;

  if (align === "right") return " ".repeat(missing) + text;
  if (align === "center") {
    const left = Math.floor(missing / 2);
    return " ".repeat(left) + text + " ".repeat(missing - left);
  }
  return text + " ".repeat(missing);
}

function rule(widths: number[], left: string, join: string, right: string) {
  const segments = widths.map((width) =>
    BORDER.horizontal.repeat(width + 2),
  );
  return theme.muted(left + segments.join(join) + right);
}

/**
 * Renders a box-drawing table. Cells may contain ANSI colours: widths are
 * computed on the visible text, so alignment stays correct.
 */
export function renderTable(columns: Column[], rows: string[][]): string {
  const widths = columns.map((column, index) => {
    const cells = rows.map((row) => visibleWidth(row[index] ?? ""));
    return Math.max(visibleWidth(column.header), ...cells, 0);
  });

  const vertical = theme.muted(BORDER.vertical);

  const renderRow = (cells: string[]): string => {
    const body = widths
      .map((width, index) =>
        pad(cells[index] ?? "", width, columns[index]?.align ?? "left"),
      )
      .map((cell) => ` ${cell} `)
      .join(vertical);
    return vertical + body + vertical;
  };

  const lines = [
    rule(widths, BORDER.topLeft, BORDER.topJoin, BORDER.topRight),
    renderRow(columns.map((column) => theme.bold(column.header))),
    rule(widths, BORDER.leftJoin, BORDER.cross, BORDER.rightJoin),
    ...rows.map(renderRow),
    rule(widths, BORDER.bottomLeft, BORDER.bottomJoin, BORDER.bottomRight),
  ];

  return lines.join("\n");
}

/**
 * Renders a small titled panel — used for the run summary and the
 * configuration recap.
 */
export function renderPanel(title: string, lines: string[]): string {
  const width = Math.max(
    visibleWidth(title) + 2,
    ...lines.map((line) => visibleWidth(line)),
  );

  const top = theme.muted(
    `${BORDER.topLeft}${BORDER.horizontal} `,
  ) +
    title +
    theme.muted(
      ` ${BORDER.horizontal.repeat(Math.max(1, width - visibleWidth(title) - 1))}${BORDER.topRight}`,
    );

  const body = lines.map(
    (line) =>
      theme.muted(BORDER.vertical) +
      ` ${pad(line, width, "left")} ` +
      theme.muted(BORDER.vertical),
  );

  const bottom = theme.muted(
    BORDER.bottomLeft + BORDER.horizontal.repeat(width + 2) + BORDER.bottomRight,
  );

  return [top, ...body, bottom].join("\n");
}
