import * as fs from "node:fs";
import * as path from "node:path";
import { randomId, safeReadJson } from "./helpers.js";
import { createOutgoingEnvelope, writeEnvelope, type OutgoingPeekPayload } from "./messages.js";
import { openOverlay, openTextOverlayItems, type OverlayTextItem } from "./overlay.js";
import type { ConnectionStore } from "./connection.js";
import type { HighlightService } from "./highlight.js";
import type { PeekDirs, PeekEnvelope, PeekSettings } from "./types.js";

type Notify = (message: string, level?: "info" | "warning" | "error", force?: boolean) => void;

export type FileServiceDeps = {
  dirs: PeekDirs;
  endpointId: string;
  connection: ConnectionStore;
  highlight: HighlightService;
  getCtx: () => any;
  getSettings: () => PeekSettings;
  getDebug: () => boolean;
  resolveProjectFile: (filePath: string | undefined) => { relative: string; absolute: string } | undefined;
  resolveAnyFile: (filePath: string | undefined) => { relative: string; absolute: string } | undefined;
  updateStatus: () => void;
  notify: Notify;
  pushDebug: (line: string) => void;
};

export class PeekFileService {
  private readonly inFlight = new Set<string>();

  constructor(private readonly deps: FileServiceDeps) {}

  sendOrOpen(filePath: string): void {
    this.deps.connection.refreshActivePeerFromPresence();
    this.deps.updateStatus();
    if (!this.deps.connection.activePeer) {
      this.openLocalFileOverlay(filePath);
      return this.deps.notify(`Opened locally: ${filePath}`);
    }
    return this.deps.notify(`Sent file to ${this.sendFileRef(filePath).to_endpoint_id}: ${filePath}`);
  }

  sendOrOpenTextItems(items: OverlayTextItem[], label = "preview"): void {
    if (items.length === 0) return;
    this.deps.connection.refreshActivePeerFromPresence();
    this.deps.updateStatus();
    if (!this.deps.connection.activePeer) {
      openTextOverlayItems(this.deps.getCtx(), items, this.deps.highlight, this.deps.getSettings());
      return this.deps.notify(`Opened locally: ${label}`);
    }
    const content = items.length === 1 ? items[0]!.content : items.map((item, index) => `# ${index + 1}/${items.length} ${item.title ?? label}\n\n${item.content}`).join("\n\n---\n\n");
    const title = items.length === 1 ? items[0]!.title ?? label : label;
    const envelope = this.sendText(content, title);
    return this.deps.notify(`Sent ${label} to ${envelope.to_endpoint_id}`);
  }

  sendOrOpenPath(filePath: string): void {
    const resolved = this.deps.resolveAnyFile(filePath);
    if (!resolved) throw new Error(`Not a valid file path: ${filePath}`);
    this.deps.connection.refreshActivePeerFromPresence();
    this.deps.updateStatus();
    if (!this.deps.connection.activePeer) {
      this.openLocalResolvedFileOverlay(resolved);
      return this.deps.notify(`Opened locally: ${resolved.relative}`);
    }
    return this.deps.notify(`Sent file to ${this.sendResolvedFileRef(resolved).to_endpoint_id}: ${resolved.relative}`);
  }

  handleIncomingFile(filePath: string): void {
    if (this.inFlight.has(filePath)) return;
    this.inFlight.add(filePath);
    try {
      const msg = safeReadJson<PeekEnvelope>(filePath);
      if (!msg || msg.schema !== "pi-peek-message/v1" || msg.to_endpoint_id !== this.deps.endpointId) return;
      this.deps.connection.ensureAutoConnectBack();
      const ctx = this.deps.getCtx();
      if (!ctx?.hasUI) return void this.removeEnvelope(filePath);
      if (this.deps.getDebug()) {
        const processedPath = this.moveToProcessed(filePath);
        openOverlay(ctx, msg, this.deps.highlight, this.deps.getSettings(), () => this.removeEnvelope(processedPath));
      } else {
        openOverlay(ctx, msg, this.deps.highlight, this.deps.getSettings());
        this.removeEnvelope(filePath);
      }
    } finally {
      this.inFlight.delete(filePath);
    }
  }

  private openLocalFileOverlay(filePath: string): void {
    const resolved = this.deps.resolveProjectFile(filePath);
    if (!resolved) throw new Error(`Not a valid local file: ${filePath}`);
    this.openLocalResolvedFileOverlay(resolved);
  }

  private openLocalResolvedFileOverlay(resolved: { relative: string; absolute: string }): void {
    openOverlay(this.deps.getCtx(), { schema: "pi-peek-message/v1", kind: "file-ref", message_id: randomId("local"), to_endpoint_id: this.deps.endpointId, from_endpoint_id: this.deps.endpointId, timestamp: new Date().toISOString(), path: resolved.absolute }, this.deps.highlight, this.deps.getSettings());
  }

  // Deprecated command path kept for possible future non-file cross-session payloads.
  private sendToPeer(payload: OutgoingPeekPayload): PeekEnvelope {
    this.deps.connection.refreshActivePeerFromPresence();
    if (!this.deps.connection.activePeer) throw new Error("No connected peer. Run /peek con first.");
    const ctx = this.deps.getCtx();
    const message = createOutgoingEnvelope({
      payload,
      peer: this.deps.connection.activePeer,
      endpointId: this.deps.endpointId,
      sessionId: ctx?.sessionManager?.getSessionId?.(),
      workspace: ctx?.sessionManager?.getCwd?.() || ctx?.cwd,
    });
    writeEnvelope(this.deps.dirs, message);
    this.deps.pushDebug(`sent kind=${message.kind} to=${message.to_endpoint_id} path=${message.path ?? ""} message=${message.message ?? ""}`);
    return message;
  }

  private sendText(message: string, tag?: string): PeekEnvelope {
    return this.sendToPeer({ kind: "text", message, tag });
  }

  private sendFileRef(filePath: string): PeekEnvelope {
    const resolved = this.deps.resolveProjectFile(filePath);
    if (!resolved) throw new Error(`Not a valid local file: ${filePath}`);
    return this.sendResolvedFileRef(resolved);
  }

  private sendResolvedFileRef(resolved: { relative: string; absolute: string }): PeekEnvelope {
    return this.sendToPeer({ kind: "file-ref", path: resolved.absolute });
  }

  private moveToProcessed(filePath: string): string | undefined {
    const targetDir = path.join(this.deps.dirs.processed, this.deps.endpointId);
    fs.mkdirSync(targetDir, { recursive: true });
    const targetPath = path.join(targetDir, path.basename(filePath));
    try { fs.renameSync(filePath, targetPath); return targetPath; } catch { try { fs.unlinkSync(filePath); } catch {} }
    return undefined;
  }

  private removeEnvelope(filePath: string | undefined): void {
    if (filePath) try { fs.unlinkSync(filePath); } catch {}
  }
}
