export const MENU_PEEK_COMMANDS = ["file", "past", "sub", "con", "disconnect", "settings", "clear", "status", "debug"] as const;
export const PUBLIC_PEEK_COMMANDS = ["file", "path", "past", "sub", "con", "disconnect", "settings", "clear", "status", "debug"] as const;
export const LEGACY_PEEK_COMMANDS = ["unsub", "discon"] as const;
export const PEEK_COMMANDS = [...PUBLIC_PEEK_COMMANDS, ...LEGACY_PEEK_COMMANDS] as const;
export type PeekCommand = typeof PEEK_COMMANDS[number];

export function isPeekCommand(value: string | undefined): value is PeekCommand {
  return !!value && (PEEK_COMMANDS as readonly string[]).includes(value);
}

export const PEEK_USAGE = `Usage: /peek ${PUBLIC_PEEK_COMMANDS.join("|")} [path]`;
