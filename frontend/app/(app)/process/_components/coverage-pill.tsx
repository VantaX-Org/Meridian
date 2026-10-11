import { Pill, type PillTone } from "@/design";
import type { Coverage, RunStatus } from "@/lib/api/process-discovery";

const COVERAGE: Record<Coverage, { tone: PillTone; label: string }> = {
  discovered: { tone: "go", label: "Discovered" },
  partial: { tone: "at-risk", label: "Partial" },
  reference: { tone: "neutral", label: "Reference, not discovered" },
};

export function CoveragePill({ coverage }: { coverage: Coverage }) {
  const c = COVERAGE[coverage];
  return <Pill tone={c.tone}>{c.label}</Pill>;
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
