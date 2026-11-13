/**
 * Fixture for GET /objects/portfolio and POST /objects/portfolio/start: 100 objects over the fixture's systems, five
 * runs each (500 runs), so the portfolio screens page, sort and filter on the "server" as they do live. Numbers come
 * from a fixed formula of the row index, never random, so tests and screenshots are stable. No names of people.
 */
import landscapeJson from "./landscape.json";
import type { Landscape } from "../types";
import type { CycleStep, PortfolioRow } from "@/lib/api/next/portfolio";

export const NONE_PORTFOLIO = Symbol("no-portfolio-fixture");
type Params = Record<string, string | number | boolean | undefined>;

const SYSTEMS = (landscapeJson as unknown as Landscape).systems;
const OBJECTS = [
  "material_master", "business_partner", "accounts_payable", "accounts_receivable", "fi_gl", "asset_accounting",
  "cost_center", "profit_center", "bill_of_materials", "routing", "work_center", "equipment", "functional_location",
  "purchase_info_record", "source_list", "pricing_condition", "sales_order", "purchase_order", "batch", "storage_bin",
  "warehouse_product", "bank_master", "employee_central", "position", "org_unit", "cost_element", "internal_order",
  "wbs_element", "maintenance_plan", "task_list", "characteristic", "class", "customer_material_info", "inspection_plan",
];
const OWNERS = ["Data office", "Finance data team", "Supply chain data team", null];
const STEPS: CycleStep[] = ["pull", "clean", "upload", "score", "compare"];
const NOW = Date.parse("2026-11-12T08:00:00Z");
const DAY = 86_400_000;
const hex = (n: number, w: number) => n.toString(16).padStart(w, "0");

function build(): PortfolioRow[] {
  const rows: PortfolioRow[] = [];
  for (let i = 0; i < 100; i++) {
    const sys = SYSTEMS[i % SYSTEMS.length];
    const mod = OBJECTS[Math.floor(i / SYSTEMS.length) % OBJECTS.length];
    const base = 52 + ((i * 37) % 44);
    const trend = [0, 1, 2, 3, 4].map((k) => Math.min(99, base - 8 + k * 2 + ((i + k) % 3)));
    const score = trend[4];
    const step = STEPS[i % STEPS.length];
    const runAt = new Date(NOW - ((i * 5) % 40) * DAY).toISOString();
    rows.push({
      module: mod,
      label: mod.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
      version_id: `f0000000-0000-4000-8000-${hex(i, 12)}`,
      run_at: runAt,
      system_id: sys.id,
      composite_score: score,
      raw_score: Math.max(0, score - 3),
      measured_score: score,
      capped: i % 11 === 0,
      readiness: score >= 85 ? "pass" : score >= 70 ? "warn" : "fail",
      step,
      cycle: { number: 1 + (i % 4), step, since: new Date(NOW - (i % 9) * DAY).toISOString(), parent_run: step === "pull" ? null : `f0000000-0000-4000-8001-${hex(i, 12)}`, downloaded_at: step === "upload" ? runAt : null, downloaded_by: null },
      run_number: 5,
      owner: OWNERS[i % OWNERS.length],
      trend,
      previous_score: trend[3],
      new_issues: (i * 13) % 47,
      regressed: (i * 7) % 11,
      resolved: (i * 17) % 61,
      freshness: (i * 5) % 40 > 30 ? "stale" : "fresh",
    });
  }
  return rows;
}

const ROWS = build();

export function portfolioRead(path: string, params: Params): unknown {
  if (path !== "/objects/portfolio") return NONE_PORTFOLIO;
  const q = String(params.q ?? "").toLowerCase();
  let rows = ROWS.filter((r) =>
    (!q || r.module.includes(q) || r.label.toLowerCase().includes(q)) &&
    (!params.system_id || r.system_id === params.system_id) &&
    (!params.owner || r.owner === params.owner) &&
    (!params.step || r.step === params.step) &&
    (!params.readiness || r.readiness === params.readiness));
  const sort = String(params.sort ?? "module");
  const key = sort.replace(/^-/, "") as keyof PortfolioRow;
  const dir = sort.startsWith("-") ? -1 : 1;
  rows = [...rows].sort((a, b) => {
    const x = a[key] ?? "", y = b[key] ?? "";
    return (x < y ? -1 : x > y ? 1 : 0) * dir || a.version_id.localeCompare(b.version_id);
  });
  const limit = Number(params.limit ?? 50), offset = Number(params.offset ?? 0);
  const page = rows.slice(offset, offset + limit);
  return { objects: page, total: rows.length, limit, offset, next_offset: offset + limit < rows.length ? offset + limit : null };
}

export function portfolioWrite(method: string, path: string, body: unknown): unknown {
  if (method !== "POST" || path !== "/objects/portfolio/start") return NONE_PORTFOLIO;
  return { queued: (body as { module_ids: string[] }).module_ids, skipped: [] };
}
