import type { ReactNode } from "react";

/** Muted placeholder shape behind the sentence, hinting at what fills in once there's data. */
export type EmptyStateGhost = "table" | "chart" | "grid" | "list" | "ring" | "stepper";

function TableGhost() {
  return (
    <div className="flex flex-col gap-2" style={{ width: 200 }}>
      {[70, 50, 60].map((w, i) => (
        <div key={w} className="flex items-center gap-2" style={{ height: 24 }}>
          {i === 0 && <span style={{ width: 24, height: 24, background: "var(--m-dom-material)", borderRadius: 4 }} />}
          <span style={{ width: `${w}%`, height: 8, background: "var(--m-accent-soft-2)", borderRadius: 4 }} />
        </div>
      ))}
    </div>
  );
}

function ChartGhost() {
  const bars = [
    { h: 40, fill: "var(--m-viz-4)" },
    { h: 64, fill: "var(--m-viz-1)" },
    { h: 28, fill: "var(--m-viz-2)" },
  ];
  return (
    <svg width={140} height={80} aria-hidden>
      {bars.map((b, i) => (
        <rect key={i} x={12 + i * 40} y={79 - b.h} width={24} height={b.h} fill={b.fill} opacity={0.6} rx={2} />
      ))}
      <line x1={0} x2={140} y1={79.5} y2={79.5} stroke="var(--m-line-strong)" />
    </svg>
  );
}

function GridGhost() {
  return (
    <div className="grid grid-cols-3 gap-1">
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} style={{ width: 16, height: 16, borderRadius: 3, background: i === 4 ? "var(--m-accent)" : "var(--m-accent-soft-2)" }} />
      ))}
    </div>
  );
}

function ListGhost() {
  const dots = ["var(--m-viz-5)", "var(--m-viz-7)", "var(--m-viz-4)", "var(--m-viz-8)"];
  return (
    <div className="flex flex-col gap-2">
      {dots.map((c, row) => (
        <div key={row} className="flex items-center gap-3">
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: c }} />
          <span style={{ width: 120 - row * 14, height: 8, background: "var(--m-accent-soft-2)", borderRadius: 4 }} />
        </div>
      ))}
    </div>
  );
}

/** 64px, 270 degree arc on a track, with an ember tick at the arc's end. */
function RingGhost() {
  const stroke = 8;
  const r = (64 - stroke) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={64} height={64} viewBox="0 0 64 64">
      <circle cx={32} cy={32} r={r} fill="none" stroke="var(--m-accent-soft-2)" strokeWidth={stroke} />
      <circle cx={32} cy={32} r={r} fill="none" stroke="var(--m-accent)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${circ * 0.75} ${circ}`} transform="rotate(-90 32 32)" />
      <line x1={32} x2={32} y1={0} y2={9} stroke="var(--m-ember)" strokeWidth={2} />
    </svg>
  );
}

function StepperGhost() {
  const fills = ["var(--m-pass)", "var(--m-pass)", "var(--m-accent)", "var(--m-line-strong)"];
  return (
    <div className="relative flex items-center" style={{ gap: 36 }}>
      <span style={{ position: "absolute", left: 6, right: 6, top: "50%", height: 2, marginTop: -1, background: "var(--m-line-strong)" }} />
      {fills.map((c, i) => (
        <span key={i} style={{ position: "relative", width: 12, height: 12, borderRadius: "50%", background: c }} />
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
    <div aria-hidden className="m-ghost-bg m-motion-fade flex items-center justify-center" style={{ height: 120, pointerEvents: "none", opacity: 0.9, margin: "var(--m-space-3) var(--m-space-3) 0" }}>
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
  /** Required by spec: every empty state offers a next step. Optional in the type only until all call sites supply one. */
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
