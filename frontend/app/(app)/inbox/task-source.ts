import { MODULE_LABELS } from "@/lib/format";
import type { Exception, StewardshipQueueItem } from "@/types/api";

/**
 * Where record issues are worked: Fix work, on the viewer's own records. The Inbox's Issues tab (a second record-fix
 * pane) was retired into it; `/inbox?kind=issues` redirects here (the Inbox page; /issues in next.config.ts).
 */
export const RECORD_ISSUES_HREF = "/fix?mine=1";

const isObject = (m: unknown): m is string => typeof m === "string" && Object.hasOwn(MODULE_LABELS, m);

/**
 * The SAP object an exception is about, for its title and the task's Object: the objects whose findings raised an SAP
 * signal (`affected_records.modules`), else a custom rule's object type (its `category`), else its linked finding's.
 * Null when none of them names a known object.
 */
export function exceptionObject(e: Pick<Exception, "affected_records" | "category" | "type"> & { linked_finding?: Exception["linked_finding"] }): string | null {
  const modules = e.affected_records?.modules;
  const first = Array.isArray(modules) ? modules.find(isObject) : undefined;
  if (first) return first;
  if (e.type === "custom_business" && isObject(e.category)) return e.category;
  const linked = e.linked_finding?.module;
  return isObject(linked) ? linked : null;
}

/** The exceptions API returns at most 100 a page (api/routes/exceptions.py). */
export const EXC_PAGE = 100;

/**
 * Where a stewardship task opens. `source_id` is the id of what the task decides on
 * (workers/tasks/populate_stewardship_queue.py): a match pair, a golden record, an exception, a cleaning
 * proposal, a data contract, a glossary term or a value mapping, never an SAP record key. A write-back
 * task opens the proposal's record by its key, so it needs the proposal; without it there is no link yet.
 */
export function taskSourceLink(
  t: Pick<StewardshipQueueItem, "item_type" | "source_id">,
  proposal: { object_type: string; record_key: string } | null,
): { href: string; label: string } | null {
  const id = encodeURIComponent(t.source_id);
  switch (t.item_type) {
    case "merge_decision":
      return { href: `/mdm/golden/merge?pair=${id}`, label: "Review the pair" };
    case "golden_record_review":
      return { href: `/mdm/golden/${id}`, label: "Open the golden record" };
    case "golden_writeback":
      // source_id is the golden record; its page shows the simulated field diff being approved.
      return { href: `/mdm/golden/${id}`, label: "Review the write-back" };
    case "writeback_approval":
      return proposal?.record_key
        ? { href: `/objects/${encodeURIComponent(proposal.object_type)}/records/${encodeURIComponent(proposal.record_key)}`, label: "Open record" }
        : null;
    case "exception":
      return { href: `/inbox?kind=exception&focus=${id}`, label: "Open the exception" };
    case "glossary_review":
      return { href: `/mdm/glossary/${id}`, label: "Open the glossary term" };
    case "contract_breach":
      // The contracts page has no page per contract; its breached filter lists this one.
      return { href: "/rules/contracts?status=breached", label: "Open breached contracts" };
    default:
      // A value mapping (config_value_match) has no page of its own.
      return null;
  }
}
