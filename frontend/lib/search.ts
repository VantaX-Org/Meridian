// frontend/lib/search.ts
export interface SearchCandidate {
  kind: "object" | "material" | "rule" | "batch" | "run" | "glossary";
  id: string;
  label: string;
  href: string;
}

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
