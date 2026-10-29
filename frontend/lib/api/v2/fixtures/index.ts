import landscapeJson from "./landscape.json";
import receiptsJson from "./receipts.json";
import workJson from "./work.json";
import runsJson from "./runs.json";
import rulesJson from "./rules.json";
import type { CommandGroup, CommandResult, Landscape, Receipt, RuleRow, RunList, StatusStrip, WorkPage } from "../types";
import { moduleSlug, systemSlug } from "@/lib/v2/score";
import { NONE, runsFixtureResponse } from "./runs";

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
    { id: "approvals", title: "Approvals waiting 612", href: "/v2/work?status=waiting", kw: "approve approval approvals waiting" },
    { id: "export", title: "Export fix sheet", href: "/v2/work?export=1", kw: "export fix sheet" },
    { id: "extract", title: `Extract ${ecc.name}`, href: `/v2?open=system:${ecc.id}`, kw: "extract extraction system" },
  ];
  const actItems = actions.filter((a) => text.length >= 2 && text.split(/\s+/).every((t) => a.kw.includes(t))).map(({ id, title, href }) => ({ id, title, href }));
  if (actItems.length) groups.push({ kind: "action", label: "Actions", items: actItems });
  return { groups };
}

/** The answer to one v2 read in fixture mode. Throws a 404-shaped error for a path the contract does not have. */
export function fixtureResponse<T>(path: string, params: Params): T {
  const runsStep = runsFixtureResponse(path, params);
  if (runsStep !== NONE) return runsStep as T;
  const out = ((): unknown => {
    if (path === "/landscape") return landscapeFixture;
    if (path === "/status") return landscapeFixture.status_strip as StatusStrip;
    const receipt = /^\/objects\/([^/]+)\/receipt$/.exec(path);
    if (receipt) {
      const r = receipts[decodeURIComponent(receipt[1])];
      if (!r) throw new FixtureNotFound(path);
      return r;
    }
    if (path === "/command") return command(String(params.q ?? ""));
    if (path === "/versions") return { ...runs, versions: runs.versions.slice(0, Number(params.limit ?? 8)) };
    if (path === "/work/records") return { ...work, items: work.items.slice(0, Number(params.limit ?? work.items.length)) };
    if (path === "/shell/counts") return { fix: work.total, inbox: 7 };
    if (path === "/findings") {
      const rows = Number(params.rows ?? 0);
      if (rows > 0) return { rules: syntheticRules(Math.min(rows, 200000)) };
      return { rules: params.module === "material_master" ? baseRules : [] };
    }
    throw new FixtureNotFound(path);
  })();
  return out as T;
}
