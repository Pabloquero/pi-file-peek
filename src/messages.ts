import * as fs from "node:fs";
import * as path from "node:path";
import { isoFilenamePart, randomId } from "./helpers.js";
import type { PeekDirs, PeekEnvelope, PeekPresence } from "./types.js";

export type OutgoingPeekPayload = Omit<PeekEnvelope, "schema" | "message_id" | "from_endpoint_id" | "from_session_id" | "from_workspace" | "timestamp" | "to_endpoint_id" | "to_session_id">;

export function createOutgoingEnvelope(input: {
  payload: OutgoingPeekPayload;
  peer: PeekPresence;
  endpointId: string;
  sessionId?: string;
  workspace?: string;
}): PeekEnvelope {
  const now = new Date().toISOString();
  return {
    schema: "pi-peek-message/v1",
    kind: input.payload.kind,
    message_id: randomId("msg"),
    to_endpoint_id: input.peer.endpoint_id,
    to_session_id: input.peer.session_id,
    from_endpoint_id: input.endpointId,
    from_session_id: input.sessionId,
    from_workspace: input.workspace,
    timestamp: now,
    tag: input.payload.tag,
    message: input.payload.message,
    path: input.payload.path,
  };
}

export function writeEnvelope(dirs: PeekDirs, message: PeekEnvelope): void {
  const base = `${isoFilenamePart(message.timestamp)}__to=${message.to_endpoint_id}__from=${message.from_endpoint_id}__${message.message_id}`;
  const tmpFile = path.join(dirs.tmp, `${base}.tmp`);
  const finalFile = path.join(dirs.inbox, `${base}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify(message, null, 2));
  fs.renameSync(tmpFile, finalFile);
}
