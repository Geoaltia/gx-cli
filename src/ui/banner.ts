import { visibleWidth } from "@/ui/format";
import { icons, theme } from "@/ui/theme";
import { VERSION } from "@/version";

export const TAGLINE = "descubrimiento de datos satelitales por área de interés";

/**
 * The wordmark printed at the top of every run. Deliberately compact so it
 * still looks right in a narrow terminal.
 */
export function renderBanner(): string {
  const title = `${theme.accent(icons.globe)} ${theme.brandBold("gx")}`;
  const tagline = theme.muted(TAGLINE);
  const version = theme.dim(`v${VERSION}`);

  const content = `${title}  ${theme.muted("·")}  ${tagline}  ${version}`;
  const width = visibleWidth(content);

  return [
    theme.muted(`╭${"─".repeat(width + 2)}╮`),
    `${theme.muted("│")} ${content} ${theme.muted("│")}`,
    theme.muted(`╰${"─".repeat(width + 2)}╯`),
  ].join("\n");
}
