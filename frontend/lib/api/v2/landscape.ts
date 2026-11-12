import { getShellCounts, type ShellCounts } from "@/lib/api/shell";
import { getFindings } from "@/lib/api/findings";
import { fixtureActive } from "./fixture";
import { v2Get } from "./client";
import type { CommandResult, DimensionKey, Landscape, Receipt, RuleRow, RunList, StatusStrip, WorkPage } from "./types";

/** GET /landscape: scope=current reads every object at its own latest run; `run` pins one run. */
export function getLandscape(run?: string | null): Promise<Landscape> {
  return v2Get<Landscape>("/landscape", run ? { scope: "run", run } : { scope: "current" });
}

/** GET /status: the status strip on its own, for the current scope. */
export function getStatus(): Promise<StatusStrip> {
  return v2Get<StatusStrip>("/status");
}

/** GET /objects/{module}/receipt: the score with its working. */
export function getReceipt(module: string, run?: string | null): Promise<Receipt> {
  return v2Get<Receipt>(`/objects/${encodeURIComponent(module)}/receipt`, { run: run ?? undefined });
}

/** GET /command?q=: grouped matches for the command line. */
export function getCommand(q: string, limit = 20): Promise<CommandResult> {
  return v2Get<CommandResult>("/command", { q, limit });
}

/** GET /versions, the last runs for the run menu. */
export function getRunList(limit = 8): Promise<RunList> {
  return v2Get<RunList>("/versions", { limit });
}

/** GET /work/records ranked by value at risk: the rows of "Your next work". */
export function getTopWork(limit = 5): Promise<WorkPage> {
  return v2Get<WorkPage>("/work/records", { scope: "current", sort: "-value", limit });
}

/** Inbox and fix counts for the top bar. */
export async function getCounts(): Promise<ShellCounts> {
  if (fixtureActive()) return v2Get<ShellCounts>("/shell/counts");
  return getShellCounts();
}

const RULES_PAGE = 200;
const RULES_MAX_PAGES = 50;

/**
 * The rules of one object. Live, this is the existing GET /findings for the object's run; fixture mode answers from
 * lib/api/v2/fixtures, and `rows` scales the list (the 100k-row grid check).
 */
export async function getObjectRules(module: string, run: string | null | undefined, rows?: number): Promise<RuleRow[]> {
  if (fixtureActive()) {
    const res = await v2Get<{ rules: RuleRow[] }>("/findings", { module, version_id: run ?? undefined, rows });
    return res.rules;
  }
  // /findings pages at 200 at most, so read every page: the Rules tab, the rule inspector, Simulation, Lineage,
  // Glossary, Readiness and the cleaned upload all need the whole failing set, not the top 200 by impact.
  // ponytail: sequential pages up to RULES_MAX_PAGES (10,000 failing rules); a server-side "all" read if one object ever fails more.
  const findings: Awaited<ReturnType<typeof getFindings>>["findings"] = [];
  for (let page = 0; page < RULES_MAX_PAGES; page++) {
    const list = await getFindings({ module, version_id: run ?? undefined, type: "rule", failing: true, sort: "impact", limit: RULES_PAGE, offset: page * RULES_PAGE });
    findings.push(...list.findings);
    if (list.findings.length < RULES_PAGE || findings.length >= list.total) break;
  }
  return findings.map((f) => ({
    check_id: f.check_id,
    name: f.details.message ?? f.check_id,
    field: typeof f.details.field_checked === "string" ? f.details.field_checked : null,
    severity: f.severity === "warning" ? "medium" : f.severity,
    affected_count: f.affected_count,
    total_count: f.total_count,
    pass_rate: f.pass_rate,
    value_at_risk: f.cost_at_risk ?? null,
    dimension: (f.dimension as DimensionKey | undefined) ?? null,
    check_class: f.check_class ?? null,
    why: f.rule_context?.why_it_matters ?? null,
    field_description: f.business_name ?? null,
  }));
}
