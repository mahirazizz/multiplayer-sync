import type { ParticipantInfo } from "../sync/types.js";

interface Props {
  participants: ParticipantInfo[];
  selfId: string;
}

export function PresenceList({ participants, selfId }: Props) {
  if (participants.length === 0) {
    return <div className="presence empty">No participants yet</div>;
  }
  return (
    <ul className="presence">
      {participants.map((p) => (
        <li key={p.clientId}>
          <span className="swatch" style={{ background: p.color }} />
          <span className="name">
            {p.name}
            {p.clientId === selfId ? " (you)" : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
