interface Props {
  roomId: string;
  participantCount: number;
  onCopyLink: () => void;
  onLeave: () => void;
}

export function RoomHeader({
  roomId,
  participantCount,
  onCopyLink,
  onLeave,
}: Props) {
  return (
    <header className="room-header">
      <div>
        <h1>SyncSpace</h1>
        <p className="subtitle">Real-Time Multiplayer Interaction</p>
      </div>
      <div className="room-meta">
        <div>
          Room: <strong>{roomId}</strong>
        </div>
        <div>
          Participants: <strong>{participantCount}</strong>
        </div>
        <div className="actions">
          <button onClick={onCopyLink}>Copy Link</button>
          <button onClick={onLeave} className="ghost">
            Leave
          </button>
        </div>
      </div>
    </header>
  );
}
