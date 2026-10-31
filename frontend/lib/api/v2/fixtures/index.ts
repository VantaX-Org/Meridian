import landscapeJson from "./landscape.json";
import receiptsJson from "./receipts.json";
import workJson from "./work.json";
import runsJson from "./runs.json";
import rulesJson from "./rules.json";
import type { CommandGroup, CommandResult, Landscape, Receipt, RuleRow, RunList, StatusStrip, WorkPage } from "../types";
import { moduleSlug, systemSlug } from "@/lib/v2/score";
import { fixtureParam } from "../fixture";
import { NONE, runsFixtureResponse } from "./runs";
import { objectFixture } from "./object";
import { failingRulesOf } from "./library";
import { mdmFixture, mdmFixtureWrite } from "./mdm";
import * as wf from "./work-fixture";
import * as ap from "./approvals";
import { NOT_MINE, resetSys6b, sys6bRead, sys6bWrite, withSystems } from "./sys6b";
import { NONE_ROLES, resetRolesFixture, rolesFixtureResponse, rolesFixtureWrite } from "./roles";
import { adminFixtureResponse, adminFixtureWrite, fixtureDownload as adminFixtureDownload, NONE_ADMIN } from "./admin";
import { enterpriseFixtureDownload, enterpriseFixtureResponse, enterpriseFixtureWrite, NONE_ENTERPRISE } from "./enterprise";
import { NONE_STEP9, receiptContractBreaches, resetStep9Fixture, step9Download, step9Read, step9Write, withContractMarks } from "./step9";
import { guardDecision, NONE_STEP10, receiptPolicy, resetStep10Fixture, step10Read, step10Write, withPolicyMarks, withSandbox } from "./step10";

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
      href: `/o/${sys}/${moduleSlug(r.module)}?open=record:${encodeURIComponent(`${r.module}:${r.record_key}`)}`,
    }));
  if (recItems.length) groups.push({ kind: "record", label: "Records", items: recItems });
  const rules = [...baseRules, ...Object.values(receipts).flatMap((r) => r.breaches.map((b) => ({ check_id: b.check_id, name: b.name })))];
  const seenRule = new Set<string>();
  const ruleItems = rules
    .filter((r) => text.length >= 2 && (r.check_id.toLowerCase().startsWith(text) || r.name.toLowerCase().includes(text)))
    .filter((r) => (seenRule.has(r.check_id) ? false : (seenRule.add(r.check_id), true)))
    .slice(0, 5)
    .map((r) => ({ id: r.check_id, title: `${r.check_id}: ${r.name}`, href: `/?open=rule:${r.check_id}` }));
  if (ruleItems.length) groups.push({ kind: "rule", label: "Rules", items: ruleItems });
  const objItems = landscapeFixture.objects
    .filter((o) => text.length >= 2 && text.split(/\s+/).every((t) => `${o.label} ${ecc.name}`.toLowerCase().includes(t)))
    .slice(0, 5)
    .map((o) => ({ id: o.module, title: `${o.label} on ${ecc.name}`, href: `/o/${sys}/${moduleSlug(o.module)}` }));
  if (objItems.length) groups.push({ kind: "object", label: "Objects", items: objItems });
  const actions: { id: string; title: string; href: string; kw: string }[] = [
    { id: "approvals", title: `Approvals waiting ${wf.workRecords({ status: "proposed", limit: 1 }).total.toLocaleString("en-US")}`, href: "/work?filter=approvals", kw: "approve approval approvals waiting" },
    { id: "export-fix-sheet", title: "Export fix sheet", href: "/work?export=1", kw: "export fix sheet" },
    { id: "extract", title: `Extract ${ecc.name}`, href: `/?open=system:${ecc.id}`, kw: "extract extraction system" },
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
  const step10 = step10Write(method, path, body);
  if (step10 !== NONE_STEP10) return step10 as T;
  if (method === "POST" && (path === "/work/decide" || /^\/work\/groups\/[^/]+\/(accept-all|set-value)$/.test(path))) guardDecision();
  const step9 = step9Write(method, path, body);
  if (step9 !== NONE_STEP9) return step9 as T;
  const roles = rolesFixtureWrite(method, path, body, params);
  if (roles !== NONE_ROLES) return roles as T;
  const out = ((): unknown => {
    const s6 = sys6bWrite(method, path, body);
    if (s6 !== NOT_MINE) return s6;
    if (method === "POST" && path === "/work/decide") return wf.decideFixture(body as { items: never[] });
    const group = /^\/work\/groups\/([^/]+)\/(accept-all|set-value)$/.exec(path);
    if (method === "POST" && group) return group[2] === "accept-all" ? wf.acceptAllFixture(decodeURIComponent(group[1])) : wf.setValueFixture(decodeURIComponent(group[1]), body as { value: string });
    if (method === "POST" && path === "/actions/undo") return wf.undoFixture(body as { action_id: string });
    const batch = /^\/remediation\/batches\/([^/]+)\/(approve|send-back)$/.exec(path);
    if (method === "POST" && batch) return wf.batchFixture(batch[2] as "approve" | "send-back", decodeURIComponent(batch[1]), (body as { note?: string } | undefined)?.note, (body as { without_blank?: boolean } | undefined)?.without_blank === true);
    const send = /^\/remediation\/batches\/([^/]+)\/export$/.exec(path);
    if (method === "POST" && send) return wf.sendBatchFixture(decodeURIComponent(send[1]));
    const loaded = /^\/remediation\/batches\/([^/]+)\/loaded$/.exec(path);
    if (method === "POST" && loaded) return wf.loadedBatchFixture(decodeURIComponent(loaded[1]));
    const live = /^\/writeback\/batches\/([^/]+)\/(check|send)$/.exec(path);
    if (method === "POST" && live) return live[2] === "check" ? wf.writebackCheckFixture(decodeURIComponent(live[1])) : wf.writebackSendFixture(decodeURIComponent(live[1]));
    const read = /^\/notifications\/([^/]+)\/read$/.exec(path);
    if (method === "PUT" && path === "/notifications/read-all") return ap.readAllFixture();
    if (method === "PUT" && read) return ap.readFixture(decodeURIComponent(read[1]));
    const remind = /^\/people\/([^/]+)\/remind$/.exec(path);
    if (method === "POST" && remind) return ap.remindFixture(decodeURIComponent(remind[1]));
    if (method === "PUT" && path === "/triage/sla-policies") return ap.putPolicyFixture(body as never);
    if (method === "PUT" && path === "/views") return wf.putViewFixture(body as never);
    const mdm = mdmFixtureWrite(method, path, body);
    if (mdm !== undefined) return mdm;
    const ent = enterpriseFixtureWrite(method, path, body);
    if (ent !== NONE_ENTERPRISE) return ent;
    const admin = adminFixtureWrite(method, path, body, params);
    if (admin !== NONE_ADMIN) return admin;
    void params;
    throw new FixtureNotFound(`${method} ${path}`);
  })();
  return out as T;
}

export { resetAdminFixture } from "./admin";
export { resetEnterpriseFixture } from "./enterprise";

/** A file in fixture mode: the step 9 certificate PDF, the enterprise stand-ins, then the admin area's. */
export function fixtureDownload(path: string, params: Record<string, unknown>, fallback: string): { name: string; text: string } {
  return step9Download(path) ?? enterpriseFixtureDownload(path) ?? adminFixtureDownload(path, params, fallback);
}
export const fixtureExport = wf.exportFixture;
export const fixtureImport = wf.importFixture;
export const resetWorkFixture = (): void => {
  wf.resetWorkFixture();
  ap.resetApprovalsFixture();
  resetSys6b();
  resetRolesFixture();
  resetStep9Fixture();
  resetStep10Fixture();
};
export { resetStep9Fixture, resetStep10Fixture };

/** The answer to one v2 read in fixture mode. Throws a 404-shaped error for a path the contract does not have. */
export function fixtureResponse<T>(path: string, params: Params): T {
  const step10 = step10Read(path, params);
  if (step10 !== NONE_STEP10) return step10 as T;
  const step9 = step9Read(path, params);
  if (step9 !== NONE_STEP9) return step9 as T;
  const rolesStep = rolesFixtureResponse(path, params);
  if (rolesStep !== NONE_ROLES) return rolesStep as T;
  const ent = enterpriseFixtureResponse(path);
  if (ent !== NONE_ENTERPRISE) return ent as T;
  const adminStep = adminFixtureResponse(path, params);
  if (adminStep !== NONE_ADMIN) return adminStep as T;
  const s6 = sys6bRead(path, params);
  if (s6 !== NOT_MINE) return s6 as T;
  const runsStep = runsFixtureResponse(path, params);
  if (runsStep !== NONE) return runsStep as T;
  // `?landscape=empty`: a tenant on its first day, with no system connected and nothing uploaded (the guided start).
  if (fixtureParam("landscape") === "empty") {
    if (path === "/landscape") return { ...landscapeFixture, systems: [], objects: [], cells: [], counts: { go: 0, at_risk: 0, no_go: 0 }, status_strip: { ...landscapeFixture.status_strip, run_at: null, records_checked: null, rules_measured: null } } as T;
    if (path === "/work/summary") return { ...(wf.workSummary(params) as object), objects: [] } as T;
    if (path === "/status") return { ...landscapeFixture.status_strip, run_at: null, records_checked: null, rules_measured: null, scored_in_s: null } as T;
    if (path === "/shell/counts") return { fix: 0, inbox: ap.unreadFixture().count } as T;
  }
  const out = ((): unknown => {
    if (path === "/landscape") return withPolicyMarks(withContractMarks(withSystems(withOpenDelta(landscapeFixture))));
    if (path === "/status") return withSandbox(landscapeFixture.status_strip as StatusStrip);
    const receipt = /^\/objects\/([^/]+)\/receipt$/.exec(path);
    if (receipt) {
      const r = receipts[decodeURIComponent(receipt[1])];
      if (!r) throw new FixtureNotFound(path);
      return { ...r, contract_breaches: receiptContractBreaches(r.module), ...receiptPolicy(r.module) };
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
    if (path === "/shell/counts") return { fix: work.total + wf.workOpenDelta(), inbox: ap.unreadFixture().count };
    if (path === "/remediation/batches") return wf.batchesFixture();
    const events = /^\/remediation\/batches\/([^/]+)\/events$/.exec(path);
    if (events) return wf.batchEventsFixture(decodeURIComponent(events[1]));
    const batchOne = /^\/remediation\/batches\/([^/]+)$/.exec(path);
    if (batchOne) return wf.batchFixtureDetail(decodeURIComponent(batchOne[1]));
    if (path === "/writeback/approvals") return { approvals: [], live_enabled: false };
    if (path === "/people") return ap.peopleFixture();
    if (path === "/people/next") return ap.nextFixture();
    if (path === "/notifications") return ap.notificationsFixture(Number(params.limit ?? 50));
    if (path === "/notifications/unread-count") return ap.unreadFixture();
    if (path === "/triage/sla-policies") return ap.policiesFixture();
    if (path === "/users/assignable") return ap.assignableFixture();
    if (path === "/findings") {
      const rows = Number(params.rows ?? 0);
      if (rows > 0) return { rules: syntheticRules(Math.min(rows, 200000)) };
      const mod = String(params.module ?? "");
      return { rules: mod === "material_master" ? baseRules : failingRulesOf(mod) };
    }
    const more = objectFixture(path, params);
    if (more !== undefined) return more;
    const mdm = mdmFixture(path, params);
    if (mdm !== undefined) return mdm;
    throw new FixtureNotFound(path);
  })();
  return out as T;
}
