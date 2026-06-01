import * as fs from "node:fs";
import * as path from "node:path";
import type { FileStat, DebugFn, PeekCustomTool } from "./types.js";
import { safeReadJson, workspaceKey } from "./helpers.js";

export class TrackedFilesStore {
  readonly trackedFiles = new Map<string, FileStat>();
  currentTurnFiles = new Set<string>();
  lastTurnFiles: string[] = [];
  recentFileHits: string[] = [];
  recentTurns: string[][] = [];

  constructor(
    private readonly trackedFilesDir: string,
    private readonly getProjectRoot: () => string,
    private readonly resolveProjectFile: (filePath: string | undefined) => { relative: string; absolute: string } | undefined,
    private readonly pushDebug: DebugFn,
  ) {}

  normalizeProjectFile(inputPath: string | undefined): string | undefined {
    return this.resolveProjectFile(inputPath)?.relative;
  }

  private getStorePath(): string {
    return path.join(this.trackedFilesDir, `${workspaceKey(path.resolve(this.getProjectRoot()))}.json`);
  }

  persist() {
    try {
      const valid = [...this.trackedFiles.values()].filter((file) => !!this.resolveProjectFile(file.path));
      const lastTurnFiles = this.lastTurnFiles.filter((file) => !!this.resolveProjectFile(file));
      const recentFileHits = this.recentFileHits.filter((file) => !!this.resolveProjectFile(file));
      const recentTurns = this.recentTurns.map((turn) => turn.filter((file) => !!this.resolveProjectFile(file))).filter((turn) => turn.length > 0);
      fs.writeFileSync(this.getStorePath(), JSON.stringify({ workspace: path.resolve(this.getProjectRoot()), updated_at: new Date().toISOString(), files: valid, lastTurnFiles, recentFileHits, recentTurns }, null, 2));
    } catch (error) {
      this.pushDebug(`persist tracked files failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  load(): boolean {
    try {
      const payload = safeReadJson<{ files?: FileStat[]; lastTurnFiles?: string[]; recentFileHits?: string[]; recentTurns?: string[][] }>(this.getStorePath());
      this.trackedFiles.clear();
      for (const file of payload?.files || []) if (this.resolveProjectFile(file.path)) this.trackedFiles.set(file.path, file);
      this.lastTurnFiles = (payload?.lastTurnFiles || []).filter((file): file is string => typeof file === "string" && !!this.resolveProjectFile(file));
      this.recentFileHits = (payload?.recentFileHits || []).filter((file): file is string => typeof file === "string" && !!this.resolveProjectFile(file));
      this.recentTurns = (payload?.recentTurns || []).map((turn) => turn.filter((file): file is string => typeof file === "string" && !!this.resolveProjectFile(file))).filter((turn) => turn.length > 0).slice(-10);
      this.pushDebug(`loaded tracked files count=${this.trackedFiles.size} lastTurnFiles=${this.lastTurnFiles.join(", ") || "none"}`);
      return this.trackedFiles.size > 0 || this.lastTurnFiles.length > 0;
    } catch (error) {
      this.pushDebug(`load tracked files failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  clear() {
    this.trackedFiles.clear();
    this.currentTurnFiles.clear();
    this.lastTurnFiles = [];
    this.recentFileHits = [];
    this.recentTurns = [];
    try { fs.unlinkSync(this.getStorePath()); } catch {}
    this.pushDebug("cleared tracked files");
  }

  finalizeCurrentTurn() {
    this.lastTurnFiles = [...this.currentTurnFiles].filter((file) => !!this.resolveProjectFile(file));
    this.recentTurns.push([...this.lastTurnFiles]);
    if (this.recentTurns.length > 10) this.recentTurns = this.recentTurns.slice(-10);
    this.currentTurnFiles = new Set<string>();
    this.persist();
  }

  bump(filePath: string | undefined, action: string, delta: number, persist = true) {
    const normalized = this.normalizeProjectFile(filePath);
    if (!normalized) return this.pushDebug(`bump skipped action=${action} raw=${String(filePath)}`);
    const existing = this.trackedFiles.get(normalized);
    const next: FileStat = existing ? { ...existing, score: existing.score + delta, touchCount: existing.touchCount + 1, lastTouchedAt: new Date().toISOString(), lastAction: action }
      : { path: normalized, score: delta, touchCount: 1, lastTouchedAt: new Date().toISOString(), lastAction: action };
    this.trackedFiles.set(normalized, next);
    this.currentTurnFiles.add(normalized);
    this.recentFileHits.push(normalized);
    if (this.recentFileHits.length > 50) this.recentFileHits = this.recentFileHits.slice(-50);
    if (persist) this.persist();
    this.pushDebug(`bump action=${action} file=${normalized} score=${next.score} touches=${next.touchCount}`);
  }

  topFiles(limit = 5): FileStat[] {
    const recencyBonuses = this.getRecentBonuses();
    const allFiles = [...this.trackedFiles.values()].filter((file) => !!this.resolveProjectFile(file.path));
    const recentPaths = this.getRecentTurnPaths();
    const compareFiles = (a: FileStat, b: FileStat) => {
      const aScore = a.score + (recencyBonuses.get(a.path) ?? 0);
      const bScore = b.score + (recencyBonuses.get(b.path) ?? 0);
      if (bScore !== aScore) return bScore - aScore;
      if (b.touchCount !== a.touchCount) return b.touchCount - a.touchCount;
      return b.lastTouchedAt.localeCompare(a.lastTouchedAt);
    };
    const recentFirst = allFiles.filter((file) => recentPaths.has(file.path)).sort(compareFiles);
    const olderFill = allFiles.filter((file) => !recentPaths.has(file.path)).sort(compareFiles);
    return [...recentFirst, ...olderFill].slice(0, limit);
  }

  private getRecentBonuses(): Map<string, number> {
    const bonuses = new Map<string, number>();
    let points = 10;
    for (let i = this.recentFileHits.length - 1; i >= 0 && points > 0; i--) {
      const file = this.recentFileHits[i]!;
      if (bonuses.has(file)) continue;
      bonuses.set(file, points);
      points -= 1;
    }
    return bonuses;
  }

  private getRecentTurnPaths(): Set<string> {
    const recent = new Set<string>();
    for (let i = this.recentTurns.length - 1; i >= 0; i--) {
      for (const file of this.recentTurns[i] || []) recent.add(file);
    }
    return recent;
  }

  extractProjectFilesFromText(text: string | undefined): string[] {
    if (!text) return [];
    const matches = text.match(/[A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+/g) || [];
    return [...new Set(matches.map((item) => this.normalizeProjectFile(item)).filter((item): item is string => !!item))];
  }

  extractFilesFromCommand(command: string | undefined): string[] {
    if (!command) return [];
    const patterns = [/Get-Content\s+(?:-Raw\s+)?["']?([^\s"']+)["']?/gi, /Get-Content\s+["']?([^\s"']+)["']?\s+(?:-Raw)?/gi, /(?:^|\s)cat\s+["']?([^\s"']+)["']?/gi, /(?:^|\s)type\s+["']?([^\s"']+)["']?/gi];
    const found: string[] = [];
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(command)) !== null) if (match[1]) found.push(match[1]);
    }
    return [...new Set(found.map((item) => this.normalizeProjectFile(item)).filter((item): item is string => !!item))];
  }

  extractFilesWithCustomTool(tool: PeekCustomTool, event: any): string[] {
    const source = tool.from === "output" ? this.collectOutputText(event) : this.readInputField(event?.input, tool.field);
    if (!source) return [];
    if (tool.mode === "path") return this.extractDirectPath(source);
    if (tool.mode === "text") return this.extractProjectFilesFromText(source);
    return this.extractFilesFromPatch(source, tool.actions);
  }

  private readInputField(input: unknown, field: string | undefined): string | undefined {
    if (!field || !input || typeof input !== "object") return undefined;
    const value = (input as Record<string, unknown>)[field];
    return typeof value === "string" ? value : undefined;
  }

  private collectOutputText(event: any): string | undefined {
    if (!Array.isArray(event?.content)) return undefined;
    const text = event.content.filter((block: any) => block?.type === "text" && typeof block.text === "string").map((block: any) => block.text).join("\n");
    return text || undefined;
  }

  private extractDirectPath(value: string): string[] {
    const normalized = this.normalizeProjectFile(value);
    return normalized ? [normalized] : [];
  }

  private extractFilesFromPatch(text: string, actions?: Array<"add" | "update" | "delete">): string[] {
    const allowed = new Set(actions?.length ? actions : ["add", "update", "delete"]);
    const files: string[] = [];
    const patterns: Array<{ action: "add" | "update" | "delete"; pattern: RegExp }> = [
      { action: "add", pattern: /^\*\*\* Add File:\s+(.+)$/gm },
      { action: "update", pattern: /^\*\*\* Update File:\s+(.+)$/gm },
      { action: "delete", pattern: /^\*\*\* Delete File:\s+(.+)$/gm },
    ];
    for (const { action, pattern } of patterns) {
      if (!allowed.has(action)) continue;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) if (match[1]) files.push(match[1].trim());
    }
    return [...new Set(files.map((item) => this.normalizeProjectFile(item)).filter((item): item is string => !!item))];
  }

  extractFilesFromToolCall(block: any, customTools: PeekCustomTool[]): string[] {
    if (!block?.name || !block?.arguments) return [];
    const args = block.arguments as Record<string, unknown>;
    if (["read", "edit", "write", "grep", "find"].includes(block.name)) {
      const normalized = this.normalizeProjectFile(typeof args.path === "string" ? args.path : undefined);
      return normalized ? [normalized] : [];
    }
    if (block.name === "bash" || block.name === "exec_command") {
      const command = typeof args.cmd === "string" ? args.cmd : typeof args.command === "string" ? args.command : undefined;
      return this.extractFilesFromCommand(command);
    }
    const files: string[] = [];
    for (const customTool of customTools.filter((tool) => tool.tool === block.name)) {
      files.push(...this.extractFilesWithCustomTool(customTool, { input: args, content: [] }));
    }
    return [...new Set(files)];
  }

  restoreLastTurnFromSession(sessionManager: any, customTools: PeekCustomTool[]) {
    if (!sessionManager) return;
    const branch = sessionManager.getBranch();
    const turnFiles = new Set<string>();
    for (let i = branch.length - 1; i >= 0; i--) {
      const entry = branch[i];
      if (entry?.type !== "message") continue;
      const msg = entry.message;
      if (msg?.role === "user") break;
      if (msg?.role !== "assistant" || !Array.isArray(msg.content)) continue;
      for (const block of msg.content) for (const file of this.extractFilesFromToolCall(block, customTools)) turnFiles.add(file);
    }
    this.lastTurnFiles = [...turnFiles].filter((file) => !!this.resolveProjectFile(file));
    this.pushDebug(`restored lastTurnFiles=${this.lastTurnFiles.join(", ") || "none"}`);
  }

  reconstructFromSession(sessionManager: any) {
    this.reconstructFromSessionWithCustomTools(sessionManager, []);
  }

  reconstructFromSessionWithCustomTools(sessionManager: any, customTools: PeekCustomTool[]) {
    this.lastTurnFiles = [];
    this.currentTurnFiles = new Set<string>();
    this.recentFileHits = [];
    this.recentTurns = [];
    if (!sessionManager) return;
    let latestTrackedFiles: string[] = [];
    for (const entry of sessionManager.getBranch()) {
      if (entry.type !== "message") continue;
      const msg = entry.message;
      if (msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
      const turnFiles = new Set<string>();
      for (const block of msg.content) {
        if (block?.type !== "toolCall" || !block.name || !block.arguments) continue;
        const files = this.extractFilesFromToolCall(block, customTools);
        for (const file of files) {
          const delta = block.name === "read" ? 2 : block.name === "edit" || block.name === "write" || block.name.startsWith("custom:") ? 3 : block.name === "grep" || block.name === "find" ? 1 : block.name === "bash" || block.name === "exec_command" ? 2 : 3;
          const action = block.name === "bash" ? "bash-read" : block.name === "exec_command" ? "exec-read" : ["read", "edit", "write", "grep", "find"].includes(block.name) ? block.name : `custom:${block.name}`;
          this.bump(file, action, delta, false);
          turnFiles.add(file);
        }
      }
      if (turnFiles.size > 0) latestTrackedFiles = [...turnFiles];
      this.recentTurns.push([...turnFiles]);
      if (this.recentTurns.length > 10) this.recentTurns = this.recentTurns.slice(-10);
    }
    this.lastTurnFiles = latestTrackedFiles;
    this.currentTurnFiles.clear();
    this.persist();
    this.pushDebug(`reconstructed tracked files count=${this.trackedFiles.size} lastTurnFiles=${this.lastTurnFiles.join(", ") || "none"}`);
  }
}
