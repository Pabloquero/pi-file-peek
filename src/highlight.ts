import * as path from "node:path";
import { createRequire } from "node:module";
import { getLanguageFromPath as piGetLanguageFromPath, highlightCode as piHighlightCode } from "@earendil-works/pi-coding-agent";
import type { DebugFn, HljsApi } from "./types.js";
import { expandTabs, getPeekRuntimeRoot } from "./helpers.js";
import { renderMarkdown } from "./markdown.js";

const requireFromHere = createRequire(import.meta.url);

function classToThemeColor(className: string): string {
  if (/comment/.test(className)) return "syntaxComment";
  if (/keyword|operator|built_in|builtin-name|selector-tag|literal/.test(className)) return "syntaxKeyword";
  if (/string|regexp|template-variable/.test(className)) return "syntaxString";
  if (/number/.test(className)) return "syntaxNumber";
  if (/title\.function|title function|function|attr/.test(className)) return "syntaxFunction";
  if (/type|class|title\.class/.test(className)) return "syntaxType";
  if (/variable|property|params/.test(className)) return "syntaxVariable";
  if (/punctuation/.test(className)) return "syntaxPunctuation";
  return "text";
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
      stack.push((s: string) => theme.fg(classToThemeColor(match[1]!), s));
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
  constructor(private readonly pushDebug: DebugFn) {}

  private getExtraHighlightBuildDir(): string {
    return path.join(getPeekRuntimeRoot(), "extra", "build", "lib");
  }

  private loadExtraHljs(): HljsApi | undefined {
    if (this.hljs) return this.hljs;
    try {
      const libDir = this.getExtraHighlightBuildDir();
      const core = requireFromHere(path.join(libDir, "core.js")) as HljsApi;
      try {
        const mod = requireFromHere(path.join(libDir, "languages", "gdscript.js"));
        core.registerLanguage("gdscript", mod.default ?? mod);
      } catch {}
      this.hljs = core;
      this.pushDebug(`extra hljs loaded from ${libDir}`);
      return core;
    } catch (error) {
      this.pushDebug(`extra hljs load failed: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private detectTarget(filePath: string | undefined): { language: string; source: "pi" | "extra" } | undefined {
    const ext = filePath ? path.extname(filePath).toLowerCase() : "";
    if (ext === ".gds") return { language: "gdscript", source: "extra" };
    if (ext === ".mkd" || ext === ".markdown") return { language: "markdown", source: "pi" };
    if (!filePath) return undefined;
    const language = piGetLanguageFromPath(filePath);
    return language ? { language, source: "pi" } : undefined;
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
