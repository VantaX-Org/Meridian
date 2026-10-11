import type { ReactNode } from "react";

/** Muted placeholder shape behind the sentence, hinting at what fills in once there's data. */
export type EmptyStateGhost = "table" | "chart" | "grid" | "list" | "ring" | "stepper";

function TableGhost() {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-3 h-8 items-center px-2" style={{ background: "var(--m-sheet-raised)" }}>
        {[80, 80, 80, 80, 80].map((w, i) => (
          <span key={i} style={{ width: w, height: 8, background: "var(--m-sheet-sunken)", borderRadius: 2 }} />
        ))}
      </div>
      {[0, 1, 2, 3, 4].map((row) => (
        <div key={row} className="flex gap-3 px-2 py-2 border-t" style={{ borderColor: "var(--m-line)" }}>
          {[120, 64, 40].map((w, i) => (
            <span key={i} style={{ width: w, height: 8, background: "var(--m-sheet-sunken)", borderRadius: 2 }} />
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
      <line x1="0" x2="100%" y1="96" y2="96" stroke="var(--m-sheet-sunken)" strokeDasharray="4 4" />
      <text x="4" y="90" fontSize="12" fill="var(--m-ink-3)">Threshold</text>
    </svg>
  );
}

function GridGhost() {
  return (
    <div className="grid grid-cols-6 gap-0.5" style={{ width: 6 * 24 + 5 * 2 }}>
      {Array.from({ length: 36 }, (_, i) => (
        <span key={i} style={{ width: 24, height: 24, background: "var(--m-sheet-sunken)" }} />
      ))}
    </div>
  );
}

function ListGhost() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <span style={{ width: 8, height: 8, borderRadius: "50%", border: "1px solid var(--m-sheet-sunken)" }} />
          <span style={{ width: 160, height: 8, background: "var(--m-sheet-sunken)", borderRadius: 2 }} />
        </div>
      ))}
    </div>
  );
}

/** 96px ring track with no value and a dashed meridian. */
function RingGhost() {
  const stroke = 10;
  const r = (96 - stroke) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={96} height={96} viewBox="0 0 96 96" style={{ margin: "0 auto" }}>
      <circle cx={48} cy={48} r={r} fill="none" stroke="var(--m-sheet-sunken)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${circ * 0.75} ${circ}`} transform="rotate(-45 48 48)" />
      <line x1={48} x2={48} y1={4} y2={92} stroke="var(--m-line-strong)" strokeDasharray="3 3" />
    </svg>
  );
}

function StepperGhost() {
  return (
    <div className="flex items-center justify-center gap-2">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-2">
          <span style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--m-sheet-sunken)" }} />
          {i < 3 && <span style={{ width: 48, height: 4, borderRadius: 2, background: "var(--m-sheet-sunken)" }} />}
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
  ring: RingGhost,
  stepper: StepperGhost,
};

function GhostShape({ kind }: { kind: EmptyStateGhost }) {
  const Shape = GHOST_SHAPE[kind];
  return (
    <div aria-hidden className="relative" style={{ maxHeight: 180, overflow: "hidden", pointerEvents: "none", padding: "var(--m-space-6) var(--m-space-6) 0" }}>
      <Shape />
      <div className="m-fade-bottom absolute inset-x-0 bottom-0" style={{ height: "60%" }} />
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
      className="m-card m-elev-1 flex flex-col text-left"
      style={{ maxWidth: 560, padding: 0, overflow: "hidden" }}
    >
      {ghost && <GhostShape kind={ghost} />}
      <div className="flex flex-col gap-2" style={{ padding: "var(--m-space-8) var(--m-space-6)" }}>
        <p className="text-[15px] leading-[20px] font-semibold" style={{ color: "var(--m-ink)" }}>{title}</p>
        {detail && <p className="text-[13px] leading-[18px]" style={{ color: "var(--m-ink-2)" }}>{detail}</p>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
