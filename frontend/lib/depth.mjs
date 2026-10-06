/**
 * Depth model (DESIGN.md, "Depth"): which Tally size a detail route uses.
 * Level 1 is the portfolio, 4 is a single record. Hub pages (lists under a
 * hub Tally) are not listed; their components pick a level themselves.
 * Plain JS so the eslint rule `aurora-structure/one-tally` can import it on any Node.
 */

/** @typedef {1 | 2 | 3 | 4} DepthLevel */

/** Route pattern (Next.js folder syntax, no route groups) to Tally level.
 * @type {Record<string, DepthLevel>} */
export const DEPTH_ROUTES = {
  "/": 1,
  "/systems/[id]": 2,
  "/data/runs/[id]": 2,
  "/analyse/coverage": 2,
  "/analyse/object/[module]": 3,
  "/analyse/rule/[checkId]": 3,
  "/analyse/finding/[id]": 3,
  "/workbench/record/[issueId]": 4,
  "/golden-records/[id]": 4,
  "/glossary/[id]": 4,
};

/** Level for a route pattern or a concrete pathname, or null for pages that are not on the ladder.
 * @param {string} path
 * @returns {DepthLevel | null} */
export function depthLevel(path) {
  const clean = path.split(/[?#]/)[0].replace(/(.)\/$/, "$1");
  if (clean in DEPTH_ROUTES) return DEPTH_ROUTES[clean];
  const parts = clean.split("/");
  for (const [pattern, level] of Object.entries(DEPTH_ROUTES)) {
    const p = pattern.split("/");
    if (p.length === parts.length && p.every((seg, i) => seg.startsWith("[") || seg === parts[i])) return level;
  }
  return null;
}
