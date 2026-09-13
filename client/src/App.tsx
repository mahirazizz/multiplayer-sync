import { useCallback, useEffect, useMemo, useState } from "react";
import { ConnectionStatus } from "./components/ConnectionStatus.js";
import { InteractionSurface } from "./components/InteractionSurface.js";
import { PresenceList } from "./components/PresenceList.js";
import { RoomHeader } from "./components/RoomHeader.js";
import { RoomSetup } from "./components/RoomSetup.js";
import { useSyncRoom } from "./hooks/useSyncRoom.js";
import type { ParticipantInfo } from "./sync/types.js";
import { pickColorForId } from "./utils/colors.js";

export default function App() {
  const url = new URL(window.location.href);
  const initialRoom = url.searchParams.get("room") ?? undefined;
  const [session, setSession] = useState<{
    roomId: string;
    name: string;
  } | null>(
    initialRoom
      ? {
          roomId: initialRoom,
          name: localStorage.getItem("syncspace.name") ?? "Guest",
        }
      : null,
  );

  const { engine, snapshot } = useSyncRoom({
    roomId: session?.roomId ?? null,
    name: session?.name ?? "",
  });

  useEffect(() => {
    if (session) {
      const u = new URL(window.location.href);
      u.searchParams.set("room", session.roomId);
      window.history.replaceState({}, "", u.toString());
    }
  }, [session]);

  const selfColor = useMemo(
    () => snapshot?.selfColor ?? (engine ? pickColorForId("self") : "#94A3B8"),
    [snapshot?.selfColor, engine],
  );

  const participants: ParticipantInfo[] = useMemo(() => {
    if (!snapshot) return [];
    const self: ParticipantInfo = {
      clientId: snapshot.selfId,
      name: snapshot.selfName,
      color: selfColor,
    };
    const others = snapshot.participants.filter(
      (p) => p.clientId !== snapshot.selfId,
    );
    return [self, ...others];
  }, [snapshot, selfColor]);

  const handleJoin = useCallback((roomId: string, name: string) => {
    setSession({ roomId, name });
  }, []);

  const handleLeave = useCallback(() => {
    engine?.stop();
    setSession(null);
    const u = new URL(window.location.href);
    u.searchParams.delete("room");
    window.history.replaceState({}, "", u.toString());
  }, [engine]);

  const handleCopyLink = useCallback(() => {
    if (!session) return;
    const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(session.roomId)}`;
    navigator.clipboard.writeText(link).catch(() => {});
  }, [session]);

  if (!session || !snapshot || !engine) {
    return (
      <div className="app">
        <RoomSetup onJoin={handleJoin} initialRoomId={initialRoom} />
      </div>
    );
  }

  return (
    <div className="app">
      <RoomHeader
        roomId={session.roomId}
        participantCount={participants.length}
        onCopyLink={handleCopyLink}
        onLeave={handleLeave}
      />
      <ConnectionStatus
        status={snapshot.status}
        latencyMs={snapshot.latencyMs}
        hz={snapshot.sendRateHz}
        attempt={snapshot.attempt}
      />
      {snapshot.lastError && (
        <div className="banner error">Error: {snapshot.lastError}</div>
      )}
      {snapshot.status === "reconnecting" && (
        <div className="banner warn">
          Connection lost — attempting to reconnect…
        </div>
      )}
      <main className="main-grid">
        <InteractionSurface
          engine={engine}
          cursors={snapshot.cursors}
          reactions={snapshot.reactions}
          selfName={snapshot.selfName}
          selfColor={selfColor}
        />
        <aside className="sidebar">
          <h2>Presence</h2>
          <PresenceList participants={participants} selfId={snapshot.selfId} />
          <div className="debug">
            <div>Status: {snapshot.status}</div>
            <div>Latency: {snapshot.latencyMs ?? "—"} ms</div>
            <div>Send rate: {snapshot.sendRateHz}/s</div>
            <div>Remotes: {snapshot.cursors.length}</div>
          </div>
        </aside>
      </main>
    </div>
  );
}
