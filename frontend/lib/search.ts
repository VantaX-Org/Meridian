// frontend/lib/search.ts
export type SearchKind =
  | "page" | "system" | "object" | "material" | "rule" | "batch" | "run" | "glossary"
  | "process" | "discovery_run" | "model";

export interface SearchCandidate {
  kind: SearchKind;
  id: string;
  label: string;
  href: string;
}

/** The type pill on the search ledger, one label per kind. */
export const SEARCH_KIND_LABEL: Record<SearchKind, string> = {
  page: "Page",
  system: "System",
  object: "Object",
  material: "Material",
  rule: "Rule",
  batch: "Batch",
  run: "Run",
  glossary: "Glossary term",
  process: "Process",
  discovery_run: "Discovery run",
  model: "Process model",
};

/** 3 = exact id, 2 = label prefix, 1 = substring, 0 = no match (dropped). */
function score(query: string, candidate: SearchCandidate): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const id = candidate.id.toLowerCase();
  const label = candidate.label.toLowerCase();
  if (id === q || label === q) return 3;
  if (label.startsWith(q) || id.startsWith(q)) return 2;
  if (label.includes(q) || id.includes(q)) return 1;
  return 0;
}

/** Ranks candidates for the global search page (spec section 3.1 `/search`). */
export function rankResults(query: string, candidates: SearchCandidate[]): SearchCandidate[] {
  if (!query.trim()) return candidates;
  return candidates
    .map((c) => ({ c, s: score(query, c) }))
    .filter(({ s }) => s > 0)
    .sort((a, b) => b.s - a.s)
    .map(({ c }) => c);
}
