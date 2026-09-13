import { useState } from "react";

interface Props {
  onJoin: (roomId: string, name: string) => void;
  initialRoomId?: string | undefined;
}

const ROOM_RE = /^[a-z0-9-]{1,64}$/;

export function RoomSetup({ onJoin, initialRoomId }: Props) {
  const [roomId, setRoomId] = useState(initialRoomId ?? "watch-party-42");
  const [name, setName] = useState(
    () => localStorage.getItem("syncspace.name") ?? randomName(),
  );
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const rid = roomId.trim().toLowerCase();
    if (!ROOM_RE.test(rid)) {
      setError("Room ID must be 1-64 chars: a-z, 0-9, dash.");
      return;
    }
    const n = name.trim();
    if (n.length < 1 || n.length > 32) {
      setError("Name must be 1-32 characters.");
      return;
    }
    localStorage.setItem("syncspace.name", n);
    onJoin(rid, n);
  }

  return (
    <div className="setup-card">
      <h1>SyncSpace</h1>
      <p className="subtitle">Real-Time Multiplayer Interaction</p>
      <form onSubmit={handleSubmit} className="setup-form">
        <label>
          Your name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={32}
          />
        </label>
        <label>
          Room ID
          <input
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
            maxLength={64}
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button type="submit">Join Room</button>
      </form>
    </div>
  );
}

function randomName(): string {
  const adjectives = [
    "Swift",
    "Calm",
    "Bright",
    "Bold",
    "Cosmic",
    "Neon",
    "Silent",
    "Wild",
  ];
  const animals = [
    "Fox",
    "Otter",
    "Hawk",
    "Panda",
    "Lynx",
    "Wolf",
    "Koala",
    "Raven",
  ];
  const a = adjectives[Math.floor(Math.random() * adjectives.length)]!;
  const b = animals[Math.floor(Math.random() * animals.length)]!;
  return `${a} ${b}`;
}
