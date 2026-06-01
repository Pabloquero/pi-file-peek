import * as fs from "node:fs";
import { HEARTBEAT_MS, loadPeekSettings } from "./helpers.js";
import { scanInbox, startInboxWatcher } from "./inbox.js";
import type { ConnectionStore } from "./connection.js";
import type { PeekDirs, PeekSettings } from "./types.js";
import type { PeekFileService } from "./file-service.js";
import type { ToolTrackingController } from "./tool-tracking.js";
import type { TrackedFilesStore } from "./tracking.js";

export type LifecycleDeps = {
  dirs: PeekDirs;
  presencePath: string;
  connection: ConnectionStore;
  files: PeekFileService;
  tracking: TrackedFilesStore;
  toolTracking: ToolTrackingController;
  getCurrentCtx: () => any;
  setCurrentCtx: (ctx: any) => void;
  getSettings: () => PeekSettings;
  setSettings: (settings: PeekSettings) => void;
  setDebug: (debug: boolean) => void;
  getProjectRoot: () => string;
  flushPresence: () => void;
  updateStatus: () => void;
  tryAutoConnect: () => void;
  clearAutoConnect: () => void;
  pushDebug: (line: string) => void;
  notify: (message: string, level?: "info" | "warning" | "error", force?: boolean) => void;
};

export function registerLifecycle(pi: any, deps: LifecycleDeps): void {
  let watcher: fs.FSWatcher | undefined;
  let heartbeat: NodeJS.Timeout | undefined;

  pi.on("session_start", async (_event: unknown, ctx: any) => {
    deps.setCurrentCtx(ctx);
    const settings = loadPeekSettings(deps.getProjectRoot());
    deps.setSettings(settings);
    deps.setDebug(settings.debug);
    deps.connection.settings = settings;
    if (deps.tracking.load() === false) deps.tracking.reconstructFromSessionWithCustomTools(ctx?.sessionManager, deps.getSettings().customTools);
    deps.tracking.restoreLastTurnFromSession(ctx?.sessionManager, deps.getSettings().customTools);
    deps.connection.restoreActiveConnection();
    if (!deps.connection.activePeer) deps.connection.restoreReconnectHint();
    deps.connection.isSubscribed = deps.connection.settings.autoSub;
    deps.flushPresence();
    deps.updateStatus();
    watcher?.close();
    watcher = startInboxWatcher(deps.dirs, (filePath) => deps.files.handleIncomingFile(filePath));
    heartbeat && clearInterval(heartbeat);
    heartbeat = setInterval(() => {
      try {
        deps.connection.ensureAutoConnectBack();
        if (deps.connection.settings.autoCon && !deps.connection.activePeer) deps.tryAutoConnect();
        deps.flushPresence();
        deps.updateStatus();
      } catch {}
    }, HEARTBEAT_MS);
    scanInbox(deps.dirs, (filePath) => deps.files.handleIncomingFile(filePath));
    deps.connection.ensureAutoConnectBack();
    if (deps.connection.settings.autoCon) deps.tryAutoConnect();
    deps.pushDebug(`session_start cwd=${deps.getProjectRoot()}`);
    deps.notify("Peek ready");
  });

  pi.on("session_tree", async (_event: unknown, ctx: any) => {
    deps.setCurrentCtx(ctx);
    if (deps.tracking.trackedFiles.size === 0) deps.tracking.reconstructFromSessionWithCustomTools(ctx?.sessionManager, deps.getSettings().customTools);
    deps.tracking.restoreLastTurnFromSession(ctx?.sessionManager, deps.getSettings().customTools);
  });
  pi.on("agent_start", async () => deps.toolTracking.onAgentStart());
  pi.on("agent_end", async () => deps.toolTracking.onAgentEnd());
  pi.on("tool_result", async (event: unknown) => deps.toolTracking.onToolResult(event));
  pi.on("session_shutdown", async () => {
    watcher?.close();
    if (heartbeat) clearInterval(heartbeat);
    deps.clearAutoConnect();
    deps.connection.disconnect(false);
    try { fs.unlinkSync(deps.presencePath); } catch {}
    deps.getCurrentCtx()?.ui?.setStatus("pi-file-peek", undefined);
  });
}
