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

type Contribution = MasterRecordDetail["source_contributions"][string];

/**
 * The source system one golden value came from: the connected system it is tagged with
 * (`source_system_name`, api/services/golden_record_engine.py), else its provenance label
 * (`upload:<run>` for an upload attached to no system, `merge:<key>`, `steward_override`).
 */
export function contributionSystem(c: Contribution | undefined | null): string | null {
  if (!c) return null;
  return c.source_system_name || c.source_system_id || c.source_system || null;
}

/** The distinct SAP systems a golden record's fields came from. `source_contributions` is keyed by field. */
export function sourceSystems(contributions: MasterRecordDetail["source_contributions"]): string[] {
  const systems = new Set<string>();
  for (const c of Object.values(contributions)) {
    const s = contributionSystem(c);
    if (s) systems.add(s);
  }
  return [...systems].sort();
}
