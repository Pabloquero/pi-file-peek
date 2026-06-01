import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import { getLanguageFromPath as piGetLanguageFromPath, highlightCode as piHighlightCode } from "@earendil-works/pi-coding-agent";
import type { DebugFn, HljsApi, PeekSettings } from "./types.js";
import { expandTabs, getPeekRuntimeRoot } from "./helpers.js";
import { renderMarkdown } from "./markdown.js";

const requireFromHere = createRequire(import.meta.url);

function classToThemeColor(className: string): string | undefined {
  if (/comment|quote|doctag/.test(className)) return "syntaxComment";
  if (/keyword|selector-tag|literal|meta/.test(className)) return "syntaxKeyword";
  if (/built_in|builtin-name|type|class|title\.class/.test(className)) return "syntaxType";
  if (/string|regexp|template-variable/.test(className)) return "syntaxString";
  if (/number/.test(className)) return "syntaxNumber";
  if (/title|function/.test(className)) return "syntaxFunction";
  if (/attr|variable|property|params/.test(className)) return "syntaxVariable";
  if (/operator|punctuation|tag/.test(className)) return "syntaxPunctuation";
  return undefined;
}

function decodeEntities(text: string): string {
  return text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function htmlToAnsi(html: string, theme: any): string {
  const stack: ((s: string) => string)[] = [(s: string) => s];
  let out = "";
  const regex = /<span class="([^"]+)">|<\/span>|([^<]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    if (match[1]) {
      const color = classToThemeColor(match[1]!);
      stack.push(color ? ((s: string) => theme.fg(color, s)) : ((s: string) => s));
    } else if (match[0] === "</span>") {
      if (stack.length > 1) stack.pop();
    } else if (match[2]) {
      out += stack[stack.length - 1]!(decodeEntities(match[2]));
    }
  }
  return out;
}

function normalizeRenderedLines(lines: string[]): string[] {
  return lines.map((line) => line.replace(/\r/g, ""));
}

export class HighlightService {
  private hljs: HljsApi | undefined;
  private extraLanguageNames = new Set<string>();
  constructor(private readonly pushDebug: DebugFn, private readonly getSettings: () => PeekSettings) {}

  private getExtraHighlightBuildDir(): string {
    return path.join(getPeekRuntimeRoot(), "extra", "build", "lib");
  }

  private loadExtraHljs(): HljsApi | undefined {
    if (this.hljs) return this.hljs;
    try {
      const libDir = this.getExtraHighlightBuildDir();
      const core = requireFromHere(path.join(libDir, "core.js")) as HljsApi;
      const languagesDir = path.join(libDir, "languages");
      for (const fileName of fs.existsSync(languagesDir) ? fs.readdirSync(languagesDir) : []) {
        if (!fileName.endsWith(".js")) continue;
        const languageName = path.basename(fileName, ".js");
        try {
          const mod = requireFromHere(path.join(languagesDir, fileName));
          core.registerLanguage(languageName, mod.default ?? mod);
          this.extraLanguageNames.add(languageName.toLowerCase());
        } catch (error) {
          this.pushDebug(`extra language load failed file=${fileName}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      this.hljs = core;
      this.pushDebug(`extra hljs loaded from ${libDir}`);
      return core;
    } catch (error) {
      this.pushDebug(`extra hljs load failed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private resolveExtraLanguage(ext: string, engine: HljsApi | undefined): string | undefined {
    if (!engine || !ext) return undefined;
    const mapped = this.getSettings().extraLanguages[ext];
    if (mapped && engine.getLanguage(mapped)) return mapped;
    const normalized = ext.replace(/^\./, "").toLowerCase();
    return engine.getLanguage(normalized) ? normalized : undefined;
  }

  private detectTarget(filePath: string | undefined): { language: string; source: "pi" | "extra" } | undefined {
    const ext = filePath ? path.extname(filePath).toLowerCase() : "";
    if (ext === ".mkd" || ext === ".markdown") return { language: "markdown", source: "pi" };
    if (!filePath) return undefined;
    const language = piGetLanguageFromPath(filePath);
    if (language) return { language, source: "pi" };
    const extraLanguage = this.resolveExtraLanguage(ext, this.loadExtraHljs());
    return extraLanguage ? { language: extraLanguage, source: "extra" } : undefined;
  }

  render(content: string, filePath: string | undefined, theme: any): { lines: string[]; highlighted: boolean } {
    const expanded = expandTabs(content);
    const ext = filePath ? path.extname(filePath).toLowerCase() : "";
    if (ext === ".md" || ext === ".markdown" || ext === ".mkd") {
      return { lines: renderMarkdown(expanded), highlighted: true };
    }
    const target = this.detectTarget(filePath);
    this.pushDebug(`renderHighlightedContent file=${filePath ?? "<none>"} language=${target?.language ?? "none"} source=${target?.source ?? "plain"}`);
    if (target?.source === "pi") {
      try {
        return { lines: normalizeRenderedLines(piHighlightCode(expanded, target.language)), highlighted: true };
      } catch (error) {
        this.pushDebug(`pi highlight failed language=${target.language}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (target?.source === "extra") {
      const engine = this.loadExtraHljs();
      if (engine && engine.getLanguage(target.language)) {
        try {
          const html = engine.highlight(expanded, { language: target.language, ignoreIllegals: true }).value;
          return { lines: normalizeRenderedLines(htmlToAnsi(html, theme).replace(/\r\n/g, "\n").split("\n")), highlighted: true };
        } catch (error) {
          this.pushDebug(`extra highlight failed language=${target.language}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
    return { lines: expanded.replace(/\r\n/g, "\n").split("\n"), highlighted: false };
  }
}
