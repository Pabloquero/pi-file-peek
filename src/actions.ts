import * as path from "node:path";
import { formatPresenceLabel, updatePeekProjectSettings } from "./helpers.js";
import { pickFile as openFilePicker } from "./ui/file-picker.js";
import { openSettingsPicker } from "./ui/settings-picker.js";
import type { PeekCommand } from "./commands.js";
import type { ConnectionStore } from "./connection.js";
import type { TrackedFilesStore } from "./tracking.js";
import type { PeekSettings } from "./types.js";

type Notify = (message: string, level?: "info" | "warning" | "error", force?: boolean) => void;

export type PeekActionsDeps = {
  endpointId: string;
  connection: ConnectionStore;
  tracking: TrackedFilesStore;
  debugLog: string[];
  getCtx: () => any;
  getProjectRoot: () => string;
  getDebug: () => boolean;
  setDebug: (value: boolean) => void;
  getSettings: () => PeekSettings;
  setSettings: (settings: PeekSettings) => void;
  resolveProjectFile: (filePath: string | undefined) => { relative: string; absolute: string } | undefined;
  refreshLastResponseFiles: (sessionManager?: any) => void;
  getLastResponseFiles: () => string[];
  sendOrOpen: (filePath: string) => void;
  sendOrOpenPath: (filePath: string) => void;
  updateStatus: () => void;
  clearAutoConnect: () => void;
  flushPresence: () => void;
  notify: Notify;
};

type ToggleSetting = "autoSub" | "autoCon" | "debug" | "notifications" | "showHeader" | "showFooter" | "closeAll";

export function createPeekActions(deps: PeekActionsDeps) {
  const getDuplicateBaseNames = (filePaths: string[]) => {
    const counts = new Map<string, number>();
    for (const filePath of filePaths) {
      const base = path.basename(filePath);
      counts.set(base, (counts.get(base) ?? 0) + 1);
    }
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([base]) => base));
  };

  const fileLabel = (filePath: string, details?: { score?: number; touches?: number }) => {
    const base = path.basename(filePath);
    if (!deps.getDebug()) return base;
    const parts = [base];
    if (typeof details?.score === "number") parts.push(`score ${details.score}`);
    if (typeof details?.touches === "number") parts.push(`touches ${details.touches}`);
    parts.push(`path ${filePath}`);
    return `${parts[0]}  [${parts.slice(1).join(", ")}]`;
  };

  const fileLabelForList = (filePath: string, duplicateBaseNames: Set<string>, details?: { score?: number; touches?: number }) => {
    if (deps.getDebug()) return fileLabel(filePath, details);
    const base = path.basename(filePath);
    return duplicateBaseNames.has(base) ? `${base} [${filePath}]` : base;
  };

  const buildStatusMessage = () => {
    deps.connection.refreshActivePeerFromPresence();
    deps.connection.ensureAutoConnectBack();
    const settings = deps.getSettings();
    const inboundPeer = deps.connection.getInboundPeer();
    const connected = formatPresenceLabel(deps.connection.activePeer, deps.getDebug());
    const subscribed = deps.connection.isSubscribed ? "yes" : "no";
    const source = formatPresenceLabel(inboundPeer, deps.getDebug());
    if (!deps.getDebug()) return `Peek connected=${connected} subscribed=${subscribed} from=${source}`;
    const top = deps.tracking.topFiles(10).map((file, index) => `${index + 1}. ${file.path} [score=${file.score}, touches=${file.touchCount}, action=${file.lastAction}]`).join("\n") || "none";
    const recent = deps.getLastResponseFiles().join("\n") || "none";
    return `Peek status\nendpoint=${deps.endpointId}\nconnected=${connected}\nsubscribed=${subscribed}\nfrom=${source}\nautoSub=${settings.autoSub}\nautoCon=${settings.autoCon}\nautoConnectPaused=${deps.connection.autoConnectSuppressed}\nnotifications=${settings.notifications}\nshowHeader=${settings.showHeader}\nshowFooter=${settings.showFooter}\ncloseAll=${settings.closeAll}\nrecent:\n${recent}\npast:\n${top}\nlogs:\n${deps.debugLog.slice(-10).join("\n") || "none"}`;
  };

  const setSetting = (name: ToggleSetting, nextValue: boolean) => {
    if (deps.getSettings()[name] === nextValue) return;
    const settings = { ...deps.getSettings(), [name]: nextValue };
    deps.setSettings(settings);
    if (name === "debug") deps.setDebug(nextValue);
    if (name === "autoSub") deps.connection.isSubscribed = nextValue;
    updatePeekProjectSettings(deps.getProjectRoot(), { [name]: nextValue });
    deps.flushPresence();
    deps.updateStatus();
    return deps.notify(`Peek setting ${name} ${nextValue ? "enabled" : "disabled"}`, "info", true);
  };

  const toggleSetting = (name: ToggleSetting) => setSetting(name, !deps.getSettings()[name]);

  const openSettingsMenu = async (uiCtx?: any) => {
    const names: ToggleSetting[] = ["autoSub", "autoCon", "debug", "notifications", "showHeader", "showFooter", "closeAll"];
    const ctx = uiCtx ?? deps.getCtx();
    if (!ctx?.hasUI) return deps.notify(names.map((name) => `${name}=${deps.getSettings()[name]}`).join("\n"), "info", true);
    return openSettingsPicker(
      ctx,
      names.map((name) => ({ id: name, label: name, value: deps.getSettings()[name] })),
      "Peek settings: toggle local setting",
      (id, value) => {
        if (names.includes(id as ToggleSetting)) setSetting(id as ToggleSetting, value);
      },
    );
  };

  const run = async (action: PeekCommand, argText = "", commandCtx?: any): Promise<void> => {
    const uiCtx = commandCtx ?? deps.getCtx();
    switch (action) {
      case "sub":
        deps.connection.isSubscribed = true;
        deps.flushPresence();
        deps.updateStatus();
        return deps.notify(`Peek subscribed as receiver (${deps.endpointId})`);
      case "con": {
        deps.connection.resumeAutoConnect();
        deps.connection.refreshActivePeerFromPresence();
        if (deps.connection.activePeer && deps.connection.findOutboundConnection()) return deps.notify(`Already connected to ${deps.connection.activePeer.endpoint_id}`, "warning", true);
        const preferred = deps.connection.pickConnectionCandidate(true);
        if (!preferred) return deps.notify("No available live peek session found", "warning", true);
        if (!deps.connection.connectToPeer(preferred)) return deps.notify(`Could not connect to ${preferred.endpoint_id}; it may already be connected`, "warning", true);
        deps.updateStatus();
        return deps.notify(`Connected to ${formatPresenceLabel(preferred, deps.getDebug())}${preferred.peek_subscribed ? " (subscribed)" : ""}`);
      }
      case "disconnect":
        deps.connection.suppressAutoConnect();
        deps.clearAutoConnect();
        deps.connection.isSubscribed = false;
        deps.connection.disconnectAll();
        deps.updateStatus();
        return deps.notify("Peek disconnected and unsubscribed");
      case "clear":
        deps.tracking.clear();
        return deps.notify("Peek tracked-file history cleared", "info", true);
      case "settings":
        return openSettingsMenu(uiCtx);
      case "unsub":
        deps.connection.isSubscribed = false;
        deps.flushPresence();
        deps.updateStatus();
        return deps.notify("Peek unsubscribed");
      case "discon":
        deps.connection.suppressAutoConnect();
        deps.clearAutoConnect();
        deps.connection.disconnectAll();
        deps.updateStatus();
        return deps.notify("Peek disconnected");
      case "file": {
        deps.refreshLastResponseFiles(commandCtx?.sessionManager);
        const files = deps.getLastResponseFiles();
        if (files.length === 0) return run("past");
        if (files.length === 1) return deps.sendOrOpen(files[0]!);
        const duplicateBaseNames = getDuplicateBaseNames(files);
        const selected = await openFilePicker(uiCtx, files.map((file) => ({ value: file, label: fileLabelForList(file, duplicateBaseNames) })), "Peek file: pick from the last response");
        if (selected) deps.sendOrOpen(selected);
        return;
      }
      case "path": {
        const requestedPath = argText.trim();
        if (!requestedPath) return deps.notify("Usage: /peek path <file-path>", "warning", true);
        try {
          return deps.sendOrOpenPath(requestedPath);
        } catch (error) {
          return deps.notify(error instanceof Error ? error.message : String(error), "warning", true);
        }
      }
      case "past": {
        const files = deps.tracking.topFiles(10);
        if (files.length === 0) return deps.notify("No past tracked files", "warning", true);
        const duplicateBaseNames = getDuplicateBaseNames(files.map((file) => file.path));
        const selected = await openFilePicker(uiCtx, files.map((file) => ({ value: file.path, label: fileLabelForList(file.path, duplicateBaseNames, { score: file.score, touches: file.touchCount }) })), "Peek past: pick a tracked file");
        if (selected) deps.sendOrOpen(selected);
        return;
      }
      case "status":
        return deps.notify(buildStatusMessage(), "info", true);
      case "debug": {
        return toggleSetting("debug");
      }
    }
  };

  return { run };
}
