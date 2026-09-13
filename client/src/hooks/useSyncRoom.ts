import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { SyncEngine } from "../sync/syncEngine.js";
import type { SyncSnapshot } from "../sync/types.js";
import { getOrCreateClientId } from "../utils/clientId.js";

export interface UseSyncRoomOptions {
  roomId: string | null;
  name: string;
}

export interface UseSyncRoomResult {
  engine: SyncEngine | null;
  snapshot: SyncSnapshot | null;
}

const WS_URL: string = (() => {
  const env = import.meta.env as Record<string, string | undefined>;
  if (env.VITE_WS_URL) return env.VITE_WS_URL;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.hostname}:8080`;
})();

export function useSyncRoom({
  roomId,
  name,
}: UseSyncRoomOptions): UseSyncRoomResult {
  const clientId = useMemo(() => getOrCreateClientId(), []);
  const engineRef = useRef<SyncEngine | null>(null);

  useEffect(() => {
    if (!roomId) {
      engineRef.current?.stop();
      engineRef.current = null;
      return;
    }
    const engine = new SyncEngine({ url: WS_URL, clientId, roomId, name });
    engineRef.current = engine;
    engine.start();
    return () => {
      engine.stop();
      engineRef.current = null;
    };
  }, [roomId, clientId, name]);

  const engine = engineRef.current;

  const snapshot = useSyncExternalStore<SyncSnapshot | null>(
    (cb) => {
      if (!engine) {
        // no-op subscription while engine is null
        return () => {};
      }
      return engine.subscribe(cb);
    },
    () => engine?.getSnapshot() ?? null,
    () => null,
  );

  return { engine, snapshot };
}
