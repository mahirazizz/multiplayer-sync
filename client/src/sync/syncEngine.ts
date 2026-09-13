import { Connection } from "./connection.js";
import { SendThrottler } from "./throttler.js";
import { smoothingAlpha, step } from "./interpolation.js";
import { parseServerMessage } from "./validation.js";
import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type Participant,
  type ServerMessage,
} from "./protocol.js";
import type {
  ConnectionStatus,
  ParticipantInfo,
  ReactionInstance,
  RemoteCursorState,
  SyncSnapshot,
} from "./types.js";

const REACTION_TTL_MS = 1200;
const LATENCY_PROBE_INTERVAL_MS = 2000;
const SMOOTHING = 0.2;

type Listener = () => void;

export interface SyncEngineOptions {
  url: string;
  clientId: string;
  roomId: string;
  name: string;
}

export class SyncEngine {
  private connection: Connection;
  private throttler: SendThrottler;
  private listeners = new Set<Listener>();
  private snapshot: SyncSnapshot;

  private remote = new Map<string, RemoteCursorState>();
  private participants = new Map<string, ParticipantInfo>();
  private reactions: ReactionInstance[] = [];

  private localX = 0.5;
  private localY = 0.5;
  private localSeq = 0;

  private rafId: number | null = null;
  private lastFrameAt = 0;
  private rafActive = false;

  private latencyTimer: ReturnType<typeof setInterval> | null = null;
  private lastLatency: number | null = null;
  private lastSentPos: { x: number; y: number } | null = null;

  private joinedOnce = false;

  constructor(private opts: SyncEngineOptions) {
    this.throttler = new SendThrottler(40);
    this.snapshot = this.buildSnapshot("idle", 0);

    this.connection = new Connection(opts.url, {
      onOpen: () => this.handleOpen(),
      onMessage: (raw) => this.handleMessage(raw),
      onClose: () => this.handleClose(),
      onError: (msg) => this.setState({ lastError: msg }),
      onStatusChange: (s, attempt) => {
        const snap = this.buildSnapshot(s, attempt);
        this.snapshot = snap;
        this.emit();
      },
    });
  }

  // ---------- Public API ----------

  start(): void {
    this.connection.connect();
    this.latencyTimer = setInterval(
      () => this.probeLatency(),
      LATENCY_PROBE_INTERVAL_MS,
    );
  }

  stop(): void {
    this.connection.disconnect();
    if (this.latencyTimer) clearInterval(this.latencyTimer);
    this.throttler.cancel();
    this.stopRaf();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getSnapshot(): SyncSnapshot {
    return this.snapshot;
  }

  getLocalSeq(): number {
    return this.localSeq;
  }

  /** Pointer move inside surface; coordinates are normalized [0,1]. */
  setLocalCursor(x: number, y: number): void {
    this.localX = clamp01(x);
    this.localY = clamp01(y);
    // Immediate render
    this.snapshot = this.buildSnapshot(
      this.connection.getStatus(),
      this.connection.getAttempt(),
    );
    this.emit();

    this.throttler.schedule(() => this.flushCursor());
  }

  /** Pointer left the surface: send final position so remotes freeze cleanly. */
  freezeLocalCursor(): void {
    this.throttler.flushNow();
  }

  /** Send a discrete reaction at normalized position. */
  sendReaction(kind: "heart" | "clap" | "fire", x: number, y: number): void {
    if (this.connection.getStatus() !== "connected") return;
    const eventId = genId();
    const msg: ClientMessage = {
      version: PROTOCOL_VERSION,
      type: "reaction",
      clientId: this.opts.clientId,
      eventId,
      x: clamp01(x),
      y: clamp01(y),
      kind,
      timestamp: Date.now(),
    };
    this.connection.send(msg);
    // Optimistic local render; dedup on echo via eventId
    this.pushReaction({
      id: eventId,
      clientId: this.opts.clientId,
      x: clamp01(x),
      y: clamp01(y),
      kind,
      spawnedAt: performance.now(),
    });
  }

  // ---------- Internal ----------

  private handleOpen(): void {
    const msg: ClientMessage = this.joinedOnce
      ? {
          version: PROTOCOL_VERSION,
          type: "resume_session",
          roomId: this.opts.roomId,
          clientId: this.opts.clientId,
          name: this.opts.name,
          lastSeq: this.localSeq,
        }
      : {
          version: PROTOCOL_VERSION,
          type: "join_room",
          roomId: this.opts.roomId,
          clientId: this.opts.clientId,
          name: this.opts.name,
        };
    this.connection.send(msg);
    this.joinedOnce = true;
  }

  private handleClose(): void {
    // Remote cursors freeze; they will be replaced by room_state on reconnect.
    this.setState({});
  }

  private handleMessage(raw: string): void {
    const msg = parseServerMessage(raw);
    if (!msg) return;

    switch (msg.type) {
      case "connection_ack": {
        this.setState({ selfId: msg.clientId });
        return;
      }
      case "room_state": {
        this.applyRoomState(msg);
        return;
      }
      case "participant_joined": {
        this.applyParticipantJoined(msg.participant);
        return;
      }
      case "participant_left": {
        this.remote.delete(msg.clientId);
        this.participants.delete(msg.clientId);
        this.ensureRaf();
        this.setState({});
        return;
      }
      case "cursor_update": {
        this.applyCursorUpdate(msg.clientId, msg.seq, msg.x, msg.y);
        return;
      }
      case "reaction": {
        // dedup: if we already rendered (optimistic) skip
        if (this.reactions.some((r) => r.id === msg.eventId)) return;
        this.pushReaction({
          id: msg.eventId,
          clientId: msg.clientId,
          x: msg.x,
          y: msg.y,
          kind: msg.kind,
          spawnedAt: performance.now(),
        });
        return;
      }
      case "error": {
        this.setState({ lastError: `${msg.code}: ${msg.message}` });
        return;
      }
      case "pong": {
        this.lastLatency = Math.max(0, Date.now() - msg.t);
        this.setState({});
        return;
      }
    }
  }

  private applyRoomState(
    msg: Extract<ServerMessage, { type: "room_state" }>,
  ): void {
    this.remote.clear();
    this.participants.clear();
    for (const p of msg.participants) {
      this.participants.set(p.clientId, {
        clientId: p.clientId,
        name: p.name,
        color: p.color,
      });
      if (p.clientId === this.opts.clientId) {
        // self entry — capture color
        this.setState({ selfColor: p.color });
        continue;
      }
      this.remote.set(p.clientId, {
        clientId: p.clientId,
        name: p.name,
        color: p.color,
        currentX: p.x,
        currentY: p.y,
        targetX: p.x,
        targetY: p.y,
        lastSeq: p.lastSeq,
        lastUpdateAt: performance.now(),
      });
    }
    this.ensureRaf();
    this.setState({});
  }

  private applyParticipantJoined(p: Participant): void {
    this.participants.set(p.clientId, {
      clientId: p.clientId,
      name: p.name,
      color: p.color,
    });
    if (p.clientId !== this.opts.clientId) {
      this.remote.set(p.clientId, {
        clientId: p.clientId,
        name: p.name,
        color: p.color,
        currentX: p.x,
        currentY: p.y,
        targetX: p.x,
        targetY: p.y,
        lastSeq: p.lastSeq,
        lastUpdateAt: performance.now(),
      });
      this.ensureRaf();
    }
    this.setState({});
  }

  private applyCursorUpdate(
    clientId: string,
    seq: number,
    x: number,
    y: number,
  ): void {
    if (clientId === this.opts.clientId) return;
    const cur = this.remote.get(clientId);
    if (!cur) {
      // Unknown client — ignore until room_state or participant_joined
      return;
    }
    if (seq <= cur.lastSeq) return; // stale
    cur.lastSeq = seq;
    cur.targetX = clamp01(x);
    cur.targetY = clamp01(y);
    cur.lastUpdateAt = performance.now();
    this.ensureRaf();
  }

  private pushReaction(r: ReactionInstance): void {
    this.reactions.push(r);
    this.setState({});
    // Schedule removal
    setTimeout(() => {
      this.reactions = this.reactions.filter((x) => x.id !== r.id);
      this.setState({});
    }, REACTION_TTL_MS);
  }

  private flushCursor(): void {
    if (this.connection.getStatus() !== "connected") return;
    const { x, y } = { x: this.localX, y: this.localY };
    if (
      this.lastSentPos &&
      Math.abs(this.lastSentPos.x - x) < 1e-4 &&
      Math.abs(this.lastSentPos.y - y) < 1e-4
    ) {
      return; // no change
    }
    this.lastSentPos = { x, y };
    this.localSeq += 1;
    const msg: ClientMessage = {
      version: PROTOCOL_VERSION,
      type: "cursor_update",
      clientId: this.opts.clientId,
      seq: this.localSeq,
      x,
      y,
      timestamp: Date.now(),
    };
    this.connection.send(msg);
  }

  private probeLatency(): void {
    if (this.connection.getStatus() !== "connected") return;
    this.connection.send({
      version: PROTOCOL_VERSION,
      type: "ping",
      t: Date.now(),
    });
  }

  // ---------- Animation loop ----------

  private ensureRaf(): void {
    if (this.rafActive) return;
    this.rafActive = true;
    this.lastFrameAt = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  private stopRaf(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.rafActive = false;
  }

  private tick = (now: number): void => {
    const dt = Math.min(64, now - this.lastFrameAt);
    this.lastFrameAt = now;
    const alpha = smoothingAlpha(SMOOTHING, dt);

    let allSettled = true;
    for (const c of this.remote.values()) {
      c.currentX = step(c.currentX, c.targetX, alpha);
      c.currentY = step(c.currentY, c.targetY, alpha);
      if (
        Math.abs(c.targetX - c.currentX) > 1e-3 ||
        Math.abs(c.targetY - c.currentY) > 1e-3
      ) {
        allSettled = false;
      }
    }

    if (this.remote.size === 0) {
      this.rafActive = false;
      this.rafId = null;
      return;
    }

    // Publish rendered frame to subscribers
    this.snapshot = this.buildSnapshot(
      this.connection.getStatus(),
      this.connection.getAttempt(),
    );
    this.emit();

    if (!allSettled) {
      this.rafId = requestAnimationFrame(this.tick);
    } else {
      this.rafActive = false;
      this.rafId = null;
    }
  };

  // ---------- Snapshot ----------

  private buildSnapshot(
    status: ConnectionStatus,
    attempt: number,
  ): SyncSnapshot {
    const cursors: RemoteCursorState[] = [];
    for (const c of this.remote.values()) {
      cursors.push({
        clientId: c.clientId,
        name: c.name,
        color: c.color,
        currentX: c.currentX,
        currentY: c.currentY,
        targetX: c.targetX,
        targetY: c.targetY,
        lastSeq: c.lastSeq,
        lastUpdateAt: c.lastUpdateAt,
      });
    }
    const participants = [...this.participants.values()];
    return {
      status,
      roomId: this.opts.roomId,
      selfId: this.opts.clientId,
      selfColor: this.snapshot?.selfColor ?? "#94A3B8",
      selfName: this.opts.name,
      participants,
      cursors,
      reactions: this.reactions.slice(),
      latencyMs: this.lastLatency,
      sendRateHz: this.throttler.getHz(),
      attempt,
      lastError: this.snapshot?.lastError ?? null,
    };
  }

  private setState(patch: Partial<SyncSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

function genId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
  }
  return (
    Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  );
}
