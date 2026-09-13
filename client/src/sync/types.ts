export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export interface RemoteCursorState {
  clientId: string;
  name: string;
  color: string;
  currentX: number;
  currentY: number;
  targetX: number;
  targetY: number;
  lastSeq: number;
  lastUpdateAt: number;
}

export interface ParticipantInfo {
  clientId: string;
  name: string;
  color: string;
}

export interface ReactionInstance {
  id: string;
  clientId: string;
  x: number;
  y: number;
  kind: "heart" | "clap" | "fire";
  spawnedAt: number;
}

export interface SyncSnapshot {
  status: ConnectionStatus;
  roomId: string | null;
  selfId: string;
  selfColor: string;
  selfName: string;
  participants: ParticipantInfo[];
  cursors: RemoteCursorState[]; // immutable snapshots
  reactions: ReactionInstance[];
  latencyMs: number | null;
  sendRateHz: number;
  attempt: number;
  lastError: string | null;
}
