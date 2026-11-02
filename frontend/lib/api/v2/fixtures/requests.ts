/**
 * Fixture answers for change requests and the workflow engine (`?fixture=1`). This file owns exactly the paths below;
 * every other path answers NONE_REQ and falls through.
 *
 *   /change-requests (GET, POST), /change-requests/{id} (GET), /validate, /submit, /decide, /cancel, /retry,
 *   /comments, /attachments, GET /change-requests/{id}/export, GET /change-requests/{id}/field-history, GET /change-requests/{id}/preview,
 *   GET and PUT /change-requests/defaults, DELETE /change-requests/defaults/{id}
 *   GET and PUT /change-requests/derivations and /change-requests/critical-fields, DELETE on {id} of each
 *   GET /workflows/definitions, /workflows/facts, /workflows/tasks; POST /workflows/definitions, /workflows/definitions/validate,
 *   /workflows/definitions/{id}/versions, /activate, /workflows/tasks/{id}/decide
 *
 * The demo user (u-me) requested CR-1002 to CR-1004; R. Govender's CR-1001 waits for the demo user's approval, and so
 * does the first step of batch B-241. Writes change the state until the fixture is reset.
 */
import type { ChangeRequest, CriticalField, Derivation, DryRun, EntryDefault, Facts, FieldChange, Precheck, RequestDetail, TaskRow, WorkflowDefinition, WorkflowEvent } from "../requests";
import * as wf from "./work-fixture";

export const NONE_REQ = Symbol("no-requests-fixture");

const ME = "u-me";
const ME_LABEL = "Demo user";
const ECC = "a1b2c3d4-0001-4000-8000-000000000001";
const NOW = "2026-10-20T08:00:00Z";
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function fail(status: number, detail: string): never {
  throw Object.assign(new Error(detail), { status, response: { status, data: { detail } } });
}

const four = { steps: [{ name: "Four-eyes approval", assignee: { rule: "role", action: "approve" }, quorum: "any", sla_hours: 48, escalate: true, requester_may_approve: false }], notify_requester: true, distinct_approvers: true };
const twoStep = {
  steps: [
    four.steps[0],
    { name: "Finance sign-off", assignee: { rule: "role", roles: ["finance_controller"] }, quorum: "any", sla_hours: 72, escalate: true, requester_may_approve: false, when: [{ fact: "value_at_risk", op: "gte", value: 100000 }] },
  ],
  notify_requester: true,
  distinct_approvers: true,
};

const def = (id: string, key: string, name: string, kind: string, version: number, active: boolean, definition: Record<string, unknown>, at: string): WorkflowDefinition => ({
  id, key, name, description: null, object_kind: kind, version, active, definition, created_by_label: "System", created_at: at, activated_at: active ? at : null, activated_by_label: active ? "System" : null,
});

const precheck = (failures: Precheck["failures"], duplicates: Precheck["duplicates"] = []): Precheck => ({ problems: [], rules_run: 214, failures, duplicates, checked_at: "2026-10-18T09:00:00Z" });

const req = (r: Partial<ChangeRequest> & Pick<ChangeRequest, "id" | "kind" | "object" | "status" | "title" | "payload">): ChangeRequest => ({
  target_system_id: ECC, object_key: null, record_count: 0, requester_id: ME, requester_label: ME_LABEL, workflow_instance_id: null, precheck: null, validated_at: null, sap_key: null, sap_result: null,
  sap_phase: null, sap_attempts: 0, delivery: null, has_export: false, reason: null, created_at: "2026-10-18T08:00:00Z", updated_at: "2026-10-18T08:00:00Z", submitted_at: null, decided_at: null, completed_at: null, due_at: null, waiting_step: null, age_hours: null, overdue: false, critical_fields: [], ...r,
});

const ev = (id: string, action: string, actor: string | null, at: string, to: string | null = null, detail: Record<string, unknown> | null = null): WorkflowEvent => ({ id, action, from_status: null, to_status: to, actor_label: actor, detail, created_at: at });

interface State {
  defs: WorkflowDefinition[];
  details: RequestDetail[];
  tasks: TaskRow[];
  defaults: EntryDefault[];
  derivations: Derivation[];
  criticalFields: CriticalField[];
  fields: Record<string, FieldChange[]>;
  /** The record keys each mass change draft names. */
  keys: Record<string, string[]>;
  seq: number;
}

/** The materials a mass change preview knows: current value of each field and the description beside the key. */
const MASS_KNOWN: Record<string, { text: string; fields: Record<string, string> }> = {
  "MATNR=000000000000000101": { text: "Hex bolt M8 x 40", fields: { "MARC.DISPO": "M02", "MARC.EKGRP": "P10" } },
  "MATNR=000000000000000102": { text: "Washer 8 mm", fields: { "MARC.DISPO": "N01", "MARC.EKGRP": "P10" } },
  "MATNR=000000000000000103": { text: "Hydraulic seal kit 80 mm", fields: { "MARC.EKGRP": "P20" } },
};
const matnr = (k: string): string => (/^MATNR=(\d+)$/.exec(k) ? `MATNR=${k.slice(6).padStart(18, "0")}` : k);

function massPreview(keys: string[], payload: Record<string, string>): { counts: Record<string, number>; rows: { record_key: string; field: string; before: string | null; after: string; unchanged: boolean; known: boolean; text: string | null }[]; truncated: boolean } {
  const rows = keys.flatMap((k) => {
    const m = MASS_KNOWN[matnr(k)];
    return Object.entries(payload).map(([field, after]) => {
      const before = m?.fields[field] ?? null;
      return { record_key: k, field, before, after, unchanged: before === after, known: !!m, text: m?.text ?? null };
    });
  });
  const fields = Object.keys(payload).length;
  const found = keys.filter((k) => MASS_KNOWN[matnr(k)]).length;
  const unchanged = fields === 1 ? rows.filter((r) => r.unchanged).length : 0;
  return { counts: { records: keys.length, found, missing: keys.length - found, changing: keys.length - unchanged, unchanged, fields }, rows, truncated: false };
}

function initial(): State {
  const cr1 = req({
    id: "CR-1001", kind: "create", object: "material", status: "in_approval", title: "New spare part: hydraulic seal kit", requester_id: "u-rg", requester_label: "R. Govender",
    payload: { "MARA.MTART": "ERSA", "MARA.MBRSH": "M", "MARA.MEINS": "EA", "MAKT.MAKTX": "Hydraulic seal kit 80 mm", "MAKT.SPRAS": "EN", "MARC.WERKS": "1000" },
    critical_fields: ["MARA.MTART"], workflow_instance_id: "WI-1001", precheck: precheck([{ check_id: "MM022", severity: "high", dimension: "completeness", field: "MARA.MATKL", message: "Material group is blank." }], [{ master_record_id: "MR-88120", domain: "material", sap_object_key: "MATNR=100-4471", score: 0.91, band: "likely", attributes: [{ field: "MAKT.MAKTX", similarity: 0.93, value: "Hydraulic seal kit 80mm" }] }]),
    validated_at: "2026-10-18T09:00:00Z", submitted_at: "2026-10-18T09:05:00Z", created_at: "2026-10-18T08:40:00Z", updated_at: "2026-10-18T09:05:00Z",
    due_at: "2026-10-22T09:05:00Z", waiting_step: "Four-eyes approval", age_hours: 46.9,
  });
  const cr2 = req({
    id: "CR-1002", kind: "change", object: "customer", status: "approved", title: "Payment terms for Karoo Mining", object_key: "KUNNR=0000204411", payload: { "KNB1.ZTERM": "NT30" },
    workflow_instance_id: "WI-1002", precheck: precheck([]), validated_at: "2026-10-16T10:00:00Z", has_export: true, reason: "Live write-back is off; the load file holds the change.",
    submitted_at: "2026-10-16T10:02:00Z", decided_at: "2026-10-17T07:30:00Z", created_at: "2026-10-16T09:50:00Z", updated_at: "2026-10-17T07:30:00Z",
  });
  const cr3 = req({
    id: "CR-1003", kind: "create", object: "vendor", status: "failed", title: "New vendor: Highveld Freight", payload: { "BUT000.TYPE": "2", "BUT000.NAME_ORG1": "Highveld Freight (Pty) Ltd", "ADRC.COUNTRY": "ZA", "LFB1.BUKRS": "1000" },
    workflow_instance_id: "WI-1003", precheck: precheck([]), validated_at: "2026-10-15T08:00:00Z", sap_phase: "create", sap_attempts: 3,
    sap_result: { messages: [{ type: "E", message: "Partner group 0002 is not defined for role FLVN00." }] }, reason: "SAP refused the create.",
    submitted_at: "2026-10-15T08:01:00Z", decided_at: "2026-10-15T12:00:00Z", completed_at: "2026-10-15T12:04:00Z", created_at: "2026-10-15T07:55:00Z", updated_at: "2026-10-15T12:04:00Z",
  });
  const cr4 = req({ id: "CR-1004", kind: "create", object: "material", status: "draft", title: "Bearing 6204 for plant 1000", payload: { "MARA.MTART": "ERSA", "MAKT.MAKTX": "Deep groove ball bearing 6204" } });
  const task = (id: string, inst: string, kind: string, obj: string, title: string, by: string, at: string): TaskRow => ({
    id, instance_id: inst, step_index: 0, step_name: "Four-eyes approval", status: "pending", quorum: "any", assigned_users: [ME], assignee_note: "Anyone holding approve", due_at: "2026-10-22T09:05:00Z",
    escalation_level: 0, activated_at: at, object_kind: kind, object_id: obj, title, requester_label: by, may_decide: true, on_behalf_of: null,
  });
  const t1 = task("T-1001", "WI-1001", "change_request", "CR-1001", cr1.title ?? "", "R. Govender", "2026-10-18T09:05:00Z");
  const decided = (inst: string, who: string, at: string) => ({ ...t1, id: `${inst}-0`, instance_id: inst, status: "approved", decided_by_label: who, decision: "approve", comment: null, decided_at: at });
  const fc = (id: string, field: string, action: FieldChange["action"], old_value: string | null, new_value: string | null, who: string | null, at: string): FieldChange => ({ id, field, action, old_value, new_value, actor_label: who, created_at: at });
  return {
    seq: 1005,
    keys: {},
    defaults: [{ id: "D-1", object: "material", field: "MARA.MEINS", value: "EA", updated_at: "2026-10-01T09:00:00Z" }],
    derivations: [{ id: "V-1", object: "material", when_field: "MARA.MTART", when_values: ["ROH"], target_field: "MARC.BESKZ", value: "F", updated_at: "2026-10-02T09:00:00Z" }],
    criticalFields: [{ id: "C-1", object: "material", field: "MARA.MTART", updated_at: "2026-10-02T09:00:00Z" }],
    fields: {
      "CR-1001": [
        fc("F-1", "MARA.MTART", "set", null, "ERSA", "R. Govender", "2026-10-18T08:40:00Z"),
        fc("F-2", "MARA.MEINS", "defaulted", null, "EA", "R. Govender", "2026-10-18T08:40:00Z"),
        fc("F-3", "MAKT.MAKTX", "set", null, "Hydraulic seal kit 80mm", "R. Govender", "2026-10-18T08:40:00Z"),
        fc("F-4", "MAKT.MAKTX", "changed", "Hydraulic seal kit 80mm", "Hydraulic seal kit 80 mm", "R. Govender", "2026-10-18T08:55:00Z"),
      ],
    },
    defs: [
      def("WD-1", "default-fix-batch", "Fix batch approval", "fix_batch", 1, true, four, "2026-09-01T00:00:00Z"),
      def("WD-2", "default-change-request", "Change request approval", "change_request", 1, false, four, "2026-09-01T00:00:00Z"),
      def("WD-3", "default-change-request", "Change request approval", "change_request", 2, true, twoStep, "2026-10-02T11:00:00Z"),
    ],
    tasks: [t1, task("T-2041", "WI-B241", "fix_batch", "B-241", "Unit of measure and material type", "R. Govender", "2026-10-14T15:42:00Z")],
    details: [
      {
        request: cr1,
        workflow: { id: "WI-1001", definition_key: "default-change-request", definition_version: 2, status: "in_progress", started_at: "2026-10-18T09:05:00Z", completed_at: null, tasks: [t1] },
        history: [ev("H-1", "started", "R. Govender", "2026-10-18T09:05:00Z", "in_progress"), ev("H-2", "step_skipped", null, "2026-10-18T09:05:00Z", null, { step: "Finance sign-off", reason: "value_at_risk is below 100000" })],
        comments: [{ id: "C-1", author_label: "R. Govender", body: "Needed for the overhaul on line 3 next week.", created_at: "2026-10-18T09:06:00Z" }],
        attachments: [{ id: "A-1", filename: "seal-kit-datasheet.pdf", content_type: "application/pdf", size_bytes: 184320, uploaded_by_label: "R. Govender", created_at: "2026-10-18T08:45:00Z" }],
      },
      {
        request: cr2,
        workflow: { id: "WI-1002", definition_key: "default-change-request", definition_version: 1, status: "approved", started_at: "2026-10-16T10:02:00Z", completed_at: "2026-10-17T07:30:00Z", tasks: [decided("WI-1002", "R. Govender", "2026-10-17T07:30:00Z")] },
        history: [ev("H-3", "started", ME_LABEL, "2026-10-16T10:02:00Z", "in_progress"), ev("H-4", "approved", "R. Govender", "2026-10-17T07:30:00Z", "approved")],
        comments: [],
        attachments: [],
      },
      {
        request: cr3,
        workflow: { id: "WI-1003", definition_key: "default-change-request", definition_version: 1, status: "approved", started_at: "2026-10-15T08:01:00Z", completed_at: "2026-10-15T12:00:00Z", tasks: [decided("WI-1003", "A. Naidoo", "2026-10-15T12:00:00Z")] },
        history: [ev("H-5", "started", ME_LABEL, "2026-10-15T08:01:00Z", "in_progress"), ev("H-6", "approved", "A. Naidoo", "2026-10-15T12:00:00Z", "approved")],
        comments: [],
        attachments: [],
      },
      { request: cr4, workflow: null, history: [], comments: [], attachments: [] },
    ],
  };
}

let state = initial();
export const resetRequestsFixture = (): void => {
  state = initial();
};

function find(id: string): RequestDetail {
  const d = state.details.find((x) => x.request.id === id);
  if (!d) fail(404, "Change request not found.");
  return d;
}

const listed = (params: Record<string, unknown>): ChangeRequest[] => {
  const view = String(params.view ?? "mine");
  const mineToDecide = new Set(state.tasks.filter((t) => t.object_kind === "change_request").map((t) => t.object_id));
  return state.details
    .map((d) => d.request)
    .filter((r) => (view === "mine" ? r.requester_id === ME : view === "to_approve" ? mineToDecide.has(r.id) : true))
    .filter((r) => !params.status || r.status === params.status)
    .filter((r) => !params.object || r.object === params.object)
    .filter((r) => !params.kind || r.kind === params.kind)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
};

/** The fields of a new create request that the tenant defaults fill; those the requester left empty. */
function withDefaults(object: string, kind: unknown, payload: Record<string, string>): { payload: Record<string, string>; filled: string[] } {
  if (kind !== "create") return { payload, filled: [] };
  const filled = state.defaults.filter((d) => d.object === object && !(payload[d.field] ?? "").trim());
  return { payload: { ...payload, ...Object.fromEntries(filled.map((d) => [d.field, d.value])) }, filled: filled.map((d) => d.field) };
}

/** Derivation rules run in order on a new request; a value that already holds is not a derivation. */
function withDerivations(object: string, payload: Record<string, string>): { payload: Record<string, string>; derived: string[] } {
  const out = { ...payload };
  const derived: string[] = [];
  for (const d of state.derivations.filter((x) => x.object === object)) {
    if (d.when_values.includes(out[d.when_field] ?? "") && out[d.target_field] !== d.value) {
      out[d.target_field] = d.value;
      derived.push(d.target_field);
    }
  }
  return { payload: out, derived };
}

const criticalOf = (object: string, payload: Record<string, string>) => state.criticalFields.filter((c) => c.object === object && c.field in payload).map((c) => c.field);

function facts(): Facts {
  return {
    facts: { object_kind: "string", kind: "string", object: "string", modules: "list", fields: "list", policy_classes: "list", value_at_risk: "number", records: "number", target_system_id: "string", rule_failures: "number", critical_failures: "number", duplicates: "number" },
    ops: ["eq", "ne", "gt", "gte", "lt", "lte", "in", "not_in", "contains", "contains_any", "exists", "not_exists"],
    assignee_rules: ["role", "users", "data_owner", "manager"],
    object_kinds: ["fix_batch", "change_request"],
  };
}

/** The dry run: each step applies unless its `when` test on a number fact fails. Enough to show the preview. */
function dryRun(body: { definition?: { steps?: { name?: string; quorum?: string; sla_hours?: number; requester_may_approve?: boolean; when?: { fact: string; op: string; value: unknown }[] }[] }; facts?: Record<string, unknown> }): DryRun {
  const steps = body.definition?.steps;
  if (!Array.isArray(steps) || steps.length === 0) return { valid: false, problems: ["A workflow has at least one step."], facts: body.facts ?? {}, steps: [] };
  const problems = steps.flatMap((s, i) => (s.name ? [] : [`Step ${i + 1} has no name.`]));
  const test = (c: { fact: string; op: string; value: unknown }): boolean => {
    const v = Number(body.facts?.[c.fact] ?? 0);
    const w = Number(c.value);
    return c.op === "gte" ? v >= w : c.op === "gt" ? v > w : c.op === "lt" ? v < w : c.op === "lte" ? v <= w : c.op === "eq" ? v === w : true;
  };
  return {
    valid: problems.length === 0,
    problems,
    facts: body.facts ?? {},
    steps: steps.map((s, i) => {
      const miss = (s.when ?? []).find((c) => !test(c));
      return { index: i, name: s.name ?? "", applies: !miss, reason: miss ? `${miss.fact} ${miss.op} ${String(miss.value)} is false` : null, quorum: s.quorum ?? "any", sla_hours: s.sla_hours ?? null, requester_may_approve: !!s.requester_may_approve, assignee_note: null, assignees: [{ id: "u-rg", name: "R. Govender" }] };
    }),
  };
}

export function requestsRead(path: string, params: Record<string, unknown>): unknown {
  if (path === "/change-requests") return { items: clone(listed(params)) };
  if (path === "/change-requests/defaults") return { items: clone(state.defaults) };
  if (path === "/change-requests/derivations") return { items: clone(state.derivations) };
  if (path === "/change-requests/critical-fields") return { items: clone(state.criticalFields) };
  const hist = /^\/change-requests\/([^/]+)\/field-history$/.exec(path);
  if (hist) {
    const id = find(decodeURIComponent(hist[1])).request.id;
    return { items: clone(state.fields[id] ?? []) };
  }
  const prev = /^\/change-requests\/([^/]+)\/preview$/.exec(path);
  if (prev) {
    const r = find(decodeURIComponent(prev[1])).request;
    if (r.kind !== "mass_change") fail(409, "Only a mass change has a preview.");
    return massPreview(state.keys[r.id] ?? [], r.payload);
  }
  const one = /^\/change-requests\/([^/]+)$/.exec(path);
  if (one) return clone(find(decodeURIComponent(one[1])));
  const inst = /^\/workflows\/instances\/([^/]+)$/.exec(path);
  if (inst) {
    const d = state.details.find((x) => x.workflow?.id === decodeURIComponent(inst[1]));
    if (!d || !d.workflow) fail(404, "Workflow not found.");
    return clone({ ...d.workflow, object_kind: "change_request", object_id: d.request.id, history: d.history });
  }
  if (path === "/workflows/definitions") return { items: clone(state.defs) };
  if (path === "/workflows/facts") return facts();
  if (path === "/workflows/tasks") return { items: clone(state.tasks.filter((t) => !params.object_kind || t.object_kind === params.object_kind)) };
  return NONE_REQ;
}

/** The export load file of an approved request, as text. */
export function requestsDownload(path: string): { name: string; text: string } | undefined {
  const m = /^\/change-requests\/([^/]+)\/export$/.exec(path);
  if (!m) return undefined;
  const r = find(decodeURIComponent(m[1])).request;
  if (!r.has_export) fail(404, "This request has no export load file.");
  return { name: `change_request_${r.id}.json`, text: JSON.stringify({ request: r.id, object: r.object, kind: r.kind, object_key: r.object_key, payload: r.payload }, null, 2) };
}

function decideRequest(d: RequestDetail, decision: string, comment: string | undefined): RequestDetail {
  if (decision === "reject" && !(comment ?? "").trim()) fail(422, "Say why you reject it.");
  if (d.request.status !== "in_approval") fail(409, `The request is ${d.request.status}.`);
  const task = state.tasks.find((t) => t.object_id === d.request.id);
  if (!task) fail(403, "No step of this request waits for you.");
  state.tasks = state.tasks.filter((t) => t !== task);
  const approved = decision === "approve";
  d.request = { ...d.request, status: approved ? "approved" : "rejected", has_export: approved, reason: approved ? "Live write-back is off; the load file holds the request." : (comment ?? null), decided_at: NOW, updated_at: NOW, due_at: null, waiting_step: null, age_hours: null, overdue: false };
  if (d.workflow) d.workflow = { ...d.workflow, status: approved ? "approved" : "rejected", completed_at: NOW, tasks: d.workflow.tasks.map((t) => (t.id === task.id ? { ...t, status: approved ? "approved" : "rejected", decided_by_label: ME_LABEL, decision, comment: comment ?? null, decided_at: NOW } : t)) };
  d.history = [...d.history, ev(`H-${state.seq++}`, approved ? "approved" : "rejected", ME_LABEL, NOW, approved ? "approved" : "rejected", comment ? { comment } : null)];
  return clone(d);
}

export function requestsWrite(method: string, path: string, body: unknown): unknown {
  const b = (body ?? {}) as Record<string, unknown>;
  if (method === "PUT" && path === "/change-requests/defaults") {
    const field = String(b.field ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9_]+\.[A-Z0-9_]+$/.test(field) || !String(b.value ?? "").trim()) fail(422, "The default is not valid.");
    const row: EntryDefault = { id: state.defaults.find((d) => d.object === b.object && d.field === field)?.id ?? `D-${state.seq++}`, object: b.object as EntryDefault["object"], field, value: String(b.value), updated_at: NOW };
    state.defaults = [...state.defaults.filter((d) => d.id !== row.id), row];
    return clone(row);
  }
  if (method === "PUT" && path === "/change-requests/derivations") {
    const ok = (f: string) => /^[A-Z0-9_]+\.[A-Z0-9_]+$/.test(f);
    const when_field = String(b.when_field ?? "").trim().toUpperCase();
    const target_field = String(b.target_field ?? "").trim().toUpperCase();
    const when_values = ((b.when_values ?? []) as string[]).map((v) => String(v).trim()).filter(Boolean);
    if (!ok(when_field) || !ok(target_field) || when_values.length === 0 || !String(b.value ?? "").trim()) fail(422, "The rule is not valid.");
    const row: Derivation = { id: `V-${state.seq++}`, object: b.object as Derivation["object"], when_field, when_values, target_field, value: String(b.value), updated_at: NOW };
    state.derivations = [...state.derivations, row];
    return clone(row);
  }
  if (method === "PUT" && path === "/change-requests/critical-fields") {
    const field = String(b.field ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9_]+\.[A-Z0-9_]+$/.test(field)) fail(422, "The field is not valid.");
    const row: CriticalField = { id: state.criticalFields.find((c) => c.object === b.object && c.field === field)?.id ?? `C-${state.seq++}`, object: b.object as CriticalField["object"], field, updated_at: NOW };
    state.criticalFields = [...state.criticalFields.filter((c) => c.id !== row.id), row];
    return clone(row);
  }
  const delRule = /^\/change-requests\/(derivations|critical-fields)\/([^/]+)$/.exec(path);
  if (method === "DELETE" && delRule) {
    const id = decodeURIComponent(delRule[2]);
    const list = delRule[1] === "derivations" ? state.derivations : state.criticalFields;
    if (!list.some((d) => d.id === id)) fail(404, "Rule not found.");
    if (delRule[1] === "derivations") state.derivations = state.derivations.filter((d) => d.id !== id);
    else state.criticalFields = state.criticalFields.filter((d) => d.id !== id);
    return { deleted: id };
  }
  const del = /^\/change-requests\/defaults\/([^/]+)$/.exec(path);
  if (method === "DELETE" && del) {
    const id = decodeURIComponent(del[1]);
    if (!state.defaults.some((d) => d.id === id)) fail(404, "Default not found.");
    state.defaults = state.defaults.filter((d) => d.id !== id);
    return { deleted: id };
  }
  if (method !== "POST") return NONE_REQ;
  if (path === "/change-requests") {
    const id = `CR-${state.seq++}`;
    const given = (b.payload ?? {}) as Record<string, string>;
    if (Object.keys(given).length === 0) fail(422, "Propose at least one field.");
    const filledIn = withDefaults(String(b.object), b.kind, given);
    const { payload, derived } = withDerivations(String(b.object), filledIn.payload);
    const filled = filledIn.filled;
    state.fields[id] = Object.entries(payload).map(([field, v], i) => ({ id: `F-${state.seq++}-${i}`, field, action: derived.includes(field) ? "derived" : filled.includes(field) ? "defaulted" : "set", old_value: null, new_value: v, actor_label: ME_LABEL, created_at: NOW }));
    if (b.kind === "change" && !String(b.object_key ?? "").trim()) fail(422, "A change names the record it changes (object_key).");
    const keys = b.kind === "mass_change" ? [...new Set(((b.record_keys ?? []) as string[]).map((k) => k.trim()).filter(Boolean))] : [];
    if (b.kind === "mass_change" && keys.length === 0) fail(422, "A mass change names the records it changes (record_keys).");
    if (keys.length > 10000) fail(422, "At most 10000 records in one mass change.");
    state.keys[id] = keys;
    const r = req({ id, kind: b.kind as ChangeRequest["kind"], object: b.object as ChangeRequest["object"], status: "draft", title: (b.title as string) || null, payload, record_count: keys.length, object_key: (b.object_key as string) || null, target_system_id: (b.target_system_id as string) || ECC, critical_fields: criticalOf(String(b.object), payload), created_at: NOW, updated_at: NOW });
    state.details = [{ request: r, workflow: null, history: [], comments: [], attachments: [] }, ...state.details];
    return clone(r);
  }
  const tdec = /^\/workflows\/tasks\/([^/]+)\/decide$/.exec(path);
  if (tdec) {
    const task = state.tasks.find((t) => t.id === decodeURIComponent(tdec[1]));
    if (!task) fail(404, "Approval step not found.");
    const comment = b.comment as string | undefined;
    if (b.decision === "reject" && !(comment ?? "").trim()) fail(422, "Say why you reject it.");
    if (task.object_kind === "change_request") return decideRequest(find(task.object_id), String(b.decision), comment);
    const out = wf.batchFixture(b.decision === "approve" ? "approve" : "send-back", task.object_id, comment);
    state.tasks = state.tasks.filter((t) => t !== task);
    return out;
  }
  if (path === "/workflows/definitions/validate") return dryRun(b as Parameters<typeof dryRun>[0]);
  if (path === "/workflows/definitions") {
    const check = dryRun({ definition: b.definition as Parameters<typeof dryRun>[0]["definition"] });
    if (!check.valid) fail(422, check.problems.join(" "));
    const name = String(b.name ?? "").trim();
    const key = (b.key as string | undefined) || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "workflow";
    if (state.defs.some((d) => d.key === key)) fail(409, `A workflow with the key ${key} exists; add a version to it.`);
    const made = def(`WD-${state.seq++}`, key, name, String(b.object_kind), 1, false, b.definition as Record<string, unknown>, NOW);
    made.description = (b.description as string | undefined) ?? null;
    made.created_by_label = ME_LABEL;
    state.defs = [...state.defs, made];
    if (b.activate) state.defs = state.defs.map((x) => (x.id === made.id ? { ...x, active: true, activated_at: NOW, activated_by_label: ME_LABEL } : x.key === key ? { ...x, active: false } : x));
    return clone(state.defs.find((x) => x.id === made.id) as WorkflowDefinition);
  }
  const ver = /^\/workflows\/definitions\/([^/]+)\/(versions|activate)$/.exec(path);
  if (ver) {
    const base = state.defs.find((d) => d.id === decodeURIComponent(ver[1]));
    if (!base) fail(404, "Workflow definition not found.");
    const check = dryRun({ definition: (ver[2] === "versions" ? b.definition : base.definition) as Parameters<typeof dryRun>[0]["definition"] });
    if (!check.valid) fail(422, check.problems.join(" "));
    const activate = (d: WorkflowDefinition) => {
      state.defs = state.defs.map((x) => (x.key === d.key ? { ...x, active: x.id === d.id, activated_at: x.id === d.id ? NOW : x.activated_at, activated_by_label: x.id === d.id ? ME_LABEL : x.activated_by_label } : x));
      return state.defs.find((x) => x.id === d.id) as WorkflowDefinition;
    };
    if (ver[2] === "activate") return clone(activate(base));
    const version = Math.max(...state.defs.filter((d) => d.key === base.key).map((d) => d.version)) + 1;
    const made = def(`WD-${state.seq++}`, base.key, base.name, base.object_kind, version, false, b.definition as Record<string, unknown>, NOW);
    made.created_by_label = ME_LABEL;
    state.defs = [...state.defs, made];
    return clone(b.activate ? activate(made) : made);
  }
  const m = /^\/change-requests\/([^/]+)\/(validate|submit|decide|cancel|retry|comments|attachments)$/.exec(path);
  if (!m) return NONE_REQ;
  const d = find(decodeURIComponent(m[1]));
  const r = d.request;
  switch (m[2]) {
    case "validate": {
      const failures = r.kind !== "mass_change" && r.object === "material" && !r.payload["MARA.MATKL"] ? [{ check_id: "MM022", severity: "high", dimension: "completeness", field: "MARA.MATKL", message: "Material group is blank." }] : [];
      const required = r.object === "material" && r.kind === "create" ? ["MARA.MTART", "MARA.MBRSH", "MARA.MEINS", "MAKT.MAKTX", "MAKT.SPRAS"].filter((f) => !r.payload[f]).map((f) => `${f} is required to create a material`) : [];
      const p: Precheck = { ...precheck(failures), problems: required, checked_at: NOW };
      d.request = { ...r, precheck: p, validated_at: NOW, updated_at: NOW };
      return clone(p);
    }
    case "submit": {
      if (r.status !== "draft") fail(409, `The request is ${r.status}.`);
      if (r.requester_id !== ME) fail(403, "Only the requester submits it.");
      const inst = `WI-${r.id}`;
      d.request = { ...r, status: "in_approval", workflow_instance_id: inst, submitted_at: NOW, updated_at: NOW, due_at: "2026-10-22T08:00:00Z", waiting_step: "Four-eyes approval", age_hours: 0, overdue: false };
      d.workflow = { id: inst, definition_key: "default-change-request", definition_version: 2, status: "in_progress", started_at: NOW, completed_at: null, tasks: [{ id: `T-${r.id}`, instance_id: inst, step_index: 0, step_name: "Four-eyes approval", status: "pending", quorum: "any", assigned_users: ["u-rg"], assignee_note: "Anyone holding approve", due_at: "2026-10-22T08:00:00Z", escalation_level: 0, activated_at: NOW }] };
      d.history = [ev(`H-${state.seq++}`, "started", ME_LABEL, NOW, "in_progress")];
      return clone(d);
    }
    case "decide":
      return decideRequest(d, String(b.decision), b.comment as string | undefined);
    case "cancel": {
      if (["created", "creating", "cancelled", "rejected"].includes(r.status)) fail(409, `The request is ${r.status}.`);
      state.tasks = state.tasks.filter((t) => t.object_id !== r.id);
      d.request = { ...r, status: "cancelled", reason: (b.reason as string) || null, updated_at: NOW, due_at: null, waiting_step: null, age_hours: null, overdue: false };
      d.history = [...d.history, ev(`H-${state.seq++}`, "cancelled", ME_LABEL, NOW, "cancelled")];
      return clone(d.request);
    }
    case "retry": {
      if (r.status !== "failed") fail(409, `The request is ${r.status}.`);
      d.request = { ...r, status: "creating", sap_attempts: r.sap_attempts + 1, updated_at: NOW };
      return clone(d.request);
    }
    case "comments": {
      const c = { id: `C-${state.seq++}`, author_label: ME_LABEL, body: String(b.body ?? ""), created_at: NOW };
      d.comments = [...d.comments, c];
      return c;
    }
    default: {
      const a = { id: `A-${state.seq++}`, filename: String(b.filename ?? ""), content_type: (b.content_type as string) ?? null, size_bytes: (b.size_bytes as number) ?? null, uploaded_by_label: ME_LABEL, created_at: NOW };
      d.attachments = [...d.attachments, a];
      return a;
    }
  }
}
