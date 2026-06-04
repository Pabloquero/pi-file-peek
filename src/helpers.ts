import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DEFAULT_PEEK_SETTINGS, EXTENSION_VERSION, HEARTBEAT_MS, STALE_MS } from "./defaults.js";
import type { PeekCustomTool, PeekDirs, PeekExtraLanguageMap, PeekKeyAction, PeekKeySettings, PeekPresence, PeekSettings } from "./types.js";

export { EXTENSION_VERSION, HEARTBEAT_MS, STALE_MS };

export function getPiAgentDir(): string {
  return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

export function getPeekRuntimeRoot(): string {
  return path.join(getPiAgentDir(), "extensions", "pi-file-peek", "runtime");
}

function getLegacyPeekRuntimeRoot(): string {
  return path.join(getPiAgentDir(), "pi-file-peek");
}

function copyDirContents(sourceDir: string, targetDir: string): void {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);
    if (entry.isDirectory()) copyDirContents(sourcePath, targetPath);
    else if (!fs.existsSync(targetPath)) fs.copyFileSync(sourcePath, targetPath);
  }
}

function migrateLegacyPeekRuntime(root: string): void {
  const legacyRoot = getLegacyPeekRuntimeRoot();
  if (root === legacyRoot || !fs.existsSync(legacyRoot) || fs.existsSync(root)) return;
  copyDirContents(legacyRoot, root);
}

export function ensurePeekDirs(): PeekDirs {
  const root = getPeekRuntimeRoot();
  migrateLegacyPeekRuntime(root);
  const peekDirs: PeekDirs = {
    root,
    presence: path.join(root, "presence"),
    inbox: path.join(root, "inbox"),
    processed: path.join(root, "processed"),
    tmp: path.join(root, "tmp"),
    trackedFiles: path.join(root, "tracked-files"),
    connections: path.join(root, "connections"),
    reconnects: path.join(root, "reconnects"),
  };
  Object.values(peekDirs).forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
  return peekDirs;
}

export function randomId(prefix: string): string {
  return `${prefix}-${crypto.randomBytes(4).toString("hex")}`;
}

export function isoFilenamePart(value: string): string {
  return value.replace(/:/g, "-").replace(/\./g, "-");
}

export function workspaceKey(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex");
}

export function expandTabs(text: string, tabSize = 2): string {
  return text.replace(/\t/g, " ".repeat(tabSize));
}

export function safeReadJson<T>(filePath: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function isPeerLive(presence: PeekPresence): boolean {
  const lastSeen = Date.parse(presence.last_seen);
  return Number.isFinite(lastSeen) && Date.now() - lastSeen <= STALE_MS;
}

export function comparePresenceFreshness(a: PeekPresence, b: PeekPresence): number {
  return b.last_seen.localeCompare(a.last_seen);
}

export function getProjectSettingsPath(projectRoot: string): string {
  return path.join(path.resolve(projectRoot), ".pi", "settings.json");
}

export function getGlobalSettingsPath(): string {
  return path.join(getPiAgentDir(), "settings.json");
}

export function resolveProjectFile(projectRoot: string, inputPath: string | undefined): { relative: string; absolute: string } | undefined {
  if (!inputPath || typeof inputPath !== "string") return undefined;
  const root = path.resolve(projectRoot);
  const absolute = path.resolve(root, inputPath.replace(/^@/, ""));
  const relative = path.relative(root, absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(absolute)) return undefined;
  try { if (!fs.statSync(absolute).isFile()) return undefined; } catch { return undefined; }
  return { relative: relative.replace(/\\/g, "/"), absolute };
}

export function resolvePeekPath(projectRoot: string, inputPath: string | undefined): { relative: string; absolute: string } | undefined {
  if (!inputPath || typeof inputPath !== "string") return undefined;
  const raw = inputPath.trim().replace(/^@/, "");
  if (!raw) return undefined;
  const absolute = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(path.resolve(projectRoot), raw);
  if (!fs.existsSync(absolute)) return undefined;
  try { if (!fs.statSync(absolute).isFile()) return undefined; } catch { return undefined; }
  const root = path.resolve(projectRoot);
  const relative = path.relative(root, absolute);
  return { relative: !relative || relative.startsWith("..") || path.isAbsolute(relative) ? absolute : relative.replace(/\\/g, "/"), absolute };
}

export function loadPeekSettings(projectRoot: string): PeekSettings {
  const defaults = DEFAULT_PEEK_SETTINGS;
  const globalSettings = safeReadJson<Record<string, unknown>>(getGlobalSettingsPath());
  const projectSettings = safeReadJson<Record<string, unknown>>(getProjectSettingsPath(projectRoot));
  const globalRaw = globalSettings?.["pi-file-peek"];
  const projectRaw = projectSettings?.["pi-file-peek"];
  if ((!globalRaw || typeof globalRaw !== "object") && (!projectRaw || typeof projectRaw !== "object")) return defaults;
  const globalConfig = globalRaw && typeof globalRaw === "object" ? globalRaw as Record<string, unknown> : {};
  const projectConfig = projectRaw && typeof projectRaw === "object" ? projectRaw as Record<string, unknown> : {};
  return {
    autoSub: readBooleanSetting(globalConfig.autoSub, projectConfig.autoSub, defaults.autoSub),
    autoCon: readBooleanSetting(globalConfig.autoCon, projectConfig.autoCon, defaults.autoCon),
    debug: readBooleanSetting(globalConfig.debug, projectConfig.debug, defaults.debug),
    notifications: readBooleanSetting(globalConfig.notifications, projectConfig.notifications, defaults.notifications),
    showHeader: readBooleanSetting(globalConfig.showHeader, projectConfig.showHeader, defaults.showHeader),
    showFooter: readBooleanSetting(globalConfig.showFooter, projectConfig.showFooter, defaults.showFooter),
    closeAll: readBooleanSetting(globalConfig.closeAll, projectConfig.closeAll, defaults.closeAll),
    autoDiff: readBooleanSetting(globalConfig.autoDiff, projectConfig.autoDiff, defaults.autoDiff),
    customTools: loadCustomTools(projectConfig.customTools ?? globalConfig.customTools),
    extraLanguages: loadMergedExtraLanguages(globalConfig.extraLanguages, projectConfig.extraLanguages),
    keys: loadMergedKeySettings(globalConfig.keys, projectConfig.keys, defaults.keys),
  };
}

export function formatPresenceLabel(peer: PeekPresence | undefined, debug = false): string {
  if (!peer) return "none";
  const sessionName = peer.session_file ? path.basename(peer.session_file, path.extname(peer.session_file)) : undefined;
  const workspaceName = peer.workspace ? path.basename(path.resolve(peer.workspace)) : undefined;
  const label = sessionName || workspaceName || peer.endpoint_id;
  return debug && label !== peer.endpoint_id ? `${label} (${peer.endpoint_id})` : label;
}

function readBooleanSetting(globalValue: unknown, projectValue: unknown, fallback: boolean): boolean {
  if (typeof projectValue === "boolean") return projectValue;
  if (typeof globalValue === "boolean") return globalValue;
  return fallback;
}

function loadCustomTools(raw: unknown): PeekCustomTool[] {
  if (!Array.isArray(raw)) return [];
  const validActions = new Set(["add", "update", "delete"]);
  const validModes = new Set(["path", "text", "patch"]);
  const validSources = new Set(["input", "output"]);
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const tool = typeof record.tool === "string" ? record.tool.trim() : "";
    const from = typeof record.from === "string" && validSources.has(record.from) ? record.from as "input" | "output" : undefined;
    const mode = typeof record.mode === "string" && validModes.has(record.mode) ? record.mode as "path" | "text" | "patch" : undefined;
    const field = typeof record.field === "string" && record.field.trim() ? record.field.trim() : undefined;
    const actions = Array.isArray(record.actions)
      ? record.actions.filter((action): action is "add" | "update" | "delete" => typeof action === "string" && validActions.has(action))
      : undefined;
    if (!tool || !from || !mode) return [];
    return [{ tool, from, field, mode, actions: actions?.length ? actions : undefined }];
  });
}

function normalizeExtension(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return "";
  return trimmed.startsWith(".") ? trimmed : `.${trimmed}`;
}

function normalizeLanguageName(value: string): string {
  return value.trim().toLowerCase();
}

function loadExtraLanguages(raw: unknown): PeekExtraLanguageMap {
  if (!Array.isArray(raw)) return {};
  const entries: Array<[string, string]> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    for (const [ext, language] of Object.entries(item as Record<string, unknown>)) {
      if (typeof language !== "string") continue;
      const normalizedExt = normalizeExtension(ext);
      const normalizedLanguage = normalizeLanguageName(language);
      if (!normalizedExt || !normalizedLanguage) continue;
      entries.push([normalizedExt, normalizedLanguage]);
    }
  }
  return Object.fromEntries(entries);
}

function loadMergedExtraLanguages(globalRaw: unknown, projectRaw: unknown): PeekExtraLanguageMap {
  return { ...loadExtraLanguages(globalRaw), ...loadExtraLanguages(projectRaw) };
}

export function updatePeekProjectSettings(projectRoot: string, patch: Record<string, unknown>): void {
  const settingsPath = getProjectSettingsPath(projectRoot);
  const current = safeReadJson<Record<string, unknown>>(settingsPath) || {};
  const currentPeek = current["pi-file-peek"] && typeof current["pi-file-peek"] === "object" ? current["pi-file-peek"] as Record<string, unknown> : {};
  const next = { ...current, "pi-file-peek": { ...currentPeek, ...patch } };
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(next, null, 2));
}

function normalizeKeyList(input: unknown, fallback: string[]): string[] {
  if (typeof input === "string") return [normalizeKeyName(input)];
  if (Array.isArray(input)) {
    const items = input.filter((item): item is string => typeof item === "string").map((item) => normalizeKeyName(item)).filter(Boolean);
    return items.length > 0 ? items : fallback;
  }
  return fallback;
}

function loadKeySettings(raw: unknown, defaults: PeekKeySettings): PeekKeySettings {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const actions: PeekKeyAction[] = ["scrollUp", "scrollDown", "pageUp", "pageDown", "prevItem", "nextItem", "close"];
  return Object.fromEntries(actions.map((action) => {
    const legacy = action === "scrollUp" ? record.lineUp : action === "scrollDown" ? record.lineDown : undefined;
    return [action, normalizeKeyList(record[action] ?? legacy, defaults[action])];
  })) as PeekKeySettings;
}

function loadMergedKeySettings(globalRaw: unknown, projectRaw: unknown, defaults: PeekKeySettings): PeekKeySettings {
  const globalKeys = loadKeySettings(globalRaw, defaults);
  const projectRecord = projectRaw && typeof projectRaw === "object" ? projectRaw as Record<string, unknown> : {};
  const actions: PeekKeyAction[] = ["scrollUp", "scrollDown", "pageUp", "pageDown", "prevItem", "nextItem", "close"];
  return Object.fromEntries(actions.map((action) => {
    const legacy = action === "scrollUp" ? projectRecord.lineUp : action === "scrollDown" ? projectRecord.lineDown : undefined;
    const localValue = projectRecord[action] ?? legacy;
    return [action, localValue === undefined ? globalKeys[action] : normalizeKeyList(localValue, globalKeys[action])];
  })) as PeekKeySettings;
}

export function normalizeKeyName(value: string): string {
  const compact = value.replace(/\s*\+\s*/g, "+").trim();
  if (!compact) return compact;
  const parts = compact.split("+").map((part) => part.trim());
  return parts.map((part) => {
    const lower = part.toLowerCase();
    if (lower === "esc") return "escape";
    if (lower === "return") return "enter";
    if (lower === "pageup") return "pageUp";
    if (lower === "pagedown") return "pageDown";
    return lower;
  }).join("+");
}

export function formatKeyLabel(value: string): string {
  return value.split("+").map((part) => {
    switch (part) {
      case "pageUp": return "PgUp";
      case "pageDown": return "PgDn";
      case "escape": return "Esc";
      case "enter": return "Enter";
      case "ctrl": return "Ctrl";
      case "alt": return "Alt";
      case "shift": return "Shift";
      case "up": return "↑";
      case "down": return "↓";
      case "left": return "←";
      case "right": return "→";
      default: return part;
    }
  }).join("+");
}
