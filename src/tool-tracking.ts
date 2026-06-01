import type { TrackedFilesStore } from "./tracking.js";
import type { DebugFn } from "./types.js";
import type { PeekSettings } from "./types.js";

export class ToolTrackingController {
  private readonly handledToolResults = new Set<string>();

  constructor(private readonly tracking: TrackedFilesStore, private readonly pushDebug: DebugFn, private readonly getSettings: () => PeekSettings) {}

  onAgentStart(): void {
    this.tracking.currentTurnFiles = new Set<string>();
    this.handledToolResults.clear();
    this.pushDebug("agent_start");
  }

  onAgentEnd(): void {
    this.tracking.finalizeCurrentTurn();
    this.pushDebug(`agent_end lastTurnFiles=${this.tracking.lastTurnFiles.join(", ") || "none"}`);
  }

  onToolResult(event: any): void {
    if (this.handledToolResults.has(event.toolCallId)) return;
    this.handledToolResults.add(event.toolCallId);
    this.pushDebug(`tool_result tool=${event.toolName} id=${event.toolCallId}`);
    if (event.toolName === "bash" || event.toolName === "exec_command") {
      const input = event.input as Record<string, unknown>;
      const command = typeof input.cmd === "string" ? input.cmd : typeof input.command === "string" ? input.command : undefined;
      const commandFiles = this.tracking.extractFilesFromCommand(command);
      for (const file of commandFiles) this.tracking.bump(file, event.toolName === "bash" ? "bash-read" : "exec-read", 2);
      for (const block of event.content) if (block.type === "text") for (const file of this.tracking.extractProjectFilesFromText(block.text)) this.tracking.bump(file, event.toolName === "bash" ? "bash-output" : "exec-output", 1);
      return;
    }
    if (["read", "edit", "write", "grep", "find"].includes(event.toolName)) {
      this.tracking.bump(typeof event.input.path === "string" ? event.input.path : undefined, event.toolName, event.toolName === "read" ? 2 : event.toolName === "edit" || event.toolName === "write" ? 3 : 1);
      return;
    }
    for (const customTool of this.getSettings().customTools.filter((tool) => tool.tool === event.toolName)) {
      const files = this.tracking.extractFilesWithCustomTool(customTool, event);
      for (const file of files) this.tracking.bump(file, `custom:${event.toolName}`, 3);
    }
  }
}
