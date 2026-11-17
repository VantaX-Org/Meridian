/**
 * Rule version fixture, shaped like api/routes/rules.py: the unified diff of a tenant version against the one before it,
 * and the create and transition writes (which answer and change nothing; the list of versions rides on the rule scope).
 */
export const NONE_RULE_VERSIONS = Symbol("not a rule version path");

const DIFF = [
  "--- v3",
  "+++ v4",
  "@@ definition @@",
  "-  expression: MARA-MEINS in T006-MSEHI (static list of 17)",
  "+  expression: MARA-MEINS in T006-MSEHI (read from the SAP check table)",
  "   severity: high",
  "-  tolerance: 25",
  "+  tolerance: 0",
].join("\n");

const VERSION = /^\/rules\/([^/]+)\/versions(?:\/(\d+)\/(diff|transition))?$/;

export function ruleVersionsRead(path: string): unknown {
  const m = VERSION.exec(path);
  if (!m || m[3] !== "diff") return NONE_RULE_VERSIONS;
  return { rule_id: decodeURIComponent(m[1]), from: "v3", to: `v${m[2]}`, diff: DIFF };
}

export function ruleVersionsWrite(method: string, path: string, body: unknown): unknown {
  const m = VERSION.exec(path);
  if (method !== "POST" || !m) return NONE_RULE_VERSIONS;
  const b = (body ?? {}) as { to?: string };
  if (m[3] === "transition") return { rule_id: decodeURIComponent(m[1]), version: Number(m[2]), state: b.to ?? "draft" };
  return { rule_id: decodeURIComponent(m[1]), version: 5, state: "draft" };
}
