export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "error";

export interface ConnectionCallbacks {
  onOpen: () => void;
  onMessage: (raw: string) => void;
  onClose: (code: number, reason: string) => void;
  onError: (err: string) => void;
  onStatusChange: (status: ConnectionStatus, attempt: number) => void;
}

const MAX_BACKOFF_MS = 30_000;
const BASE_BACKOFF_MS = 500;
const MAX_ATTEMPTS = 10;

export class Connection {
  private ws: WebSocket | null = null;
  private url: string;
  private cb: ConnectionCallbacks;
  private status: ConnectionStatus = "idle";
  private attempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private manualClose = false;

  constructor(url: string, cb: ConnectionCallbacks) {
    this.url = url;
    this.cb = cb;
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }
  getAttempt(): number {
    return this.attempt;
  }

  connect(): void {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.manualClose = false;
    this.setStatus(this.attempt === 0 ? "connecting" : "reconnecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      this.cb.onError(
        err instanceof Error ? err.message : "Failed to create WebSocket",
      );
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.attempt = 0;
      this.setStatus("connected");
      this.cb.onOpen();
    };
    ws.onmessage = (ev) => {
      if (typeof ev.data === "string") this.cb.onMessage(ev.data);
      else if (ev.data instanceof ArrayBuffer)
        this.cb.onMessage(new TextDecoder().decode(ev.data));
    };
    ws.onclose = (ev) => {
      this.ws = null;
      if (this.manualClose) {
        this.setStatus("disconnected");
        this.cb.onClose(ev.code, ev.reason);
        return;
      }
      this.cb.onClose(ev.code, ev.reason);
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      // onclose will follow; just surface
      this.cb.onError("socket error");
    };
  }

  private scheduleReconnect(): void {
    if (this.manualClose) return;
    if (this.attempt >= MAX_ATTEMPTS) {
      this.setStatus("disconnected");
      this.cb.onError("Max reconnect attempts reached");
      return;
    }
    const delay =
      Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** this.attempt) +
      Math.random() * 250;
    this.attempt += 1;
    this.setStatus("reconnecting");
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  send(msg: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  disconnect(): void {
    this.manualClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close(1000, "client disconnect");
      } catch {
        /* ignore */
      }
      this.ws = null;
    }
    this.setStatus("disconnected");
  }

  private setStatus(s: ConnectionStatus): void {
    this.status = s;
    this.cb.onStatusChange(s, this.attempt);
  }
}
