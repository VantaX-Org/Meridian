import type { ReactNode } from "react";

/** Muted placeholder shape behind the sentence, hinting at what fills in once there's data. */
export type EmptyStateGhost = "table" | "chart" | "grid" | "list";

function TableGhost() {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-3 h-8 items-center px-2" style={{ background: "var(--m-sheet-raised)" }}>
        {[80, 80, 80, 80, 80].map((w, i) => (
          <span key={i} style={{ width: w, height: 8, background: "var(--m-line)", borderRadius: 2 }} />
        ))}
      </div>
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} className="flex gap-3 px-2 py-2 border-t" style={{ borderColor: "var(--m-line)" }}>
          {[120, 64, 40].map((w, i) => (
            <span key={i} style={{ width: w, height: 8, background: "var(--m-line)", borderRadius: 2 }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function ChartGhost() {
  return (
    <svg width="100%" height={160} aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <line key={i} x1="0" x2="100%" y1={i * 40} y2={i * 40} stroke="var(--m-line)" />
      ))}
      <line x1="0" x2="100%" y1="96" y2="96" stroke="var(--m-line)" strokeDasharray="4 4" />
      <text x="4" y="90" fontSize="12" fill="var(--m-ink-3)">Threshold</text>
    </svg>
  );
}

function GridGhost() {
  return (
    <div className="grid grid-cols-6 gap-0.5" style={{ width: 6 * 24 + 5 * 2 }}>
      {Array.from({ length: 36 }, (_, i) => (
        <span key={i} style={{ width: 24, height: 24, background: "var(--m-line)" }} />
      ))}
    </div>
  );
}

function ListGhost() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <span style={{ width: 8, height: 8, borderRadius: "50%", border: "1px solid var(--m-line)" }} />
          <span style={{ width: 160, height: 8, background: "var(--m-line)", borderRadius: 2 }} />
        </div>
      ))}
    </div>
  );
}

const GHOST_SHAPE: Record<EmptyStateGhost, () => ReactNode> = {
  table: TableGhost,
  chart: ChartGhost,
  grid: GridGhost,
  list: ListGhost,
};

function GhostShape({ kind }: { kind: EmptyStateGhost }) {
  const Shape = GHOST_SHAPE[kind];
  return (
    <div aria-hidden style={{ maxHeight: 180, overflow: "hidden", pointerEvents: "none" }}>
      <Shape />
    </div>
  );
}

export function EmptyState({
  title,
  detail,
  action,
  ghost,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
  ghost?: EmptyStateGhost;
}) {
  return (
    <div
      data-state="empty"
      className="flex flex-col text-left"
      style={{
        maxWidth: 560,
        background: "var(--m-sheet)",
        border: "1px solid var(--m-line)",
        borderRadius: "var(--m-radius-sheet)",
        overflow: "hidden",
      }}
    >
      {ghost && <GhostShape kind={ghost} />}
      <div className="flex flex-col gap-2" style={{ padding: "var(--m-space-6)" }}>
        <p className="text-[15px] leading-[20px] font-semibold" style={{ color: "var(--m-ink)" }}>{title}</p>
        {detail && <p className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink-2)" }}>{detail}</p>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
