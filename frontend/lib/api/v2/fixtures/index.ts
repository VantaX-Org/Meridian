import landscapeJson from "./landscape.json";
import receiptsJson from "./receipts.json";
import workJson from "./work.json";
import runsJson from "./runs.json";
import rulesJson from "./rules.json";
import type { CommandGroup, CommandResult, Landscape, Receipt, RuleRow, RunList, StatusStrip, WorkPage } from "../types";
import { moduleSlug, systemSlug } from "@/lib/v2/score";
import { NONE, runsFixtureResponse } from "./runs";
import { objectFixture } from "./object";
import * as wf from "./work-fixture";

/**
 * Fixture answers for the step 0 contract, built from the approved prototype's numbers: 3 systems (ECC production
 * analysed, S/4HANA sandbox extracted, SuccessFactors not extracted), 15 objects on ECC production, Material master at
 * 71.8 measured and 70.0 shown. The capping rules beyond the two the prototype names, and every non-Material-master
 * failing count, are the prototype's inventions in the product's vocabulary: the counts are null there, not made up.
 */
export const landscapeFixture = landscapeJson as unknown as Landscape;
const receipts = receiptsJson as unknown as Record<string, Receipt>;
const work = workJson as unknown as WorkPage;
const runs = runsJson as unknown as RunList;
const baseRules = (rulesJson as unknown as { rules: RuleRow[] }).rules;

type Params = Record<string, string | number | boolean | undefined>;

class FixtureNotFound extends Error {
  status = 404;
  constructor(path: string) {
    super(`No fixture for ${path}`);
  }
}

/** A deterministic list of `n` rules for the grid check: ids ZR000001 and up, severity and counts spread by index. */
export function syntheticRules(n: number): RuleRow[] {
  const sev: RuleRow["severity"][] = ["critical", "high", "medium", "low"];
  const out: RuleRow[] = [];
  for (let i = 0; i < n; i++) {
    const total = 61816;
    const failing = (i * 7919) % 4000;
    out.push({
      check_id: `ZR${String(i + 1).padStart(6, "0")}`,
      name: `Generated rule ${i + 1}`,
      field: `MARA.F${String((i % 90) + 1).padStart(2, "0")}`,
      severity: sev[i % 4],
      affected_count: failing,
      total_count: total,
      pass_rate: Math.round((1 - failing / total) * 10000) / 100,
      value_at_risk: failing * 38,
    });
  }
  return out;
}

function command(q: string): CommandResult {
  const text = q.trim().toLowerCase();
  const digits = (text.match(/\d+/g) ?? []).join("");
  const ecc = landscapeFixture.systems[0];
  const sys = systemSlug(ecc.name);
  const groups: CommandGroup[] = [];
  const records = work.items.filter((r) => (digits.length >= 2 && r.record_key.includes(digits)) || (text.length >= 2 && (r.name ?? "").toLowerCase().includes(text)));
  const seen = new Set<string>();
  const recItems = records
    .filter((r) => (seen.has(r.record_key) ? false : (seen.add(r.record_key), true)))
    .slice(0, 5)
    .map((r) => ({
      id: `${r.module}:${r.record_key}`,
      title: `Material ${r.record_key.split("=")[1]}: ${r.name ?? ""}`.trim(),
      href: `/v2/o/${sys}/${moduleSlug(r.module)}?open=record:${encodeURIComponent(`${r.module}:${r.record_key}`)}`,
    }));
  if (recItems.length) groups.push({ kind: "record", label: "Records", items: recItems });
  const rules = [...baseRules, ...Object.values(receipts).flatMap((r) => r.breaches.map((b) => ({ check_id: b.check_id, name: b.name })))];
  const seenRule = new Set<string>();
  const ruleItems = rules
    .filter((r) => text.length >= 2 && (r.check_id.toLowerCase().startsWith(text) || r.name.toLowerCase().includes(text)))
    .filter((r) => (seenRule.has(r.check_id) ? false : (seenRule.add(r.check_id), true)))
    .slice(0, 5)
    .map((r) => ({ id: r.check_id, title: `${r.check_id}: ${r.name}`, href: `/v2?open=rule:${r.check_id}` }));
  if (ruleItems.length) groups.push({ kind: "rule", label: "Rules", items: ruleItems });
  const objItems = landscapeFixture.objects
    .filter((o) => text.length >= 2 && text.split(/\s+/).every((t) => `${o.label} ${ecc.name}`.toLowerCase().includes(t)))
    .slice(0, 5)
    .map((o) => ({ id: o.module, title: `${o.label} on ${ecc.name}`, href: `/v2/o/${sys}/${moduleSlug(o.module)}` }));
  if (objItems.length) groups.push({ kind: "object", label: "Objects", items: objItems });
  const actions: { id: string; title: string; href: string; kw: string }[] = [
    { id: "approvals", title: `Approvals waiting ${wf.workRecords({ status: "proposed", limit: 1 }).total.toLocaleString("en-US")}`, href: "/v2/work?filter=approvals", kw: "approve approval approvals waiting" },
    { id: "export-fix-sheet", title: "Export fix sheet", href: "/v2/work?export=1", kw: "export fix sheet" },
    { id: "extract", title: `Extract ${ecc.name}`, href: `/v2?open=system:${ecc.id}`, kw: "extract extraction system" },
  ];
  const actItems = actions.filter((a) => text.length >= 2 && text.split(/\s+/).every((t) => a.kw.includes(t))).map(({ id, title, href }) => ({ id, title, href }));
  if (actItems.length) groups.push({ kind: "action", label: "Actions", items: actItems });
  return { groups };
}

/** The landscape with the open work of Material master following the decisions made on the ledger. */
function withOpenDelta(l: Landscape): Landscape {
  const delta = wf.workOpenDelta();
  if (delta === 0) return l;
  return { ...l, cells: l.cells.map((c) => (c.module === "material_master" && c.open_work != null ? { ...c, open_work: c.open_work + delta } : c)) };
}

/** A write in fixture mode (POST, PUT, DELETE): applied to the in-memory work fixture. */
export function fixtureWrite<T>(method: string, path: string, body: unknown, params: Params): T {
  const out = ((): unknown => {
    if (method === "POST" && path === "/work/decide") return wf.decideFixture(body as { items: never[] });
    const group = /^\/work\/groups\/([^/]+)\/(accept-all|set-value)$/.exec(path);
    if (method === "POST" && group) return group[2] === "accept-all" ? wf.acceptAllFixture(decodeURIComponent(group[1])) : wf.setValueFixture(decodeURIComponent(group[1]), body as { value: string });
    if (method === "POST" && path === "/actions/undo") return wf.undoFixture(body as { action_id: string });
    const batch = /^\/remediation\/batches\/[^/]+\/(approve|send-back)$/.exec(path);
    if (method === "POST" && batch) return wf.batchFixture(batch[1] as "approve" | "send-back");
    if (method === "PUT" && path === "/views") return wf.putViewFixture(body as never);
    void params;
    throw new FixtureNotFound(`${method} ${path}`);
  })();
  return out as T;
}

export const fixtureExport = wf.exportFixture;
export const fixtureImport = wf.importFixture;
export const resetWorkFixture = wf.resetWorkFixture;

/** The answer to one v2 read in fixture mode. Throws a 404-shaped error for a path the contract does not have. */
export function fixtureResponse<T>(path: string, params: Params): T {
  const runsStep = runsFixtureResponse(path, params);
  if (runsStep !== NONE) return runsStep as T;
  const out = ((): unknown => {
    if (path === "/landscape") return withOpenDelta(landscapeFixture);
    if (path === "/status") return landscapeFixture.status_strip as StatusStrip;
    const receipt = /^\/objects\/([^/]+)\/receipt$/.exec(path);
    if (receipt) {
      const r = receipts[decodeURIComponent(receipt[1])];
      if (!r) throw new FixtureNotFound(path);
      return r;
    }
    if (path === "/command") return command(String(params.q ?? ""));
    if (path === "/versions") return { ...runs, versions: runs.versions.slice(0, Number(params.limit ?? 8)) };
    if (path === "/work/records") return wf.workRecords(params);
    if (path === "/work/summary") return wf.workSummary(params);
    if (path === "/work/groups") return wf.workGroups(params);
    const detail = /^\/work\/records\/([^/]+)\/(.+)$/.exec(path);
    if (detail) return wf.workRecord(decodeURIComponent(detail[1]), decodeURIComponent(detail[2]));
    const links = /^\/records\/([^/]+)\/(.+)\/links$/.exec(path);
    if (links) return wf.recordLinks(decodeURIComponent(links[1]), decodeURIComponent(links[2]));
    if (path === "/views") return wf.views(String(params.route ?? "work"));
    if (path === "/shell/counts") return { fix: work.total + wf.workOpenDelta(), inbox: 7 };
    if (path === "/findings") {
      const rows = Number(params.rows ?? 0);
      if (rows > 0) return { rules: syntheticRules(Math.min(rows, 200000)) };
      return { rules: params.module === "material_master" ? baseRules : [] };
    }
    const more = objectFixture(path, params);
    if (more !== undefined) return more;
    throw new FixtureNotFound(path);
  })();
  return out as T;
}
