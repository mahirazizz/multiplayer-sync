import type { RemoteCursorState } from "../sync/types.js";

interface Props {
  cursors: RemoteCursorState[];
}

export function RemoteCursors({ cursors }: Props) {
  return (
    <>
      {cursors.map((c) => (
        <div
          key={c.clientId}
          className="remote-cursor"
          style={{
            left: `${c.currentX * 100}%`,
            top: `${c.currentY * 100}%`,
            ["--cursor-color" as string]: c.color,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
            <path
              d="M3 2 L3 16 L7 12 L10 18 L12 17 L9 11 L15 11 Z"
              fill={c.color}
              stroke="#0f172a"
              strokeWidth="1"
            />
          </svg>
          <span className="cursor-label" style={{ background: c.color }}>
            {c.name}
          </span>
        </div>
      ))}
    </>
  );
}
