import type { Participant, ReactionKind } from "./types.js";

export const PROTOCOL_VERSION = 1 as const;

// ---------- Client → Server ----------

export interface JoinRoomMsg {
  version: typeof PROTOCOL_VERSION;
  type: "join_room";
  roomId: string;
  clientId: string;
  name: string;
}

export interface ResumeSessionMsg {
  version: typeof PROTOCOL_VERSION;
  type: "resume_session";
  roomId: string;
  clientId: string;
  name: string;
  lastSeq: number;
}

export interface CursorUpdateMsg {
  version: typeof PROTOCOL_VERSION;
  type: "cursor_update";
  clientId: string;
  seq: number;
  x: number;
  y: number;
  timestamp: number;
}

export interface ReactionMsg {
  version: typeof PROTOCOL_VERSION;
  type: "reaction";
  clientId: string;
  eventId: string;
  x: number;
  y: number;
  kind: ReactionKind;
  timestamp: number;
}

export interface PingMsg {
  version: typeof PROTOCOL_VERSION;
  type: "ping";
  t: number;
}

export type ClientMessage =
  | JoinRoomMsg
  | ResumeSessionMsg
  | CursorUpdateMsg
  | ReactionMsg
  | PingMsg;

// ---------- Server → Client ----------

export interface ConnectionAckMsg {
  version: typeof PROTOCOL_VERSION;
  type: "connection_ack";
  clientId: string;
  serverTime: number;
}

export interface RoomStateMsg {
  version: typeof PROTOCOL_VERSION;
  type: "room_state";
  roomId: string;
  selfId: string;
  participants: Participant[];
  serverTime: number;
}

export interface ParticipantJoinedMsg {
  version: typeof PROTOCOL_VERSION;
  type: "participant_joined";
  participant: Participant;
}

export interface ParticipantLeftMsg {
  version: typeof PROTOCOL_VERSION;
  type: "participant_left";
  clientId: string;
  reason: "left" | "timeout" | "superseded";
}

export interface ServerCursorUpdateMsg {
  version: typeof PROTOCOL_VERSION;
  type: "cursor_update";
  clientId: string;
  seq: number;
  x: number;
  y: number;
  timestamp: number;
}

export interface ServerReactionMsg {
  version: typeof PROTOCOL_VERSION;
  type: "reaction";
  clientId: string;
  eventId: string;
  x: number;
  y: number;
  kind: ReactionKind;
  timestamp: number;
}

export interface ErrorMsg {
  version: typeof PROTOCOL_VERSION;
  type: "error";
  code: string;
  message: string;
}

export interface PongMsg {
  version: typeof PROTOCOL_VERSION;
  type: "pong";
  t: number;
  serverTime: number;
}

export type ServerMessage =
  | ConnectionAckMsg
  | RoomStateMsg
  | ParticipantJoinedMsg
  | ParticipantLeftMsg
  | ServerCursorUpdateMsg
  | ServerReactionMsg
  | ErrorMsg
  | PongMsg;
