import { Status } from "@/design";
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
    <span className={`m-heat-seq-${c.step} [display:inline-flex] [align-items:center] [height:22px] [padding:0_8px] [border-radius:var(--m-radius-pill)] [font-size:var(--m-text-meta)] [font-weight:500] [white-space:nowrap]`}>
      {c.label}
    </span>
  );
}

export function RunStatusPill({ status }: { status: RunStatus }) {
  return <Status kind="lifecycle" value={status} />;
}
