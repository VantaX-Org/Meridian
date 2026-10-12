import { Pill, type PillTone } from "@/design";
import type { Coverage, RunStatus } from "@/lib/api/process-discovery";

/** Coverage is ordinal: discovered fills the deepest ramp step, partial the middle, reference the lightest. */
const COVERAGE: Record<Coverage, { step: 1 | 3 | 5; label: string }> = {
  discovered: { step: 5, label: "Discovered" },
  partial: { step: 3, label: "Partial" },
  reference: { step: 1, label: "Reference, not discovered" },
};

export function CoveragePill({ coverage }: { coverage: Coverage }) {
  const c = COVERAGE[coverage];
  return (
    <span className={`m-heat-seq-${c.step}`} style={{ display: "inline-flex", alignItems: "center", height: 22, padding: "0 8px",
      borderRadius: "var(--m-radius-pill)", fontSize: "var(--m-text-meta)", fontWeight: 500, whiteSpace: "nowrap" }}>
      {c.label}
    </span>
  );
}

const STATUS: Record<RunStatus, { tone: PillTone; label: string }> = {
  queued: { tone: "info", label: "Queued" },
  waiting: { tone: "info", label: "Waiting for extraction" },
  extracting: { tone: "info", label: "Extracting" },
  building: { tone: "info", label: "Building event log" },
  mining: { tone: "info", label: "Mining" },
  completed: { tone: "go", label: "Completed" },
  failed: { tone: "no-go", label: "Failed" },
};

export function RunStatusPill({ status }: { status: RunStatus }) {
  const s = STATUS[status];
  return <Pill tone={s.tone}>{s.label}</Pill>;
}
