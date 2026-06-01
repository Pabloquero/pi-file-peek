import * as fs from "node:fs";
import * as path from "node:path";
import { matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { formatKeyLabel } from "./helpers.js";
import type { PeekEnvelope } from "./types.js";
import type { HighlightService } from "./highlight.js";
import type { PeekSettings } from "./types.js";

let nextOverlayId = 1;
const overlayClosers = new Map<number, () => void>();
const OVERLAY_COMMAND_SPACE_ROWS = 4;
const OVERLAY_VERTICAL_MARGIN_ROWS = 4;
const OVERLAY_TOP_MARGIN_ROWS = Math.floor(OVERLAY_VERTICAL_MARGIN_ROWS / 2);
const OVERLAY_BOTTOM_MARGIN_ROWS = OVERLAY_COMMAND_SPACE_ROWS + Math.ceil(OVERLAY_VERTICAL_MARGIN_ROWS / 2);
const OVERLAY_SIDE_MARGIN_COLS = 1;

function getOverlayRenderHeight(termRows: number | undefined): number {
  const terminalRows = Math.max(12, termRows ?? 32);
  const usableRows = Math.max(1, terminalRows - OVERLAY_COMMAND_SPACE_ROWS);
  return Math.max(8, usableRows - OVERLAY_VERTICAL_MARGIN_ROWS);
}

function displayNameForPath(filePath: string | undefined): string | undefined {
  if (!filePath) return undefined;
  try { return path.basename(filePath); } catch { return filePath; }
}

class ScrollOverlay {
  private offset = 0;
  private lastUsableHeight = 10;
  private lastMaxOffset = 0;
  private readonly framePad = 2;
  private readonly textPadX = 2;
  private readonly textPadY = 1;
  constructor(private readonly rawLines: string[], private readonly theme: any, private readonly settings: PeekSettings, private readonly subtitle?: string, private readonly fileName?: string) {}
  handleInput(data: string, closeSelf: () => void, closeAll: () => void): void {
    if (this.settings.keys.close.some((key) => matchesKey(data, key as any))) return this.settings.closeAll ? closeAll() : closeSelf();
    const pageStep = Math.max(1, this.lastUsableHeight - 1);
    if (this.settings.keys.pageUp.some((key) => matchesKey(data, key as any))) this.offset = Math.max(0, this.offset - pageStep);
    if (this.settings.keys.pageDown.some((key) => matchesKey(data, key as any))) this.offset = Math.min(this.lastMaxOffset, this.offset + pageStep);
    if (this.settings.keys.scrollUp.some((key) => matchesKey(data, key as any))) this.offset = Math.max(0, this.offset - 1);
    if (this.settings.keys.scrollDown.some((key) => matchesKey(data, key as any))) this.offset = Math.min(this.lastMaxOffset, this.offset + 1);
  }
  render(width: number, height: number): string[] {
    const outerInnerWidth = Math.max(24, width - 2);
    const textBlockWidth = Math.max(12, outerInnerWidth - this.framePad * 2);
    const textContentWidth = Math.max(8, textBlockWidth - this.textPadX * 2);
    const wrapped = this.rawLines.flatMap((line) => wrapTextWithAnsi(line, textContentWidth));
    const chromeLines = (this.settings.showHeader ? 8 : 4) + (this.settings.showFooter ? 2 : 0);
    const maxUsableHeight = Math.max(3, height - chromeLines);
    const usableHeight = Math.max(1, Math.min(Math.max(wrapped.length, 1), maxUsableHeight));
    const maxOffset = Math.max(0, wrapped.length - usableHeight);
    this.lastUsableHeight = usableHeight;
    this.lastMaxOffset = maxOffset;
    if (this.offset > maxOffset) this.offset = maxOffset;
    const visible = wrapped.slice(this.offset, this.offset + usableHeight);
    const frameColor = "accent";
    const blankOuterRow = this.theme.fg(frameColor, "│") + " ".repeat(outerInnerWidth) + this.theme.fg(frameColor, "│");
    const centeredOuter = (text: string) => {
      const plain = visibleWidth(text);
      const left = Math.max(0, Math.floor((outerInnerWidth - plain) / 2));
      const right = Math.max(0, outerInnerWidth - plain - left);
      return this.theme.fg(frameColor, "│") + " ".repeat(left) + text + " ".repeat(right) + this.theme.fg(frameColor, "│");
    };
    const textBlockRow = (content = "") => {
      const leftOuter = " ".repeat(this.framePad);
      const rightOuter = " ".repeat(outerInnerWidth - this.framePad - textBlockWidth);
      const innerPadding = Math.max(0, textContentWidth - visibleWidth(content));
      const textBlock = this.theme.bg("userMessageBg", " ".repeat(this.textPadX) + content + " ".repeat(innerPadding + this.textPadX));
      return this.theme.fg(frameColor, "│") + leftOuter + textBlock + rightOuter + this.theme.fg(frameColor, "│");
    };
    const lines = [this.theme.fg(frameColor, `┌${"─".repeat(outerInnerWidth)}┐`)];
    const headerText = this.fileName ?? "";
    if (this.settings.showHeader) {
      lines.push(blankOuterRow);
      if (headerText) lines.push(centeredOuter(this.theme.fg("accent", this.theme.bold(headerText))));
      if (this.subtitle) lines.push(centeredOuter(this.theme.fg("dim", this.subtitle)));
      lines.push(blankOuterRow);
    }
    lines.push(textBlockRow());
    for (let i = 0; i < usableHeight; i++) lines.push(textBlockRow(visible[i] ?? ""));
    lines.push(textBlockRow());
    const firstVisibleLine = wrapped.length === 0 ? 0 : this.offset + 1;
    const lastVisibleLine = wrapped.length === 0 ? 0 : Math.min(this.offset + usableHeight, wrapped.length);
    const lineInfo = `${firstVisibleLine}-${lastVisibleLine}/${wrapped.length}`;
    lines.push(centeredOuter(this.theme.fg("dim", truncateToWidth(lineInfo, outerInnerWidth))));
    if (this.settings.showFooter) {
      const keys = [
        this.describePairKeys(this.settings.keys.scrollUp, this.settings.keys.scrollDown),
        this.describePairKeys(this.settings.keys.pageUp, this.settings.keys.pageDown),
        this.describeKeys(this.settings.keys.close),
      ];
      const labels = ["Scroll", "Pages", "Close"];
      const widths = keys.map((key, index) => Math.max(visibleWidth(key), visibleWidth(labels[index]!)));
      const keysRow = this.columnsRow(keys, widths);
      const labelsRow = this.columnsRow(labels, widths);
      lines.push(centeredOuter(this.theme.fg("dim", truncateToWidth(keysRow, outerInnerWidth))));
      lines.push(centeredOuter(this.theme.fg("dim", truncateToWidth(labelsRow, outerInnerWidth))));
    }
    lines.push(this.theme.fg(frameColor, `└${"─".repeat(outerInnerWidth)}┘`));
    return lines;
  }

  private describeKeys(first: string[], second?: string[]): string {
    if (!second || second.length === 0) return first.map(formatKeyLabel).join("/");
    return `${first.map(formatKeyLabel).join("/")}/${second.map(formatKeyLabel).join("/")}`;
  }

  private describePairKeys(first: string[], second: string[]): string {
    if (first.length === 1 && second.length === 1) {
      const left = first[0]!;
      const right = second[0]!;
      const leftParts = left.split("+");
      const rightParts = right.split("+");
      if (leftParts.length === rightParts.length && leftParts.length > 1 && leftParts.slice(0, -1).join("+") === rightParts.slice(0, -1).join("+")) {
        const shared = leftParts.slice(0, -1).map(formatKeyLabel).join("+");
        const last = `${formatKeyLabel(leftParts[leftParts.length - 1]!)} / ${formatKeyLabel(rightParts[rightParts.length - 1]!)}`.replace(/\s+/g, "");
        return `${shared}+${last}`;
      }
    }
    return this.describeKeys(first, second);
  }

  private columnsRow(items: string[], widths: number[]): string {
    return items.map((item, index) => this.centerText(item, widths[index]!)).join("   ");
  }

  private centerText(text: string, width: number): string {
    const w = visibleWidth(text);
    const left = Math.max(0, Math.floor((width - w) / 2));
    const right = Math.max(0, width - w - left);
    return `${" ".repeat(left)}${text}${" ".repeat(right)}`;
  }
}

export function openOverlay(currentCtx: any, msg: PeekEnvelope, highlight: HighlightService, settings: PeekSettings, onClose?: () => void) {
  if (!currentCtx?.hasUI) return;
  void currentCtx.ui.custom((_tui: any, theme: any, _kb: any, done: (value: void) => void) => {
    const overlayId = nextOverlayId++;
    let lines: string[];
    let subtitle: string | undefined;
    let fileName: string | undefined;
    if (msg.kind === "file-ref" && msg.path) {
      try {
        const rendered = highlight.render(fs.readFileSync(msg.path, "utf8"), msg.path, theme);
        lines = rendered.lines;
        subtitle = rendered.highlighted ? undefined : "Plain text fallback";
        fileName = displayNameForPath(msg.path);
      } catch (error) {
        lines = ["[Could not open file]", error instanceof Error ? error.message : String(error)];
        subtitle = "Missing file";
        fileName = displayNameForPath(msg.path);
      }
    } else {
      lines = (msg.message ?? "").split(/\r?\n/);
    }
    const overlay = new ScrollOverlay(lines, theme, settings, subtitle, fileName);
    let closed = false;
    const closeSelf = () => {
      if (closed) return;
      closed = true;
      overlayClosers.delete(overlayId);
      onClose?.();
      done();
    };
    const closeAll = () => {
      const closers = [...overlayClosers.values()];
      for (const closer of closers) closer();
    };
    overlayClosers.set(overlayId, closeSelf);
    return {
      render: (width: number, height?: number) => overlay.render(width, typeof height === "number" ? height : getOverlayRenderHeight(process.stdout.rows)),
      invalidate: () => {},
      handleInput: (data: string) => { overlay.handleInput(data, closeSelf, closeAll); _tui.requestRender(); },
    };
  }, {
    overlay: true,
    overlayOptions: {
      anchor: "center",
      width: "85%",
      minWidth: 40,
      margin: {
        top: OVERLAY_TOP_MARGIN_ROWS,
        right: OVERLAY_SIDE_MARGIN_COLS,
        bottom: OVERLAY_BOTTOM_MARGIN_ROWS,
        left: OVERLAY_SIDE_MARGIN_COLS,
      },
    },
  });
}
