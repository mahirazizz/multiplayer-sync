import type { ConnectionStatus as Status } from "../sync/types.js";

interface Props {
  status: Status;
  latencyMs: number | null;
  hz: number;
  attempt: number;
}

export function ConnectionStatus({ status, latencyMs, hz, attempt }: Props) {
  const label = (() => {
    switch (status) {
      case "connected":
        return "Connected";
      case "connecting":
        return "Connecting…";
      case "reconnecting":
        return `Reconnecting… (${attempt})`;
      case "disconnected":
        return "Disconnected";
      case "error":
        return "Error";
      default:
        return "Idle";
    }
  })();
  const dot =
    status === "connected"
      ? "#22c55e"
      : status === "reconnecting" || status === "connecting"
        ? "#eab308"
        : "#ef4444";

  return (
    <div className="conn-status">
      <span className="dot" style={{ background: dot }} />
      <span className="label">{label}</span>
      {latencyMs !== null && (
        <span className="metric">Latency: {latencyMs}ms</span>
      )}
      <span className="metric">Updates: {hz}/s</span>
    </div>
  );
}
