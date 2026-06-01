import { EXTENSION_ID } from "../defaults.js";
import { formatPresenceLabel } from "../helpers.js";
import type { PeekPresence } from "../types.js";

export function updatePeekStatus(ctx: any, debugEnabled: boolean, state: {
  refresh: () => void;
  getActivePeer: () => PeekPresence | undefined;
  getInboundPeer: () => PeekPresence | undefined;
  isSubscribed: boolean;
  autoConnectPaused: boolean;
}): void {
  if (!ctx?.hasUI) return;
  if (!debugEnabled) {
    ctx.ui.setStatus(EXTENSION_ID, undefined);
    return;
  }
  state.refresh();
  const activePeer = state.getActivePeer();
  const inboundPeer = state.getInboundPeer();
  const connected = activePeer ? `con:${formatPresenceLabel(activePeer, true)}` : "con:none";
  const subscribed = state.isSubscribed ? `sub:${inboundPeer ? formatPresenceLabel(inboundPeer, true) : "yes"}` : "sub:no";
  const paused = state.autoConnectPaused ? " paused:yes" : "";
  ctx.ui.setStatus(EXTENSION_ID, ctx.ui.theme.fg("accent", `peek ${connected} ${subscribed}${paused} debug:on`));
}
