import type { ReactNode } from "react";

/** Muted placeholder shape behind the sentence, hinting at what fills in once there's data. */
export type EmptyStateGhost = "table" | "chart" | "grid" | "list";

const GHOST_HEIGHT: Record<EmptyStateGhost, number> = {
  table: 120,
  chart: 160,
  grid: 160,
  list: 96,
};

function GhostShape({ kind }: { kind: EmptyStateGhost }) {
  return (
    <div
      aria-hidden
      className="mt-5 rounded"
      style={{ height: GHOST_HEIGHT[kind], background: "var(--m-sheet-raised)", border: "1px solid var(--m-line)" }}
    />
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
      className="flex flex-col gap-2 text-left"
      style={{
        maxWidth: 560,
        padding: "var(--m-space-8) var(--m-space-6)",
        background: "var(--m-sheet)",
        border: "1px solid var(--m-line)",
        borderRadius: "var(--m-radius-sheet)",
      }}
    >
      <p style={{ color: "var(--m-ink)" }}>{title}</p>
      {detail && <p style={{ color: "var(--m-ink-2)" }}>{detail}</p>}
      {action && <div className="mt-2">{action}</div>}
      {ghost && <GhostShape kind={ghost} />}
    </div>
  );
}
