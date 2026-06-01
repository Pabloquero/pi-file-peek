import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_PEEK_SETTINGS } from "./defaults.js";
import type { DebugFn, PeekConnection, PeekDirs, PeekPresence, PeekSettings } from "./types.js";
import { comparePresenceFreshness, isPeerLive, safeReadJson, workspaceKey } from "./helpers.js";

type BuildPresence = () => PeekPresence;

export class ConnectionStore {
  activePeer: PeekPresence | undefined;
  isSubscribed = false;
  autoConnectSuppressed = false;
  settings: PeekSettings = DEFAULT_PEEK_SETTINGS;

  constructor(
    private readonly dirs: PeekDirs,
    private readonly endpointId: string,
    private readonly flushPresence: () => void,
    private readonly buildLocalPresence: BuildPresence,
    private readonly pushDebug: DebugFn,
  ) {}

  listLivePeers(): PeekPresence[] {
    const files = fs.readdirSync(this.dirs.presence, { withFileTypes: true });
    const peers = files.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => safeReadJson<PeekPresence>(path.join(this.dirs.presence, entry.name)))
      .filter((item): item is PeekPresence => !!item)
      .filter((item) => item.endpoint_id !== this.endpointId)
      .filter(isPeerLive);
    const deduped = new Map<string, PeekPresence>();
    for (const peer of peers.sort(comparePresenceFreshness)) {
      const key = peer.session_file || peer.session_id || `${peer.workspace || ""}::${peer.endpoint_id}`;
      if (!deduped.has(key)) deduped.set(key, peer);
    }
    return [...deduped.values()].sort(comparePresenceFreshness);
  }

  private getConnectionPath(fromEndpointId: string, toEndpointId: string): string {
    return path.join(this.dirs.connections, `${fromEndpointId}__to__${toEndpointId}.json`);
  }

  private getReconnectPath(): string | undefined {
    const sessionFile = this.buildLocalPresence().session_file;
    return sessionFile ? path.join(this.dirs.reconnects, `${workspaceKey(sessionFile)}.json`) : undefined;
  }

  private saveReconnectHint(peer: PeekPresence): void {
    const filePath = this.getReconnectPath();
    if (!filePath) return;
    fs.writeFileSync(filePath, JSON.stringify({ target_session_file: peer.session_file, target_session_id: peer.session_id, updated_at: new Date().toISOString() }, null, 2));
  }

  clearReconnectHint(): void {
    const filePath = this.getReconnectPath();
    if (!filePath) return;
    try { fs.unlinkSync(filePath); } catch {}
  }

  private listLiveConnections(): { filePath: string; connection: PeekConnection }[] {
    const presences = new Map(this.listLivePeers().map((peer) => [peer.endpoint_id, peer]));
    presences.set(this.endpointId, this.buildLocalPresence());
    return fs.readdirSync(this.dirs.connections, { withFileTypes: true }).flatMap((entry) => {
      if (!entry.isFile() || !entry.name.endsWith(".json")) return [];
      const filePath = path.join(this.dirs.connections, entry.name);
      const connection = safeReadJson<PeekConnection>(filePath);
      if (!connection?.from_endpoint_id || !connection?.to_endpoint_id || !presences.has(connection.from_endpoint_id) || !presences.has(connection.to_endpoint_id)) {
        try { fs.unlinkSync(filePath); } catch {}
        return [];
      }
      return [{ filePath, connection }];
    });
  }

  findOutboundConnection(endpoint = this.endpointId) { return this.listLiveConnections().find((item) => item.connection.from_endpoint_id === endpoint); }
  findInboundConnection(endpoint = this.endpointId) { return this.listLiveConnections().find((item) => item.connection.to_endpoint_id === endpoint); }

  disconnect(clearHint = true) {
    const current = this.findOutboundConnection();
    if (current) try { fs.unlinkSync(current.filePath); } catch {}
    this.activePeer = undefined;
    if (clearHint) this.clearReconnectHint();
    this.flushPresence();
  }

  disconnectAll(clearHint = true) {
    for (const item of this.listLiveConnections().filter((entry) => entry.connection.from_endpoint_id === this.endpointId || entry.connection.to_endpoint_id === this.endpointId)) {
      try { fs.unlinkSync(item.filePath); } catch {}
    }
    this.activePeer = undefined;
    if (clearHint) this.clearReconnectHint();
    this.flushPresence();
  }

  suppressAutoConnect() {
    this.autoConnectSuppressed = true;
  }

  resumeAutoConnect() {
    this.autoConnectSuppressed = false;
  }

  restoreActiveConnection() {
    const current = this.findOutboundConnection();
    if (!current) return (this.activePeer = undefined, this.flushPresence());
    this.activePeer = this.listLivePeers().find((peer) => peer.endpoint_id === current.connection.to_endpoint_id);
    if (!this.activePeer) try { fs.unlinkSync(current.filePath); } catch {}
    this.flushPresence();
  }

  acquireConnection(peer: PeekPresence): boolean {
    const existingSelf = this.findOutboundConnection();
    if (existingSelf) return existingSelf.connection.to_endpoint_id === peer.endpoint_id;
    if (this.findInboundConnection(peer.endpoint_id)) return false;
    const filePath = this.getConnectionPath(this.endpointId, peer.endpoint_id);
    try {
      const fd = fs.openSync(filePath, "wx");
      fs.writeFileSync(fd, JSON.stringify({ from_endpoint_id: this.endpointId, to_endpoint_id: peer.endpoint_id, created_at: new Date().toISOString() }, null, 2));
      fs.closeSync(fd);
      return true;
    } catch { return false; }
  }

  connectToPeer(peer: PeekPresence): boolean {
    if (!this.acquireConnection(peer)) return false;
    this.resumeAutoConnect();
    this.activePeer = peer;
    this.saveReconnectHint(peer);
    this.flushPresence();
    return true;
  }

  restoreReconnectHint(): boolean {
    const filePath = this.getReconnectPath();
    if (!filePath) return false;
    const hint = safeReadJson<{ target_session_file?: string; target_session_id?: string }>(filePath);
    if (!hint) return false;
    const peers = this.listLivePeers();
    const peer = peers.find((item) => hint.target_session_file && item.session_file === hint.target_session_file)
      || peers.find((item) => hint.target_session_id && item.session_id === hint.target_session_id);
    return peer ? this.connectToPeer(peer) : false;
  }

  pickConnectionCandidate(preferSubscribed = true): PeekPresence | undefined {
    const peers = this.listLivePeers().filter((peer) => !this.findInboundConnection(peer.endpoint_id));
    return preferSubscribed ? peers.find((peer) => peer.peek_subscribed) || peers[0] : peers[0];
  }

  getInboundPeer(): PeekPresence | undefined {
    const inbound = this.findInboundConnection();
    return inbound ? this.listLivePeers().find((peer) => peer.endpoint_id === inbound.connection.from_endpoint_id) : undefined;
  }

  refreshActivePeerFromPresence(): boolean {
    if (!this.activePeer) return false;
    const outbound = this.findOutboundConnection();
    if (!outbound || outbound.connection.to_endpoint_id !== this.activePeer.endpoint_id) {
      const previousEndpointId = this.activePeer.endpoint_id;
      this.activePeer = undefined;
      this.suppressAutoConnect();
      this.flushPresence();
      this.pushDebug(`cleared disconnected peer ${previousEndpointId}; auto-connect paused`);
      return false;
    }
    const previousEndpointId = this.activePeer.endpoint_id;
    const peers = this.listLivePeers();
    const sameEndpoint = peers.find((peer) => peer.endpoint_id === previousEndpointId);
    if (sameEndpoint) {
      this.activePeer = sameEndpoint;
      this.flushPresence();
      return true;
    }
    const replacement = this.activePeer.session_file ? peers.find((peer) => peer.session_file === this.activePeer!.session_file) : undefined;
    if (replacement) {
      this.disconnect(false);
      if (this.connectToPeer(replacement)) return this.pushDebug(`replaced stale peer ${previousEndpointId} -> ${replacement.endpoint_id}`), true;
    }
    this.disconnect(false);
    this.pushDebug(`cleared stale peer ${previousEndpointId}`);
    return false;
  }

  ensureAutoConnectBack() {
    if (this.autoConnectSuppressed || !this.settings.autoSub || !this.settings.autoCon || this.activePeer) return;
    const inboundPeer = this.getInboundPeer();
    if (inboundPeer && this.connectToPeer(inboundPeer)) this.pushDebug(`auto connected back to ${inboundPeer.endpoint_id}`);
  }

}
