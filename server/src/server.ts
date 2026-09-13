import http from "node:http";
import {
  WebSocketServer,
  type VerifyClientCallbackSync,
  type WebSocket,
} from "ws";
import { RoomManager } from "./room.js";
import {
  parseClientMessage,
  serialize,
  ValidationError,
} from "./validation.js";
import { PROTOCOL_VERSION, type ServerMessage } from "./protocol.js";

const PORT = Number(process.env.PORT ?? 8080);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? "*";

const HEARTBEAT_INTERVAL_MS = 15_000;
const SWEEP_INTERVAL_MS = 30_000;
const MAX_BUFFERED_BYTES = 1_000_000; // backpressure guard

const rooms = new RoomManager();

const httpServer = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        rooms: rooms.roomCount(),
        clients: rooms.clientCount(),
      }),
    );
    return;
  }
  res.writeHead(404);
  res.end();
});

const wss = new WebSocketServer({
  server: httpServer,
  maxPayload: 4096,
  verifyClient: (info: Parameters<VerifyClientCallbackSync>[0]) => {
    if (ALLOWED_ORIGIN === "*") return true;
    const origin = info.origin;
    return origin === ALLOWED_ORIGIN;
  },
});

function sendError(ws: WebSocket, code: string, message: string): void {
  const msg: ServerMessage = {
    version: PROTOCOL_VERSION,
    type: "error",
    code,
    message,
  };
  if (ws.readyState === ws.OPEN) {
    try {
      ws.send(serialize(msg));
    } catch {
      /* ignore */
    }
  }
}

wss.on("connection", (ws) => {
  console.log("[ws] connection opened");
  ws.binaryType = "nodebuffer";

  ws.on("message", (data, isBinary) => {
    if (isBinary) {
      sendError(ws, "binary_not_supported", "Binary frames are not supported");
      return;
    }
    let text: string;
    if (typeof data === "string") text = data;
    else if (Buffer.isBuffer(data)) text = data.toString("utf8");
    else if (Array.isArray(data)) text = Buffer.concat(data).toString("utf8");
    else text = String(data);

    let msg;
    try {
      msg = parseClientMessage(text);
    } catch (err) {
      if (err instanceof ValidationError) {
        console.warn("[ws] rejected:", err.code);
        sendError(ws, err.code, "Invalid message");
      } else {
        console.error("[ws] unexpected validation failure", err);
        sendError(ws, "internal", "Internal error");
      }
      return;
    }

    handleMessage(ws, msg);
  });

  ws.on("close", () => handleClose(ws, "left"));
  ws.on("error", (err) => {
    console.warn("[ws] socket error:", (err as Error).message);
    handleClose(ws, "left");
  });

  // heartbeat bookkeeping
  (ws as unknown as { isAlive?: boolean }).isAlive = true;
  ws.on("pong", () => {
    (ws as unknown as { isAlive?: boolean }).isAlive = true;
    const session = rooms.getSession(ws);
    if (session) rooms.touch(session);
  });
});

function handleMessage(
  ws: WebSocket,
  msg: ReturnType<typeof parseClientMessage>,
): void {
  switch (msg.type) {
    case "join_room":
    case "resume_session": {
      const existing = rooms.getSession(ws);
      if (existing && existing.roomId && existing.roomId !== msg.roomId) {
        sendError(ws, "already_in_room", "Already in a different room");
        return;
      }

      const isResume = msg.type === "resume_session";
      const { session, isNew } = rooms.join(
        ws,
        msg.clientId,
        msg.roomId,
        msg.name,
        isResume,
        isResume ? msg.lastSeq : 0,
      );

      rooms.send(ws, {
        version: PROTOCOL_VERSION,
        type: "connection_ack",
        clientId: session.clientId,
        serverTime: Date.now(),
      });
      rooms.send(ws, rooms.buildRoomState(msg.roomId, session.clientId));

      if (isNew) {
        rooms.broadcast(
          msg.roomId,
          rooms.buildJoined({
            clientId: session.clientId,
            name: session.name,
            color: session.color,
            x: session.x,
            y: session.y,
            lastSeq: session.lastSeq,
          }),
          session.clientId,
        );
      }
      console.log(
        `[room] ${session.clientId} ${isResume ? "resumed" : "joined"} ${msg.roomId}`,
      );
      return;
    }

    case "cursor_update": {
      const session = rooms.getSession(ws);
      if (!session || !session.roomId) {
        sendError(ws, "not_in_room", "Join a room first");
        return;
      }
      if (session.clientId !== msg.clientId) {
        sendError(ws, "client_mismatch", "clientId does not match session");
        return;
      }
      const accepted = rooms.updateCursor(session, msg.seq, msg.x, msg.y);
      if (!accepted) return; // stale — silently drop
      rooms.broadcast(
        session.roomId,
        {
          version: PROTOCOL_VERSION,
          type: "cursor_update",
          clientId: session.clientId,
          seq: msg.seq,
          x: msg.x,
          y: msg.y,
          timestamp: msg.timestamp,
        },
        session.clientId, // no echo to sender
      );
      return;
    }

    case "reaction": {
      const session = rooms.getSession(ws);
      if (!session || !session.roomId) {
        sendError(ws, "not_in_room", "Join a room first");
        return;
      }
      if (session.clientId !== msg.clientId) {
        sendError(ws, "client_mismatch", "clientId does not match session");
        return;
      }
      rooms.broadcast(session.roomId, {
        version: PROTOCOL_VERSION,
        type: "reaction",
        clientId: session.clientId,
        eventId: msg.eventId,
        x: msg.x,
        y: msg.y,
        kind: msg.kind,
        timestamp: msg.timestamp,
      }); // broadcast includes sender so all clients converge on ordering
      return;
    }

    case "ping": {
      const session = rooms.getSession(ws);
      if (session) rooms.touch(session);
      rooms.send(ws, {
        version: PROTOCOL_VERSION,
        type: "pong",
        t: msg.t,
        serverTime: Date.now(),
      });
      return;
    }
  }
}

const closing = new WeakSet<WebSocket>();

function handleClose(
  ws: WebSocket,
  reason: "left" | "timeout" | "superseded",
): void {
  if (closing.has(ws)) return;
  closing.add(ws);
  const { session } = rooms.remove(ws);
  if (session && session.roomId) {
    rooms.broadcast(session.roomId, rooms.buildLeft(session.clientId, reason));
    console.log(
      `[room] ${session.clientId} left ${session.roomId} (${reason})`,
    );
  }
}

// heartbeat
setInterval(() => {
  for (const session of rooms.allSockets()) {
    const ws = session.ws;
    const state = ws as unknown as { isAlive?: boolean };
    if (state.isAlive === false) {
      console.warn(`[ws] heartbeat timeout: ${session.clientId}`);
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
      handleClose(ws, "timeout");
      continue;
    }
    state.isAlive = false;
    try {
      ws.ping();
    } catch {
      /* ignore */
    }
  }
}, HEARTBEAT_INTERVAL_MS);

// room sweep
setInterval(() => rooms.sweepEmptyRooms(), SWEEP_INTERVAL_MS);

// backpressure guard: if a socket buffer grows too large, disconnect
setInterval(() => {
  for (const session of rooms.allSockets()) {
    const ws = session.ws as unknown as {
      bufferedAmount?: number;
      terminate: () => void;
    };
    if (
      typeof ws.bufferedAmount === "number" &&
      ws.bufferedAmount > MAX_BUFFERED_BYTES
    ) {
      console.warn(`[ws] backpressure: terminating ${session.clientId}`);
      try {
        ws.terminate();
      } catch {
        /* ignore */
      }
      handleClose(session.ws, "timeout");
    }
  }
}, 5000);

httpServer.listen(PORT, () => {
  console.log(
    `[server] SyncSpace listening on :${PORT} (origin: ${ALLOWED_ORIGIN})`,
  );
});

process.on("SIGINT", () => {
  console.log("[server] shutting down");
  wss.close();
  httpServer.close(() => process.exit(0));
});
