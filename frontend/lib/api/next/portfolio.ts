/**
 * The portfolio: every object at its newest run, with its cycle step (api/routes/objects.py).
 *   GET  /objects/portfolio          sort, q, readiness, step, system_id, owner, limit (1 to 500), offset
 *   POST /objects/portfolio/start    {module_ids} (1 to 200): pull those objects now; needs trigger_sync
 *   GET  /reports/{version_id}/cleaning/{module}.xlsx   the cleaning workbook of one run
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { v2Get, v2Send } from "@/lib/api/v2/client";
import { v2Download } from "@/lib/api/v2/download";
import { useFixture } from "@/lib/api/v2/fixture";

export type CycleStep = "pull" | "clean" | "upload" | "score" | "compare";

export interface PortfolioCycle {
  number: number;
  step: CycleStep;
  since: string | null;
  parent_run: string | null;
  downloaded_at: string | null;
  downloaded_by: string | null;
}

export interface PortfolioRow {
  module: string;
  label: string;
  version_id: string;
  run_at: string | null;
  system_id: string | null;
  composite_score: number | null;
  raw_score: number | null;
  measured_score: number | null;
  capped: boolean;
  readiness: "pass" | "warn" | "fail" | null;
  step: CycleStep | null;
  cycle: PortfolioCycle | null;
  run_number: number | null;
  owner: string | null;
  trend: number[];
  previous_score: number | null;
  new_issues: number;
  regressed: number;
  resolved: number;
  freshness: string | null;
}

export interface PortfolioPage {
  objects: PortfolioRow[];
  total: number;
  limit: number;
  offset: number;
  next_offset: number | null;
}

export interface PortfolioQuery {
  sort?: string;
  q?: string;
  readiness?: string;
  step?: CycleStep;
  system_id?: string;
  owner?: string;
  limit?: number;
  offset?: number;
}

export function getPortfolio(q: PortfolioQuery = {}): Promise<PortfolioPage> {
  return v2Get<PortfolioPage>("/objects/portfolio", { ...q, q: q.q || undefined });
}

/** Every page of the portfolio from q.offset on, joined into one page. The API caps one page at 500 objects. */
export async function getPortfolioAll(q: PortfolioQuery = {}, get: (q: PortfolioQuery) => Promise<PortfolioPage> = getPortfolio): Promise<PortfolioPage> {
  const first = await get({ ...q, limit: 500 });
  const objects = [...first.objects];
  let next = first.next_offset;
  while (next != null && objects.length < first.total) {
    const page = await get({ ...q, limit: 500, offset: next });
    if (!page.objects.length) break;
    objects.push(...page.objects);
    next = page.next_offset;
  }
  return { objects, total: first.total, limit: objects.length, offset: first.offset, next_offset: null };
}

/** One page of the portfolio, or with all set every page joined. */
export function usePortfolio(q: PortfolioQuery, all = false) {
  const fixture = useFixture();
  return useQuery({ queryKey: ["next", "portfolio", fixture, q, all], queryFn: () => (all ? getPortfolioAll(q) : getPortfolio(q)), placeholderData: keepPreviousData });
}

export function startObjects(moduleIds: string[]): Promise<{ queued: string[]; skipped: string[] }> {
  return v2Send("POST", "/objects/portfolio/start", { module_ids: moduleIds });
}

export function downloadWorkbook(row: Pick<PortfolioRow, "version_id" | "module">): Promise<string> {
  return v2Download(`/reports/${row.version_id}/cleaning/${row.module}.xlsx`, undefined, `${row.module}-cleaning.xlsx`);
}

/** The step a card acts on: "ready" once a compared run passes the readiness band. */
export function actionOf(row: PortfolioRow): CycleStep | "ready" {
  const step = row.step ?? "pull";
  return step === "compare" && row.readiness === "pass" ? "ready" : step;
}

/** Whole days since the object entered its current step. */
export function daysOnStep(row: PortfolioRow, now = Date.now()): number | null {
  const since = row.cycle?.since;
  return since ? Math.max(0, Math.floor((now - Date.parse(since)) / 86_400_000)) : null;
}
