import type { ReactionInstance } from "../sync/types.js";

const EMOJI: Record<ReactionInstance["kind"], string> = {
  heart: "❤️",
  clap: "👏",
  fire: "🔥",
};

export function ReactionLayer({
  reactions,
}: {
  reactions: ReactionInstance[];
}) {
  return (
    <div className="reaction-layer" aria-hidden>
      {reactions.map((r) => (
        <span
          key={r.id}
          className="reaction"
          style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%` }}
        >
          {EMOJI[r.kind]}
        </span>
      ))}
    </div>
  );
}
