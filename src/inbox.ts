import * as fs from "node:fs";
import * as path from "node:path";
import type { PeekDirs } from "./types.js";

export function startInboxWatcher(dirs: PeekDirs, onFile: (filePath: string) => void): fs.FSWatcher {
  return fs.watch(dirs.inbox, (_eventType, filename) => {
    if (filename?.toString().endsWith(".json")) setTimeout(() => onFile(path.join(dirs.inbox, filename.toString())), 25);
  });
}

export function scanInbox(dirs: PeekDirs, onFile: (filePath: string) => void): void {
  for (const entry of fs.readdirSync(dirs.inbox, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".json")) onFile(path.join(dirs.inbox, entry.name));
  }
}
