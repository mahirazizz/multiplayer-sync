export type ReactionKind = "heart" | "clap" | "fire";

export const REACTION_KINDS: readonly ReactionKind[] = [
  "heart",
  "clap",
  "fire",
];

export interface Participant {
  clientId: string;
  name: string;
  color: string;
  x: number;
  y: number;
  lastSeq: number;
}

export interface ClientSession {
  ws: import("ws").WebSocket;
  clientId: string;
  roomId: string | null;
  name: string;
  color: string;
  x: number;
  y: number;
  lastSeq: number;
  lastSeen: number;
  isAlive: boolean;
  joinedAt: number;
}

export interface Room {
  roomId: string;
  clients: Map<string, ClientSession>;
  createdAt: number;
  emptySince: number | null;
}
