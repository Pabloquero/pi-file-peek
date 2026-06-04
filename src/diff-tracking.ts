import type { OverlayTextItem } from "./overlay.js";
import type { DebugFn, PeekSettings } from "./types.js";

export type PeekDiffPayload = {
  toolCallId?: string;
  toolName: string;
  capturedAt: string;
  title: string;
  patch?: string;
  diff?: unknown;
  text: string;
  source: "live" | "history";
};

function getTextBlock(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringifyDiff(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return getTextBlock(value);
  try {
    const text = JSON.stringify(value, null, 2);
    return text && text !== "null" ? text : undefined;
  } catch {
    return undefined;
  }
}

function payloadFromParts(input: {
  toolName: string;
  toolCallId?: string;
  details: unknown;
  source: "live" | "history";
  timestamp?: number | string;
}): PeekDiffPayload | undefined {
  if (!input.details || typeof input.details !== "object") return undefined;
  const details = input.details as Record<string, unknown>;
  const patch = getTextBlock(details.patch);
  const diffText = getTextBlock(details.diff);
  const serializedDiff = diffText ?? stringifyDiff(details.diff);
  const text = diffText ?? patch ?? serializedDiff;
  if (!text) return undefined;
  const capturedAt = typeof input.timestamp === "number" ? new Date(input.timestamp).toISOString() : typeof input.timestamp === "string" ? input.timestamp : new Date().toISOString();
  return {
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    capturedAt,
    title: input.toolName === "edit" ? "Edit diff" : `${input.toolName} diff`,
    patch,
    diff: details.diff,
    text,
    source: input.source,
  };
}

function isPatchLikeToolResult(event: any): boolean {
  if (event?.toolName === "edit") return true;
  const details = event?.details;
  return !!details && typeof details === "object" && ("patch" in details || "diff" in details);
}

export class DiffTrackingController {
  private currentTurn: PeekDiffPayload[] = [];
  private recentTurns: PeekDiffPayload[][] = [];
  private readonly handledToolResults = new Set<string>();

  constructor(
    private readonly deps: {
      getCtx: () => any;
      getSettings: () => PeekSettings;
      pushDebug: DebugFn;
      notify: (message: string, level?: "info" | "warning" | "error", force?: boolean) => void;
      sendOrOpenTextItems: (items: OverlayTextItem[], label?: string) => void;
    },
  ) {}

  onAgentStart(): void {
    this.currentTurn = [];
    this.handledToolResults.clear();
  }

  onAgentEnd(): void {
    if (this.currentTurn.length === 0) return;
    const completedTurn = [...this.currentTurn];
    this.recentTurns.push(completedTurn);
    if (this.recentTurns.length > 10) this.recentTurns = this.recentTurns.slice(-10);
    this.currentTurn = [];
    if (this.deps.getSettings().autoDiff) this.openPayloads(completedTurn);
  }

  onToolResult(event: any): void {
    if (!event || this.handledToolResults.has(event.toolCallId)) return;
    this.handledToolResults.add(event.toolCallId);
    if (event.isError || !isPatchLikeToolResult(event)) return;
    const payload = payloadFromParts({ toolName: String(event.toolName ?? "tool"), toolCallId: event.toolCallId, details: event.details, source: "live" });
    if (!payload) return;
    this.currentTurn.push(payload);
    this.deps.pushDebug(`diff captured tool=${payload.toolName} id=${payload.toolCallId ?? "none"}`);
  }

  openLatestFromMemoryOrSession(sessionManager?: any): boolean {
    const payloads = this.getRecentPayloads(sessionManager);
    if (payloads.length === 0) return false;
    this.openPayloads(payloads);
    return true;
  }

  private getRecentPayloads(sessionManager?: any): PeekDiffPayload[] {
    if (this.currentTurn.length > 0) return [...this.currentTurn];
    const latestTurn = this.recentTurns[this.recentTurns.length - 1];
    if (latestTurn && latestTurn.length > 0) return [...latestTurn];
    const recovered = this.recoverRecentFromSession(sessionManager);
    if (recovered.length > 0) {
      this.recentTurns.push(recovered);
      return recovered;
    }
    return [];
  }

  private recoverRecentFromSession(sessionManager?: any): PeekDiffPayload[] {
    const branch = sessionManager?.getBranch?.();
    if (!Array.isArray(branch)) return [];
    let turnPayloads: PeekDiffPayload[] = [];
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (entry?.type !== "message") continue;
      const msg = entry.message;
      if (msg?.role === "user") {
        if (turnPayloads.length > 0) return turnPayloads.reverse();
        turnPayloads = [];
        continue;
      }
      if (msg?.role !== "toolResult") continue;
      if (msg.toolName !== "edit") continue;
      const payload = payloadFromParts({ toolName: msg.toolName, toolCallId: msg.toolCallId, details: msg.details, source: "history", timestamp: msg.timestamp });
      if (payload) turnPayloads.push(payload);
    }
    return turnPayloads.reverse();
  }

  private openPayloads(payloads: PeekDiffPayload[]): void {
    const items: OverlayTextItem[] = payloads.map((payload) => ({
      title: payload.title,
      subtitle: `${payload.toolName}${payload.source === "history" ? " from session history" : " result"}`,
      content: payload.text,
      virtualPath: "peek.diff",
    }));
    this.deps.sendOrOpenTextItems(items, payloads.length === 1 ? "diff" : "diffs");
  }
}
