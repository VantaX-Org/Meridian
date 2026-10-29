import { uploadApiClient } from "@/lib/api/client";
import { v2Get, v2Send } from "./client";
import { fixtureActive } from "./fixture";
import { rolesFixtureDownload } from "./fixtures/roles";

/**
 * The step 6c clients: every verb the role capability audit added (docs/roles-and-features.md). One typed function
 * per endpoint; reads go through v2Get and writes through v2Send, so fixture mode answers from fixtures/roles.ts.
 */

// ── comments, watches, subscriptions, activity ───────────────────────────────

export type CommentKind = "record" | "rule" | "batch" | "contract" | "wave" | "object";
export type WatchKind = CommentKind | "system";
export type WatchEvent = "comment" | "run_finished" | "score_dropped" | "critical_breach" | "batch_waiting";

export interface Comment {
  id: string;
  target_kind: CommentKind;
  target_id: string;
  body: string;
  author_id: string;
  author_label: string;
  mentions: string[];
  created_at: string;
  mine: boolean;
}

export const getComments = (kind: CommentKind, id: string) =>
  v2Get<{ target_kind: CommentKind; target_id: string; comments: Comment[] }>("/comments", { target_kind: kind, target_id: id });
export const addComment = (kind: CommentKind, id: string, body: string, mentions: string[]) =>
  v2Send<Comment>("POST", "/comments", { target_kind: kind, target_id: id, body, mentions });
export const deleteComment = (id: string) => v2Send<void>("DELETE", `/comments/${encodeURIComponent(id)}`);
export const getUnreadMentions = () => v2Get<{ count: number }>("/comments/mentions/unread");

export interface WatchState {
  target_kind: WatchKind;
  target_id: string;
  watching: boolean;
  events: WatchEvent[];
}
export const getWatch = (kind: WatchKind, id: string) => v2Get<WatchState>("/watches", { target_kind: kind, target_id: id });
export const putWatch = (kind: WatchKind, id: string, events: WatchEvent[] = []) =>
  v2Send<WatchState>("PUT", "/watches", { target_kind: kind, target_id: id, events });
export const deleteWatch = (kind: WatchKind, id: string) => v2Send<void>("DELETE", "/watches", undefined, { target_kind: kind, target_id: id });

export interface Subscription {
  event: string;
  label: string;
  enabled: boolean;
  default: boolean;
}
export const getSubscriptions = () => v2Get<{ events: Subscription[] }>("/me/subscriptions");
export const putSubscriptions = (choice: Record<string, boolean>) => v2Send<{ events: Subscription[] }>("PUT", "/me/subscriptions", choice);

export interface ActivityEntry {
  id: string;
  action: string;
  entity_type: string | null;
  entity_id: string | null;
  method: string;
  path: string;
  status_code: number;
  created_at: string;
}
export const getActivity = (userId: string) => v2Get<{ user_id: string; entries: ActivityEntry[] }>(`/people/${encodeURIComponent(userId)}/activity`);

// ── delegations ──────────────────────────────────────────────────────────────

export interface Delegation {
  id: string;
  from_user_id: string;
  to_user_id: string;
  from_name: string;
  to_name: string;
  starts_on: string;
  ends_on: string;
  reason: string | null;
  state: "scheduled" | "active" | "ended" | "revoked";
}
export const getMyDelegations = () => v2Get<{ away: Delegation[]; covering: Delegation[] }>("/delegations/mine");
export const getAllDelegations = () => v2Get<{ delegations: Delegation[] }>("/delegations");
export const createDelegation = (body: { to_user_id: string; starts_on: string; ends_on: string; reason?: string; from_user_id?: string }) =>
  v2Send<Delegation>("POST", "/delegations", body);
export const revokeDelegation = (id: string) => v2Send<void>("DELETE", `/delegations/${encodeURIComponent(id)}`);

// ── escalation chain ─────────────────────────────────────────────────────────

export interface EscalationStep {
  level: number;
  after_minutes: number;
  target: "team_lead" | "fallback" | "user";
  user_id: string | null;
  user_name?: string | null;
}
export const getEscalationChain = () => v2Get<{ steps: EscalationStep[] }>("/triage/escalation-chain");
export const putEscalationChain = (steps: EscalationStep[]) => v2Send<{ steps: EscalationStep[] }>("PUT", "/triage/escalation-chain", { steps });

// ── contracts ────────────────────────────────────────────────────────────────

export interface Contract {
  id: string;
  name: string;
  description: string | null;
  producer: string;
  consumer: string;
  status: "draft" | "pending_approval" | "active" | "expired" | string;
  version: number;
  quality_contract: Record<string, unknown> | null;
  freshness_contract: Record<string, unknown> | null;
  created_by: string | null;
  latest_compliant: boolean | null;
  last_checked: string | null;
}
export interface ContractDetail {
  contract: Contract;
  versions: { version: number; snapshot: Record<string, unknown>; note: string | null; created_by: string; created_at: string }[];
  breaches: { version_id: string | null; violations: unknown; recorded_at: string }[];
  checks: number;
}
export const listContracts = () => v2Get<{ contracts: Contract[]; total: number }>("/contracts");
export const getContractDetail = (id: string) => v2Get<ContractDetail>(`/contracts/${encodeURIComponent(id)}/detail`);
export const createContract = (body: { name: string; producer: string; consumer: string; description?: string; quality_contract?: Record<string, unknown> }) =>
  v2Send<{ id: string; status: string }>("POST", "/contracts", body);
export const updateContract = (id: string, body: Partial<Pick<Contract, "name" | "description" | "producer" | "consumer" | "quality_contract">> & { status?: "draft" | "pending_approval" }) =>
  v2Send<Contract>("PUT", `/contracts/${encodeURIComponent(id)}`, body);
export const activateContract = (id: string) => v2Send<{ id: string; status: string }>("PUT", `/contracts/${encodeURIComponent(id)}/activate`);
export const reviseContract = (id: string, note?: string) => v2Send<{ id: string; version: number; status: string }>("POST", `/contracts/${encodeURIComponent(id)}/revise`, { note });

// ── workload balancing ───────────────────────────────────────────────────────

export type BalanceBy = "owner" | "object" | "slice";
export interface BalanceMove {
  from: string | null;
  to: string;
  module: string;
  count: number;
  issue_ids: string[];
}
export interface BalancePlan {
  by: BalanceBy;
  before: Record<string, number>;
  after: Record<string, number>;
  moves: BalanceMove[];
  moved: number;
  people: { id: string; name: string }[];
}
export const planBalance = (by: BalanceBy, module?: string | null) => v2Send<BalancePlan>("POST", "/people/balance/plan", { by, module: module ?? undefined });
export const applyBalance = (by: BalanceBy, moves: BalanceMove[], module?: string | null) =>
  v2Send<{ moved: number; skipped: number; action_id: string | null }>("POST", "/people/balance/apply", { by, moves, module: module ?? undefined });
export const undoAction = (actionId: string) => v2Send<{ action_id: string }>("POST", "/actions/undo", { action_id: actionId });

// ── wave gates ───────────────────────────────────────────────────────────────

export interface GateCheck {
  key: "min_score" | "zero_criticals" | "contracts_met";
  label: string;
  passed: boolean;
  detail: string;
}
export interface WaveGate {
  wave_id: string;
  name: string;
  modules: string[];
  gate: { min_score: number | null; zero_criticals: boolean; contracts_met: boolean; configured: boolean; updated_by: string | null; updated_at: string | null };
  status: { passed: boolean; checks: GateCheck[] };
  signed_off: boolean;
  certificate_href: string;
}
export const getWaveGates = () => v2Get<{ gates: WaveGate[] }>("/migration/waves/gates");
export const putWaveGate = (waveId: string, body: { min_score: number | null; zero_criticals: boolean; contracts_met: boolean }) =>
  v2Send<WaveGate>("PUT", `/migration/waves/${encodeURIComponent(waveId)}/gate`, body);

// ── extraction dry run and delta ─────────────────────────────────────────────

export interface DryRun {
  dry_run: true;
  objects: string[];
  tables: { table: string; objects: string[]; rows: number | null }[];
  total_rows: number;
  unknown_tables: number;
  seconds: number;
  rate: number;
  rate_basis: "measured" | "assumed";
  delta: { available: boolean; reason: string };
}
export const extractionDryRun = (systemId: string, objects: string[]) =>
  v2Send<DryRun>("POST", `/systems/${encodeURIComponent(systemId)}/downloads`, { objects, scope: {}, dry_run: true });
export const extractDelta = (systemId: string, objects: string[], analyse: boolean) =>
  v2Send<{ job_id: string; status: string; delta: boolean }>("POST", `/systems/${encodeURIComponent(systemId)}/downloads`, { objects, scope: {}, analyse, delta: true });

// ── share links ──────────────────────────────────────────────────────────────

export interface ShareLink {
  id: string;
  route: string;
  state: Record<string, string>;
  role: "viewer";
  label: string | null;
  created_by: string;
  created_by_label: string | null;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  last_opened_at: string | null;
  open_count: number;
  state_word: "active" | "expired" | "revoked";
}
export const createShareLink = (route: string, state: Record<string, string>, expiresInDays: number, label?: string) =>
  v2Send<ShareLink & { token: string; url: string }>("POST", "/share-links", { route, state, expires_in_days: expiresInDays, label });
export const listShareLinks = (all = false) => v2Get<{ links: ShareLink[] }>("/share-links", { all: all || undefined });
export const revokeShareLink = (id: string) => v2Send<void>("DELETE", `/share-links/${encodeURIComponent(id)}`);
export const resolveShareLink = (token: string) =>
  v2Get<{ id: string; route: string; state: Record<string, string>; role: "viewer"; label: string | null; expires_at: string; shared_by: string | null }>(`/share-links/resolve/${encodeURIComponent(token)}`);

// ── configuration bundle, view as, bulk rules ────────────────────────────────

export interface BundleItem {
  key: string;
  change: "add" | "change" | "same";
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
}
export interface BundleDiff {
  dry_run: boolean;
  sections: Record<string, { add: number; change: number; same: number; kept: number; items: BundleItem[] }>;
  totals: { add: number; change: number; same: number; kept: number };
}
export const importBundle = (bundle: unknown, dryRun: boolean) => v2Send<BundleDiff>("POST", "/admin/config-bundle/import", bundle, { dry_run: dryRun });
export const startViewAs = (role: string) => v2Send<{ role: string; name: string; actions: string[]; read_only: boolean }>("POST", "/admin/view-as", { role });
export const stopViewAs = () => v2Send<void>("DELETE", "/admin/view-as");

export interface BulkRow {
  row: number;
  module: string | null;
  id: string | null;
  ok: boolean;
  errors: string[];
}
export interface BulkResult {
  dry_run: boolean;
  total: number;
  valid: number;
  invalid: number;
  created: string[];
  rows: BulkRow[];
}
export const importRulesBulk = (format: "yaml" | "xlsx", content: string, dryRun: boolean, module?: string) =>
  v2Send<BulkResult>("POST", "/rules/bulk/import", { format, content, dry_run: dryRun, module });

// ── stewardship template and related objects ─────────────────────────────────

export type SliceKind = "company_code" | "plant" | "sales_org" | "purchasing_org" | "none";
export interface TemplateObject {
  owner_role: string;
  slice: SliceKind;
  stewards: string;
  owner_user_id?: string | null;
  steward_user_id?: string | null;
  slice_stewards?: Record<string, string>;
}
export interface AssignmentTemplate {
  reference_data_steward?: string;
  span?: { max_open_records: number; max_objects: number };
  objects: Record<string, TemplateObject>;
}
export interface TemplateOut {
  template: AssignmentTemplate;
  saved: boolean;
  updated_by: string | null;
  updated_at: string | null;
  active_slices: Partial<Record<SliceKind, string[]>>;
  labels: Record<string, string>;
}
export interface ApplyRow {
  module: string;
  change: "add" | "change" | "same";
  before: string | null;
  after: string;
  slice_kind?: SliceKind;
  slice_value?: string;
}
export interface ApplyPlan {
  dry_run: boolean;
  owners: ApplyRow[];
  stewards: ApplyRow[];
  totals: { add: number; change: number; same: number };
}
export interface Gap {
  module: string;
  label: string;
  gap: "no_owner" | "no_steward";
  slice_kind: SliceKind | null;
  slice_value: string | null;
  sentence: string;
}
export interface RelatedObject {
  module: string;
  label: string;
  relation: "upstream" | "downstream" | "shared-reference";
  tier: number | null;
  open_criticals: number;
}
export interface RelatedOut {
  module: string;
  tier: number | null;
  related: RelatedObject[];
  fix_hint: { module: string; failures: number; sentence: string } | null;
}
export const getTemplate = () => v2Get<TemplateOut>("/admin/assignment-template");
export const putTemplate = (template: AssignmentTemplate) => v2Send<TemplateOut>("PUT", "/admin/assignment-template", { template });
export const applyTemplate = (dryRun: boolean, modules?: string[]) => v2Send<ApplyPlan>("POST", "/admin/assignment-template/apply", { dry_run: dryRun, modules });
export const getTemplateGaps = () => v2Get<{ objects: number; gaps: Gap[]; based_on: string }>("/admin/assignment-template/gaps");
export const getRelated = (module: string) => v2Get<RelatedOut>(`/objects/${encodeURIComponent(module)}/related`);

// ── grid export ──────────────────────────────────────────────────────────────

export interface GridExportBody {
  title: string;
  route: string;
  columns: { key: string; header: string; kind?: "text" | "int" | "pct" }[];
  rows: Record<string, string | number | null>[];
  filters?: Record<string, string>;
}

function saveBlob(blob: Blob, name: string): void {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

/** POSTs and saves the file the API builds (grid export, bundle, rules). Fixture mode saves a text stand-in. */
export async function postDownload(path: string, body: unknown, fallbackName: string, method: "GET" | "POST" = "POST", params?: Record<string, string>): Promise<string> {
  if (fixtureActive()) {
    const f = rolesFixtureDownload(path, body, fallbackName);
    saveBlob(new Blob([f.text], { type: "text/plain" }), f.name);
    return f.name;
  }
  const res = await uploadApiClient.request<Blob>({ method, url: `/api/v1${path}`, data: method === "POST" ? body : undefined, params, responseType: "blob" });
  const disposition = String(res.headers?.["content-disposition"] ?? "");
  const hit = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
  const name = hit ? decodeURIComponent(hit) : fallbackName;
  saveBlob(res.data, name);
  return name;
}

export const exportGrid = (body: GridExportBody) => postDownload("/export/grid", body, `${body.route}.xlsx`);
export const exportBundle = () => postDownload("/admin/config-bundle", undefined, "meridian-config.json", "GET");
export const exportRulesBulk = (format: "yaml" | "xlsx") => postDownload("/rules/bulk/export", undefined, `meridian-rules.${format}`, "GET", { format });
