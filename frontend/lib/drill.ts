// The drill contract into Fix work (/fix, components/work/fix-work.tsx): one typed builder so every number, row,
// bar and chart point that stands for records opens exactly those records. Omitted filters stay off the URL.
import { formatModuleName, formatNumber } from "./format";

export type FixSeverity = "critical" | "high" | "medium" | "low" | "blocking";
export type FixStatus = "open" | "to_fix" | "proposed" | "approved" | "sent" | "not_an_issue" | "fixed" | "all";

export interface FixFilter {
  /** Run (version id). The scope bar keeps ?run= on its own; pass it only when the page shows one specific run. */
  run?: string;
  /** Object id, e.g. material_master. */
  module?: string;
  /** Check id. */
  check?: string;
  sev?: FixSeverity | string;
  /** Work status; Fix work reads a missing value as open, so "open" is left off the URL. */
  st?: FixStatus;
  /** Only my records. */
  mine?: boolean;
  /** One assignee's records (user uuid). */
  assignee?: string;
  /** Only records with a suggested value. */
  sugg?: boolean;
  due?: "overdue";
  /** Source system scope of the run (the system name). */
  system?: string;
  /** A key field value of the record, as "FIELD=VALUE" or { field, value }. */
  part?: string | { field: string; value: string };
  q?: string;
  /** The record to open: module and record key. */
  record?: { module: string; key: string };
}

/** "Material master" reads "material master" mid-sentence; "FI general ledger" keeps its acronym. */
const inSentence = (s: string): string => (/^[A-Z][A-Z0-9]/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

const ORDER = ["run", "module", "check", "sev", "st", "mine", "assignee", "sugg", "due", "system", "part", "q", "record"] as const;

/** `/fix?module=material_master&check=MM_001&sev=critical`: Fix work filtered to exactly these records. */
export function fixHref(filter: FixFilter = {}): string {
  const values: Record<(typeof ORDER)[number], string | undefined> = {
    run: filter.run || undefined,
    module: filter.module || undefined,
    check: filter.check || undefined,
    sev: filter.sev ? String(filter.sev).toLowerCase() : undefined,
    st: filter.st && filter.st !== "open" ? filter.st : undefined,
    mine: filter.mine ? "1" : undefined,
    assignee: filter.assignee || undefined,
    sugg: filter.sugg ? "1" : undefined,
    due: filter.due,
    system: filter.system || undefined,
    part: typeof filter.part === "string" ? filter.part || undefined : filter.part ? `${filter.part.field}=${filter.part.value}` : undefined,
    q: filter.q || undefined,
    record: filter.record ? `${filter.record.module}|${filter.record.key}` : undefined,
  };
  const params = new URLSearchParams();
  for (const k of ORDER) {
    const v = values[k];
    if (v) params.set(k, v);
  }
  const qs = params.toString();
  return qs ? `/fix?${qs}` : "/fix";
}

/**
 * The accessible name of a drill: "Open the 1,204 critical records of material master", "Open the records of rule
 * MM_001". `what` replaces the noun ("fixed records", "open issues"); `of` names the scope in words.
 */
export function drillLabel({ count, sev, what = "records", module, check, of }: {
  count?: number | null;
  sev?: string;
  what?: string;
  module?: string;
  check?: string;
  of?: string;
}): string {
  const head = [count != null ? formatNumber(count) : null, sev ? sev.toLowerCase() : null, count === 1 ? what.replace(/s$/, "") : what]
    .filter(Boolean)
    .join(" ");
  const scope = [check ? `rule ${check}` : null, module ? inSentence(formatModuleName(module)) : null, of ?? null].filter(Boolean);
  return `Open the ${head}${scope.length ? ` of ${scope.join(" in ")}` : ""}`;
}
