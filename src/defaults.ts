import type { PeekSettings } from "./types.js";

export const EXTENSION_ID = "pi-file-peek";
export const EXTENSION_VERSION = "0.1.0";
export const HEARTBEAT_MS = 5000;
export const STALE_MS = 15000;

export const DEFAULT_PEEK_SETTINGS: PeekSettings = {
  autoSub: false,
  autoCon: false,
  debug: false,
  notifications: true,
  showHeader: true,
  showFooter: true,
  closeAll: false,
  autoDiff: false,
  customTools: [],
  extraLanguages: {},
  keys: {
    scrollUp: ["up"],
    scrollDown: ["down"],
    pageUp: ["pageUp"],
    pageDown: ["pageDown"],
    prevItem: ["left"],
    nextItem: ["right"],
    close: ["esc"],
  },
};
