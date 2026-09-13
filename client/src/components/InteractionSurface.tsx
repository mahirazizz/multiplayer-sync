import { useRef, useState } from "react";
import type { SyncEngine } from "../sync/syncEngine.js";
import type { ReactionInstance, RemoteCursorState } from "../sync/types.js";
import { toNormalized } from "../utils/coordinates.js";
import { RemoteCursors } from "./RemoteCursors.js";
import { ReactionLayer } from "./ReactionLayer.js";

interface Props {
  engine: SyncEngine | null;
  cursors: RemoteCursorState[];
  reactions: ReactionInstance[];
  selfName: string;
  selfColor: string;
}

const REACTIONS: Array<{ kind: "heart" | "clap" | "fire"; label: string }> = [
  { kind: "heart", label: "❤️" },
  { kind: "clap", label: "👏" },
  { kind: "fire", label: "🔥" },
];

export function InteractionSurface({
  engine,
  cursors,
  reactions,
  selfName,
  selfColor,
}: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [selected, setSelected] = useState<"heart" | "clap" | "fire">("heart");
  const [localPos, setLocalPos] = useState<{ x: number; y: number } | null>(
    null,
  );

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || !engine) return;
    const { x, y } = toNormalized(e.clientX, e.clientY, rect);
    engine.setLocalCursor(x, y);
    setLocalPos({ x, y });
  }

  function handlePointerLeave() {
    engine?.freezeLocalCursor();
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || !engine) return;
    const { x, y } = toNormalized(e.clientX, e.clientY, rect);
    engine.sendReaction(selected, x, y);
  }

  return (
    <div className="surface-wrap">
      <div
        ref={ref}
        className="surface"
        onPointerMove={handlePointerMove}
        onPointerLeave={handlePointerLeave}
        onPointerDown={handlePointerDown}
      >
        <div className="surface-hint">Click anywhere to react</div>

        <RemoteCursors cursors={cursors} />
        <ReactionLayer reactions={reactions} />

        {localPos && (
          <div
            className="local-cursor"
            style={{
              left: `${localPos.x * 100}%`,
              top: `${localPos.y * 100}%`,
              ["--cursor-color" as string]: selfColor,
            }}
          >
            <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
              <path
                d="M3 2 L3 16 L7 12 L10 18 L12 17 L9 11 L15 11 Z"
                fill={selfColor}
                stroke="#0f172a"
                strokeWidth="1"
              />
            </svg>
            <span className="cursor-label" style={{ background: selfColor }}>
              {selfName}
            </span>
          </div>
        )}

        {cursors.length === 0 && (
          <div className="empty-state">
            You're alone in this room. Share the link!
          </div>
        )}
      </div>
      <div className="reaction-bar">
        {REACTIONS.map((r) => (
          <button
            key={r.kind}
            className={
              selected === r.kind ? "reaction-btn active" : "reaction-btn"
            }
            onClick={() => setSelected(r.kind)}
            title={`React with ${r.label}`}
          >
            {r.label}
          </button>
        ))}
        <span className="reaction-help">Click the surface to send</span>
      </div>
    </div>
  );
}
