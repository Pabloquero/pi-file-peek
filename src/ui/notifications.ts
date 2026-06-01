import type { PeekSettings } from "../types.js";

export class PeekNotifier {
  constructor(
    private readonly getCtx: () => any,
    private readonly getSettings: () => PeekSettings,
  ) {}

  notify(message: string, level: "info" | "warning" | "error" = "info", force = false): void {
    const ctx = this.getCtx();
    if (!ctx?.hasUI) return;
    if (!force && this.getSettings().notifications === false) return;
    ctx.ui.notify(message, level);
  }
}
