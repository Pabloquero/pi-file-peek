import { isPeekCommand, MENU_PEEK_COMMANDS, PUBLIC_PEEK_COMMANDS, PEEK_USAGE } from "./commands.js";
import { pickFile as openFilePicker } from "./ui/file-picker.js";

export function registerPeekCommand(pi: any, deps: {
  getCtx: () => any;
  run: (command: any, argText?: string, ctx?: any) => Promise<void>;
  notify: (message: string, level?: "info" | "warning" | "error", force?: boolean) => void;
}): void {
  pi.registerCommand("peek", {
    description: "Peek commands: file, diff, path, past, sub, con, disconnect, settings, clear, status, debug",
    handler: async (args: string, ctx: any) => {
      const [subcommand, ...rest] = args.trim() ? args.trim().split(/\s+/) : [];
      const argText = rest.join(" ");
      if (!subcommand) {
        if (!ctx?.hasUI) return deps.notify(PEEK_USAGE, "info", true);
        const choice = await openFilePicker(ctx, MENU_PEEK_COMMANDS.map((command) => ({ value: command, label: command })), "Peek");
        if (!choice) return;
        const [picked] = choice.split(/\s+/);
        return isPeekCommand(picked) ? deps.run(picked, "", ctx) : deps.notify(`Unknown /peek subcommand: ${picked}`, "warning", true);
      }
      return isPeekCommand(subcommand) ? deps.run(subcommand, argText, ctx) : deps.notify(`Unknown /peek subcommand: ${subcommand}`, "warning", true);
    },
  });
}
