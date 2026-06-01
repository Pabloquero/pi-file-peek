export type PeekPresence = {
  endpoint_id: string;
  session_id?: string;
  session_file?: string;
  workspace?: string;
  started_at: string;
  last_seen: string;
  peek_subscribed: boolean;
  connected_endpoint_id?: string;
  extension_version: string;
};

export type PeekConnection = {
  from_endpoint_id: string;
  to_endpoint_id: string;
  created_at: string;
};

export type PeekSettings = {
  autoSub: boolean;
  autoCon: boolean;
  debug: boolean;
  notifications: boolean;
  showHeader: boolean;
  showFooter: boolean;
  closeAll: boolean;
  keys: PeekKeySettings;
  customTools: PeekCustomTool[];
};

export type PeekCustomTool = {
  tool: string;
  from: "input" | "output";
  field?: string;
  mode: "path" | "text" | "patch";
  actions?: Array<"add" | "update" | "delete">;
};

export type PeekKeyAction = "scrollUp" | "scrollDown" | "pageUp" | "pageDown" | "close";

export type PeekKeySettings = Record<PeekKeyAction, string[]>;

export type PeekEnvelope = {
  schema: "pi-peek-message/v1";
  kind: "text" | "file-ref";
  message_id: string;
  to_endpoint_id: string;
  to_session_id?: string;
  from_endpoint_id: string;
  from_session_id?: string;
  from_workspace?: string;
  timestamp: string;
  tag?: string;
  message?: string;
  path?: string;
};

export type FileStat = {
  path: string;
  score: number;
  touchCount: number;
  lastTouchedAt: string;
  lastAction: string;
};

export type HljsApi = {
  highlight: (code: string, options: { language: string; ignoreIllegals?: boolean }) => { value: string };
  getLanguage: (name: string) => unknown;
  registerLanguage: (name: string, language: unknown) => void;
};

export type PeekDirs = {
  root: string;
  presence: string;
  inbox: string;
  processed: string;
  tmp: string;
  trackedFiles: string;
  connections: string;
  reconnects: string;
};

export type NotifyFn = (message: string, level?: "info" | "warning" | "error") => void;
export type DebugFn = (line: string) => void;
