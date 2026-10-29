import type { DownloadScope, ScopeKey } from "@/lib/api/system-objects";

/** The organisational filters an extraction accepts, as the page names them. */
export const SCOPE_LABEL: Record<ScopeKey, string> = {
  company_codes: "Company codes",
  plants: "Plants",
  sales_orgs: "Sales organisations",
  purchasing_orgs: "Purchasing organisations",
};

/** What the person typed for each filter and the date window: the editor's state. */
export interface ScopeDraft {
  lists: Partial<Record<ScopeKey, string>>;
  date_from: string;
  date_to: string;
  exclude_deleted: boolean;
}

export const EMPTY_SCOPE: ScopeDraft = { lists: {}, date_from: "", date_to: "", exclude_deleted: false };

/** "1000, 2000;3000" to ["1000", "2000", "3000"]: upper case, no blanks, no repeats. */
export function parseList(value: string): string[] {
  return [...new Set(value.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))];
}

/** The reason the date window is wrong, or undefined. */
export function dateError(from: string, to: string): string | undefined {
  if (from && to && to < from) return "The end date is before the start date";
  return undefined;
}

/** The scope the API takes: only the filters the chosen objects accept, only what was typed. */
export function buildScope(draft: ScopeDraft, filters: readonly ScopeKey[], windowed: boolean): DownloadScope {
  const scope: DownloadScope = {};
  for (const k of filters) {
    const list = parseList(draft.lists[k] ?? "");
    if (list.length) scope[k] = list;
  }
  if (windowed && draft.date_from) scope.date_from = draft.date_from;
  if (windowed && draft.date_to) scope.date_to = draft.date_to;
  if (draft.exclude_deleted) scope.exclude_deleted = true;
  return scope;
}

/** One sentence for the confirmation: which filters narrow the read, or that it reads everything. */
export function scopeSentence(scope: DownloadScope): string {
  const parts = [
    ...(Object.keys(SCOPE_LABEL) as ScopeKey[]).flatMap((k) => (scope[k]?.length ? [`${SCOPE_LABEL[k].toLowerCase()} ${scope[k]!.join(", ")}`] : [])),
    ...(scope.date_from || scope.date_to ? [`documents ${scope.date_from ?? "the start"} to ${scope.date_to ?? "today"}`] : []),
    ...(scope.exclude_deleted ? ["records flagged for deletion skipped"] : []),
  ];
  return parts.length ? `Scope: ${parts.join("; ")}.` : "Scope: everything, no organisational filter.";
}
