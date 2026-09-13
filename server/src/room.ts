import type { WebSocket } from "ws";
import type { ClientSession, Participant, Room } from "./types.js";
import { serialize } from "./validation.js";
import { PROTOCOL_VERSION, type ServerMessage } from "./protocol.js";

const EMPTY_ROOM_TTL_MS = 60_000;
const COLOR_PALETTE = [
  "#F87171",
  "#FBBF24",
  "#34D399",
  "#60A5FA",
  "#A78BFA",
  "#F472B6",
  "#22D3EE",
  "#FACC15",
  "#FB923C",
  "#4ADE80",
];

export class RoomManager {
  private rooms = new Map<string, Room>();
  private sockets = new Map<WebSocket, ClientSession>();

  getSession(ws: WebSocket): ClientSession | undefined {
    return this.sockets.get(ws);
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  roomCount(): number {
    return this.rooms.size;
  }

  clientCount(): number {
    return this.sockets.size;
  }

  private pickColor(room: Room): string {
    const used = new Set<string>();
    for (const c of room.clients.values()) used.add(c.color);
    for (const c of COLOR_PALETTE) if (!used.has(c)) return c;
    return COLOR_PALETTE[Math.floor(Math.random() * COLOR_PALETTE.length)]!;
  }

  /**
   * Add or replace a session for a clientId within a room.
   * If an existing socket for the same clientId is present, it is superseded.
   */
  join(
    ws: WebSocket,
    clientId: string,
    roomId: string,
    name: string,
    isResume: boolean,
    resumeLastSeq = 0,
  ): {
    session: ClientSession;
    isNew: boolean;
    supersededColor: string | null;
  } {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = {
        roomId,
        clients: new Map(),
        createdAt: Date.now(),
        emptySince: null,
      };
      this.rooms.set(roomId, room);
    }

    const existing = room.clients.get(clientId);
    let color: string;
    let x = 0.5;
    let y = 0.5;
    let supersededColor: string | null = null;

    if (existing && isResume) {
      color = existing.color;
      x = existing.x;
      y = existing.y;
      // Terminate stale socket
      try {
        existing.ws.close(4001, "superseded");
      } catch {
        /* ignore */
      }
      this.sockets.delete(existing.ws);
      supersededColor = existing.color;
    } else if (existing) {
      // Same client ID re-joining fresh: reuse color
      color = existing.color;
      try {
        existing.ws.close(4001, "superseded");
      } catch {
        /* ignore */
      }
      this.sockets.delete(existing.ws);
      supersededColor = existing.color;
    } else {
      color = this.pickColor(room);
    }

    const session: ClientSession = {
      ws,
      clientId,
      roomId,
      name,
      color,
      x,
      y,
      lastSeq: isResume ? resumeLastSeq : 0,
      lastSeen: Date.now(),
      isAlive: true,
      joinedAt: Date.now(),
    };

    room.clients.set(clientId, session);
    room.emptySince = null;
    this.sockets.set(ws, session);

    return { session, isNew: !existing, supersededColor };
  }

  /**
   * Remove a client. Idempotent: safe to call multiple times.
   * Returns the removed session (or undefined) and whether the room was deleted.
   */
  remove(ws: WebSocket): {
    session: ClientSession | undefined;
    roomDeleted: boolean;
  } {
    const session = this.sockets.get(ws);
    if (!session) return { session: undefined, roomDeleted: false };
    this.sockets.delete(ws);

    const roomId = session.roomId;
    if (!roomId) return { session, roomDeleted: false };

    const room = this.rooms.get(roomId);
    if (!room) return { session, roomDeleted: false };

    // Only remove if the current session matches — guards against supersede races
    const current = room.clients.get(session.clientId);
    if (current && current.ws === ws) {
      room.clients.delete(session.clientId);
    }

    let roomDeleted = false;
    if (room.clients.size === 0) {
      room.emptySince = Date.now();
    }

    return { session, roomDeleted };
  }

  broadcast(roomId: string, msg: ServerMessage, exceptClientId?: string): void {
    const room = this.rooms.get(roomId);
    if (!room) return;
    const payload = serialize(msg);
    for (const c of room.clients.values()) {
      if (exceptClientId && c.clientId === exceptClientId) continue;
      if (c.ws.readyState === c.ws.OPEN) {
        try {
          c.ws.send(payload);
        } catch {
          /* ignore per-socket errors */
        }
      }
    }
  }

  send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState !== ws.OPEN) return;
    try {
      ws.send(serialize(msg));
    } catch {
      /* ignore */
    }
  }

  participants(roomId: string): Participant[] {
    const room = this.rooms.get(roomId);
    if (!room) return [];
    return [...room.clients.values()].map((c) => ({
      clientId: c.clientId,
      name: c.name,
      color: c.color,
      x: c.x,
      y: c.y,
      lastSeq: c.lastSeq,
    }));
  }

  updateCursor(
    session: ClientSession,
    seq: number,
    x: number,
    y: number,
  ): boolean {
    if (seq <= session.lastSeq) return false;
    session.lastSeq = seq;
    session.x = x;
    session.y = y;
    session.lastSeen = Date.now();
    return true;
  }

  touch(session: ClientSession): void {
    session.lastSeen = Date.now();
  }

  sweepEmptyRooms(): void {
    const now = Date.now();
    for (const [id, room] of this.rooms) {
      if (
        room.clients.size === 0 &&
        room.emptySince &&
        now - room.emptySince > EMPTY_ROOM_TTL_MS
      ) {
        this.rooms.delete(id);
      }
    }
  }

  allSockets(): IterableIterator<ClientSession> {
    return this.sockets.values();
  }

  buildRoomState(roomId: string, selfId: string): ServerMessage {
    return {
      version: PROTOCOL_VERSION,
      type: "room_state",
      roomId,
      selfId,
      participants: this.participants(roomId),
      serverTime: Date.now(),
    };
  }

  buildJoined(participant: Participant): ServerMessage {
    return {
      version: PROTOCOL_VERSION,
      type: "participant_joined",
      participant,
    };
  }

  buildLeft(
    clientId: string,
    reason: "left" | "timeout" | "superseded",
  ): ServerMessage {
    return {
      version: PROTOCOL_VERSION,
      type: "participant_left",
      clientId,
      reason,
    };
  }
}
