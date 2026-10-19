import { Mono } from "@/design";
import type { CleaningQueueItem } from "@/lib/api/cleaning";

/** The change a cleaning proposal makes: the field it sets, the value it proposes and the value it replaces. */
export interface Proposal {
  field: string | null;
  value: string;
  before: string | null;
}

const show = (v: unknown): string => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** The proposal an item makes: the first field whose value changes, else the golden record's value. */
export function proposalOf(item: CleaningQueueItem): Proposal | null {
  const after = item.record_data_after;
  if (after) {
    const before = item.record_data_before ?? {};
    const field = Object.keys(after).find((k) => show(after[k]) !== show(before[k]));
    if (field) return { field, value: show(after[field]), before: show(before[field]) };
  }
  return item.golden_field_value ? { field: null, value: item.golden_field_value, before: null } : null;
}

/** A proposal in a ledger cell: the proposed value in mono, the field beside it, the value it replaces on hover. */
export function ProposalCell({ proposal }: { proposal: Proposal | null }) {
  if (!proposal) return <span className="m-ink-3">—</span>;
  return (
    <span className="inline-flex min-w-0 items-baseline gap-2" title={proposal.field ? `${proposal.field}: ${proposal.before || "(blank)"} to ${proposal.value || "(blank)"}` : undefined}>
      <Mono>{proposal.value || "(blank)"}</Mono>
      {proposal.field ? <span className="m-ink-3 truncate">{proposal.field}</span> : null}
    </span>
  );
}
