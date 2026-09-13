import type { ClientMessage } from "./protocol.js";
import { PROTOCOL_VERSION } from "./protocol.js";
import { REACTION_KINDS, type ReactionKind } from "./types.js";

const ROOM_ID_RE = /^[a-z0-9-]{1,64}$/;
const CLIENT_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;
const EVENT_ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;
const MAX_NAME_LEN = 32;
const MAX_FRAME_BYTES = 4096;

export class ValidationError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isNormalized(v: unknown): v is number {
  return isFiniteNumber(v) && v >= 0 && v <= 1;
}

function isPositiveInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

export function parseClientMessage(raw: string): ClientMessage {
  if (raw.length > MAX_FRAME_BYTES) {
    throw new ValidationError("frame_too_large", "Message exceeds size limit");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ValidationError("bad_json", "Message is not valid JSON");
  }

  if (!isRecord(parsed)) {
    throw new ValidationError("bad_shape", "Message must be an object");
  }

  if (parsed.version !== PROTOCOL_VERSION) {
    throw new ValidationError("bad_version", "Unsupported protocol version");
  }

  const type = parsed.type;
  if (typeof type !== "string") {
    throw new ValidationError("bad_type", "Message type missing");
  }

  switch (type) {
    case "join_room":
      return validateJoinRoom(parsed);
    case "resume_session":
      return validateResumeSession(parsed);
    case "cursor_update":
      return validateCursorUpdate(parsed);
    case "reaction":
      return validateReaction(parsed);
    case "ping":
      return validatePing(parsed);
    default:
      throw new ValidationError(
        "unknown_type",
        `Unknown message type: ${type}`,
      );
  }
}

function validateRoomId(v: unknown): string {
  if (typeof v !== "string" || !ROOM_ID_RE.test(v)) {
    throw new ValidationError("bad_room_id", "Invalid room id");
  }
  return v;
}

function validateClientId(v: unknown): string {
  if (typeof v !== "string" || !CLIENT_ID_RE.test(v)) {
    throw new ValidationError("bad_client_id", "Invalid client id");
  }
  return v;
}

function validateName(v: unknown): string {
  if (typeof v !== "string") {
    throw new ValidationError("bad_name", "Name must be a string");
  }
  const trimmed = v.trim();
  if (trimmed.length < 1 || trimmed.length > MAX_NAME_LEN) {
    throw new ValidationError(
      "bad_name",
      `Name must be 1-${MAX_NAME_LEN} chars`,
    );
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new ValidationError("bad_name", "Name contains control characters");
  }
  return trimmed;
}

function validateJoinRoom(o: Record<string, unknown>) {
  return {
    version: PROTOCOL_VERSION,
    type: "join_room" as const,
    roomId: validateRoomId(o.roomId),
    clientId: validateClientId(o.clientId),
    name: validateName(o.name),
  };
}

function validateResumeSession(o: Record<string, unknown>) {
  if (!isPositiveInt(o.lastSeq)) {
    throw new ValidationError(
      "bad_seq",
      "lastSeq must be a non-negative integer",
    );
  }
  return {
    version: PROTOCOL_VERSION,
    type: "resume_session" as const,
    roomId: validateRoomId(o.roomId),
    clientId: validateClientId(o.clientId),
    name: validateName(o.name),
    lastSeq: o.lastSeq,
  };
}

function validateCursorUpdate(o: Record<string, unknown>) {
  if (!isPositiveInt(o.seq)) {
    throw new ValidationError("bad_seq", "seq must be a non-negative integer");
  }
  if (!isNormalized(o.x) || !isNormalized(o.y)) {
    throw new ValidationError("bad_coord", "x and y must be in [0, 1]");
  }
  if (!isFiniteNumber(o.timestamp)) {
    throw new ValidationError("bad_ts", "timestamp must be a number");
  }
  return {
    version: PROTOCOL_VERSION,
    type: "cursor_update" as const,
    clientId: validateClientId(o.clientId),
    seq: o.seq,
    x: o.x,
    y: o.y,
    timestamp: o.timestamp,
  };
}

function validateReaction(o: Record<string, unknown>) {
  if (!isNormalized(o.x) || !isNormalized(o.y)) {
    throw new ValidationError("bad_coord", "x and y must be in [0, 1]");
  }
  if (
    typeof o.kind !== "string" ||
    !REACTION_KINDS.includes(o.kind as ReactionKind)
  ) {
    throw new ValidationError("bad_kind", "Unknown reaction kind");
  }
  if (typeof o.eventId !== "string" || !EVENT_ID_RE.test(o.eventId)) {
    throw new ValidationError("bad_event_id", "Invalid event id");
  }
  if (!isFiniteNumber(o.timestamp)) {
    throw new ValidationError("bad_ts", "timestamp must be a number");
  }
  return {
    version: PROTOCOL_VERSION,
    type: "reaction" as const,
    clientId: validateClientId(o.clientId),
    eventId: o.eventId,
    x: o.x,
    y: o.y,
    kind: o.kind as ReactionKind,
    timestamp: o.timestamp,
  };
}

function validatePing(o: Record<string, unknown>) {
  if (!isFiniteNumber(o.t)) {
    throw new ValidationError("bad_ping", "ping.t must be a number");
  }
  return {
    version: PROTOCOL_VERSION,
    type: "ping" as const,
    t: o.t,
  };
}

// ---------- Server → Client (client-side use) ----------

export function parseServerMessage(
  raw: string,
): import("./protocol.js").ServerMessage {
  if (raw.length > MAX_FRAME_BYTES)
    throw new ValidationError("frame_too_large", "too big");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ValidationError("bad_json", "not json");
  }
  if (
    !isRecord(parsed) ||
    parsed.version !== PROTOCOL_VERSION ||
    typeof parsed.type !== "string"
  ) {
    throw new ValidationError("bad_shape", "invalid envelope");
  }
  // Trusted-server path: we accept the shape after envelope check.
  return parsed as unknown as import("./protocol.js").ServerMessage;
}

export function serialize(msg: unknown): string {
  return JSON.stringify(msg);
}
