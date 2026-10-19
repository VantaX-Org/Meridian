import type { ReactNode } from "react";

/** Muted placeholder shape behind the sentence, hinting at what fills in once there's data. */
export type EmptyStateGhost = "table" | "chart" | "grid" | "list" | "ring" | "stepper";

// Ghosts are line drawings in the icon language: a 1.5 stroke in the hairline hue, one element in the accent.
const ghostStroke = { fill: "none", stroke: "var(--m-line-strong)", strokeWidth: 1.5, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
const accentStroke = { ...ghostStroke, stroke: "var(--m-accent)" };

/** Three rows under a header rule; the first row is the one the reader is waiting for. */
function TableGhost() {
  return (
    <svg width={200} height={76} viewBox="0 0 200 76" aria-hidden>
      <line x1={0} x2={200} y1={10.5} y2={10.5} {...ghostStroke} />
      {[26, 46, 66].map((y, i) => (
        <g key={y}>
          <rect x={2} y={y - 5} width={10} height={10} rx={2} {...(i === 0 ? accentStroke : ghostStroke)} />
          <line x1={22} x2={[150, 110, 130][i]} y1={y} y2={y} {...(i === 0 ? accentStroke : ghostStroke)} />
        </g>
      ))}
    </svg>
  );
}

/** Three outlined bars on a baseline; the tallest is the accent. */
function ChartGhost() {
  const bars = [{ x: 14, h: 36 }, { x: 58, h: 60 }, { x: 102, h: 24 }];
  return (
    <svg width={140} height={80} viewBox="0 0 140 80" aria-hidden>
      {bars.map((b, i) => (
        <rect key={b.x} x={b.x} y={74 - b.h} width={24} height={b.h} rx={2} {...(i === 1 ? accentStroke : ghostStroke)} />
      ))}
      <line x1={0} x2={140} y1={74.5} y2={74.5} {...ghostStroke} />
    </svg>
  );
}

/** A 3 by 3 of outlined cells; the centre is the accent. */
function GridGhost() {
  return (
    <svg width={64} height={64} viewBox="0 0 64 64" aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <rect key={i} x={2 + (i % 3) * 21} y={2 + Math.floor(i / 3) * 21} width={18} height={18} rx={3} {...(i === 4 ? accentStroke : ghostStroke)} />
      ))}
    </svg>
  );
}

/** Four rows of a dot and a line; the first row is the accent. */
function ListGhost() {
  return (
    <svg width={160} height={78} viewBox="0 0 160 78" aria-hidden>
      {[9, 29, 49, 69].map((y, i) => (
        <g key={y}>
          <circle cx={7} cy={y} r={4.5} {...(i === 0 ? accentStroke : ghostStroke)} />
          <line x1={22} x2={150 - i * 18} y1={y} y2={y} {...(i === 0 ? accentStroke : ghostStroke)} />
        </g>
      ))}
    </svg>
  );
}

/** 64px, the brand arc on its track, with the meridian tick at the top. */
function RingGhost() {
  const stroke = 6;
  const r = (64 - stroke) / 2;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={64} height={64} viewBox="0 0 64 64" aria-hidden>
      <circle cx={32} cy={32} r={r} fill="none" stroke="var(--m-sheet-sunken)" strokeWidth={stroke} />
      <circle cx={32} cy={32} r={r} fill="none" stroke="var(--m-accent)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${circ * 0.75} ${circ}`} transform="rotate(-90 32 32)" />
      <line x1={32} x2={32} y1={0} y2={9} stroke="var(--m-ink-3)" strokeWidth={1.5} />
    </svg>
  );
}

/** Four steps on a rule: two done, the current one in the accent, one to come. */
function StepperGhost() {
  const xs = [8, 52, 96, 140];
  return (
    <svg width={148} height={20} viewBox="0 0 148 20" aria-hidden>
      <line x1={8} x2={140} y1={10} y2={10} {...ghostStroke} />
      {xs.map((x, i) => (
        <g key={x}>
          <circle cx={x} cy={10} r={6} {...(i === 2 ? accentStroke : ghostStroke)} fill={i < 2 ? "var(--m-line-strong)" : "var(--m-sheet)"} />
          {i === 2 && <circle cx={x} cy={10} r={2} fill="var(--m-accent)" />}
        </g>
      ))}
    </svg>
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
    <div aria-hidden className="m-ghost-bg m-motion-fade flex items-center justify-center" style={{ height: 120, pointerEvents: "none", opacity: 0.9 }}>
      <Shape />
    </div>
  );
}

export function EmptyState({
  title,
  detail,
  action,
  ghost,
  variant = "card",
}: {
  title: string;
  detail?: string;
  /** Required by spec: every empty state offers a next step. Optional in the type only until all call sites supply one. */
  action?: ReactNode;
  ghost?: EmptyStateGhost;
  /** "inline": one 36px line for a region inside a card, no ghost or chrome. */
  variant?: "card" | "inline";
}) {
  if (variant === "inline") {
    return (
      <div data-state="empty" className="m-text-body flex items-center gap-3" style={{ minHeight: 36, padding: "0 var(--m-space-3)", color: "var(--m-ink-2)" }}>
        <span>{title}</span>
        {detail && <span style={{ color: "var(--m-ink-3)" }}>{detail}</span>}
        {action}
      </div>
    );
  }
  return (
    <div
      data-state="empty"
      className="m-card flex flex-col text-left"
      style={{ maxWidth: 560, padding: 0, overflow: "hidden" }}
    >
      {ghost && <GhostShape kind={ghost} />}
      <div className="flex flex-col gap-2" style={{ padding: "var(--m-space-8) var(--m-space-6)" }}>
        <p className="m-text-h font-semibold" style={{ color: "var(--m-ink)" }}>{title}</p>
        {detail && <p className="m-text-body" style={{ color: "var(--m-ink-2)" }}>{detail}</p>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}
