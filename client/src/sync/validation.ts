import { PROTOCOL_VERSION, type ServerMessage } from './protocol.js';

const MAX_FRAME_BYTES = 4096;

export function parseServerMessage(raw: string): ServerMessage | null {
  if (raw.length > MAX_FRAME_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (parsed as { version?: unknown }).version !== PROTOCOL_VERSION ||
    typeof (parsed as { type?: unknown }).type !== 'string'
  ) {
    return null;
  }
  return parsed as ServerMessage;
}

export function serialize(msg: unknown): string {
  return JSON.stringify(msg);
}