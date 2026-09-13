import { truncateStart, visibleWidth } from "@/ui/format";
import { isInteractive, theme } from "@/ui/theme";

const ESC = String.fromCharCode(27);
const CLEAR_LINE = `\r${ESC}[2K`;
const HIDE_CURSOR = `${ESC}[?25l`;
const SHOW_CURSOR = `${ESC}[?25h`;

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/**
 * An indeterminate spinner for work whose size is unknown in advance, like
 * paginating a catalogue. Draws on stderr so stdout stays clean for data.
 */
export class Spinner {
  private readonly interactive: boolean;
  private label = "";
  private frame = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  private painted = false;

  constructor() {
    this.interactive = isInteractive() && process.stderr.isTTY === true;
  }

  start(label: string): void {
    this.label = label;
    if (!this.interactive) return;
    process.stderr.write(HIDE_CURSOR);
    this.timer = setInterval(() => {
      this.frame = (this.frame + 1) % SPINNER_FRAMES.length;
      this.paint();
    }, 80);
    this.timer.unref?.();
    this.paint();
  }

  setLabel(label: string): void {
    this.label = label;
    this.paint();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (!this.interactive) return;
    if (this.painted) process.stderr.write(CLEAR_LINE);
    this.painted = false;
    process.stderr.write(SHOW_CURSOR);
  }

  private paint(): void {
    if (!this.interactive || this.timer === undefined) return;
    const spinner = theme.brand(SPINNER_FRAMES[this.frame] ?? "");
    const columns = process.stderr.columns || 80;
    const room = Math.max(8, columns - 6);
    const label = visibleWidth(this.label) > room ? truncateStart(this.label, room) : this.label;
    process.stderr.write(`${CLEAR_LINE}  ${spinner} ${label}`);
    this.painted = true;
  }
}

/** Restores the cursor if the process dies while a bar is on screen. */
export function installCursorGuard(): void {
  const restore = (): void => {
    if (process.stdout.isTTY) process.stdout.write(SHOW_CURSOR);
    if (process.stderr.isTTY) process.stderr.write(SHOW_CURSOR);
  };
  process.on("exit", restore);
  process.on("SIGINT", () => {
    restore();
    process.exit(130);
  });
}
