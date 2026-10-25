// frontend/components/mdm/golden-status.tsx
import { Pill, type PillTone } from "@/design";
import type { MasterRecordDetail, MasterRecordStatus } from "@/types/api";

/**
 * A golden record's lifecycle (master_records.status): the engine builds a `candidate` (confident) or a
 * `pending_review` record (api/services/golden_record_engine.py), a steward promotes it to `golden`, and a
 * merge marks the folded record `superseded` (api/services/mdm_merge.py).
 */
export const GOLDEN_STATUS_LABEL: Record<MasterRecordStatus, string> = {
  candidate: "Candidate",
  pending_review: "Pending review",
  golden: "Golden",
  superseded: "Superseded",
};

const TONE: Record<MasterRecordStatus, PillTone> = {
  candidate: "info",
  pending_review: "at-risk",
  golden: "go",
  superseded: "neutral",
};

export function goldenStatusLabel(status: string): string {
  return GOLDEN_STATUS_LABEL[status as MasterRecordStatus] ?? status.replace(/_/g, " ");
}

export function GoldenStatusPill({ status }: { status: string }) {
  return <Pill tone={TONE[status as MasterRecordStatus] ?? "neutral"}>{goldenStatusLabel(status)}</Pill>;
}

/** The distinct SAP systems a golden record's fields came from. `source_contributions` is keyed by field. */
export function sourceSystems(contributions: MasterRecordDetail["source_contributions"]): string[] {
  const systems = new Set<string>();
  for (const c of Object.values(contributions)) if (c?.source_system) systems.add(c.source_system);
  return [...systems].sort();
}
