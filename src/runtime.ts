import * as fs from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPeekActions } from "./actions.js";
import { registerPeekCommand } from "./command-registration.js";
import { ConnectionStore } from "./connection.js";
import { DiffTrackingController } from "./diff-tracking.js";
import { EXTENSION_VERSION, ensurePeekDirs, loadPeekSettings, randomId, resolvePeekPath, resolveProjectFile as resolveProjectFileInRoot } from "./helpers.js";
import { HighlightService } from "./highlight.js";
import { PeekFileService } from "./file-service.js";
import { registerLifecycle } from "./lifecycle.js";
import { ToolTrackingController } from "./tool-tracking.js";
import { TrackedFilesStore } from "./tracking.js";
import { PeekNotifier } from "./ui/notifications.js";
import { updatePeekStatus } from "./ui/status.js";
import type { PeekPresence, PeekSettings } from "./types.js";

export function registerPeekExtension(pi: ExtensionAPI) {
  const dirs = ensurePeekDirs();
  const endpointId = randomId("ep");
  const startedAt = new Date().toISOString();
  const presencePath = `${dirs.presence}/${endpointId}.json`;

  let currentCtx: any;
  let autoConnectTimer: NodeJS.Timeout | undefined;
  let debugEnabled = false;
  let settings: PeekSettings = loadPeekSettings(process.cwd());

  const debugLog: string[] = [];
  const notifier = new PeekNotifier(() => currentCtx, () => settings);
  const notify = (message: string, level: "info" | "warning" | "error" = "info", force = false) => notifier.notify(message, level, force);
  const getProjectRoot = () => currentCtx?.sessionManager?.getCwd?.() || currentCtx?.cwd || process.cwd();

  const pushDebug = (line: string) => {
    debugLog.push(`${new Date().toISOString()} ${line}`);
    if (debugLog.length > 40) debugLog.shift();
    if (debugEnabled) notify(`[peek] ${line}`, "info", true);
  };

  const resolveProjectFile = (inputPath: string | undefined) => resolveProjectFileInRoot(getProjectRoot(), inputPath);
  const resolveAnyFile = (inputPath: string | undefined) => resolvePeekPath(getProjectRoot(), inputPath);

  const highlight = new HighlightService(pushDebug, () => settings);
  const tracking = new TrackedFilesStore(dirs.trackedFiles, getProjectRoot, resolveProjectFile, pushDebug);
  const toolTracking = new ToolTrackingController(tracking, pushDebug, () => settings);

  const buildLocalPresence = (): PeekPresence => ({
    endpoint_id: endpointId,
    session_id: currentCtx?.sessionManager?.getSessionId?.(),
    session_file: currentCtx?.sessionManager?.getSessionFile?.(),
    workspace: currentCtx?.sessionManager?.getCwd?.() || currentCtx?.cwd,
    started_at: startedAt,
    last_seen: new Date().toISOString(),
    peek_subscribed: connection.isSubscribed,
    connected_endpoint_id: connection.activePeer?.endpoint_id,
    extension_version: EXTENSION_VERSION,
  });
  const flushPresence = () => fs.writeFileSync(presencePath, JSON.stringify(buildLocalPresence(), null, 2));
  const connection = new ConnectionStore(dirs, endpointId, flushPresence, buildLocalPresence, pushDebug);

  const updateStatus = () => updatePeekStatus(currentCtx, debugEnabled, {
    refresh: () => connection.refreshActivePeerFromPresence(),
    getActivePeer: () => connection.activePeer,
    getInboundPeer: () => connection.getInboundPeer(),
    isSubscribed: connection.isSubscribed,
    autoConnectPaused: connection.autoConnectSuppressed,
  });

  const files = new PeekFileService({ dirs, endpointId, connection, highlight, getCtx: () => currentCtx, getSettings: () => settings, getDebug: () => debugEnabled, resolveProjectFile, resolveAnyFile, updateStatus, notify, pushDebug });
  const diffTracking = new DiffTrackingController({ getCtx: () => currentCtx, getSettings: () => settings, pushDebug, notify, sendOrOpenTextItems: (items, label) => files.sendOrOpenTextItems(items, label) });

  const tryAutoConnect = () => {
    if (connection.autoConnectSuppressed || connection.activePeer) {
      if (autoConnectTimer) clearTimeout(autoConnectTimer);
      autoConnectTimer = undefined;
      return;
    }
    const preferred = connection.pickConnectionCandidate(true);
    if (preferred && connection.connectToPeer(preferred)) {
      updateStatus();
      return void (debugEnabled ? notify(`Auto-connected to ${preferred.endpoint_id}${preferred.peek_subscribed ? " (subscribed)" : ""}`, "info", true) : undefined);
    }
    autoConnectTimer && clearTimeout(autoConnectTimer);
    autoConnectTimer = setTimeout(() => tryAutoConnect(), 2000);
  };

  const actions = createPeekActions({
    endpointId,
    connection,
    tracking,
    debugLog,
    getCtx: () => currentCtx,
    getProjectRoot,
    getDebug: () => debugEnabled,
    setDebug: (value) => { debugEnabled = value; },
    getSettings: () => settings,
    setSettings: (next) => { settings = next; connection.settings = next; },
    resolveProjectFile,
    refreshLastResponseFiles: (sessionManager?: any) => tracking.restoreLastTurnFromSession(sessionManager ?? currentCtx?.sessionManager, settings.customTools),
    getLastResponseFiles: () => [...new Set(tracking.lastTurnFiles)].filter((file) => !!resolveProjectFile(file)),
    openDiffPreview: (sessionManager?: any) => diffTracking.openLatestFromMemoryOrSession(sessionManager ?? currentCtx?.sessionManager),
    sendOrOpen: (filePath) => files.sendOrOpen(filePath),
    sendOrOpenPath: (filePath) => files.sendOrOpenPath(filePath),
    updateStatus,
    clearAutoConnect: () => { if (autoConnectTimer) clearTimeout(autoConnectTimer); autoConnectTimer = undefined; },
    flushPresence,
    notify,
  });

  registerLifecycle(pi, { dirs, presencePath, connection, files, tracking, toolTracking, diffTracking, getCurrentCtx: () => currentCtx, setCurrentCtx: (ctx) => { currentCtx = ctx; }, getSettings: () => settings, setSettings: (next) => { settings = next; }, setDebug: (value) => { debugEnabled = value; }, getProjectRoot, flushPresence, updateStatus, tryAutoConnect, clearAutoConnect: () => { if (autoConnectTimer) clearTimeout(autoConnectTimer); autoConnectTimer = undefined; }, pushDebug, notify });
  registerPeekCommand(pi, { getCtx: () => currentCtx, run: actions.run, notify });
}

