/**
 * Endpoints of the To do list and object monitoring, which the recording predates (api/routes/attention.py,
 * api/routes/objects.py monitor routes, api/routes/auth_oidc.py). Built by hand in the shape the API answers, on the
 * recorded tenant: its one system and its objects. GET only; a spec that needs another state registers its own
 * route after the `app` fixture, which wins.
 *
 *  - GET /attention and /attention/count: the viewer's ranked list. The server filters by scope, so a spec for a
 *    scoped user hands over the already-filtered items; `object` narrows the list the way the API does.
 *  - GET /objects/monitor and /objects/{module}/monitor: cadence, freshness, baseline and drift.
 *  - GET /admin/sso: the single sign-on settings, not configured.
 */
import type { Page } from "@playwright/test";
import type { AttentionCounts, AttentionItem } from "../../lib/api/attention";
import type { ObjectMonitor } from "../../lib/api/v1/objects";

/** Ids as in the recording (fixtures.ts RECORDED); not imported, because fixtures.ts imports this file. */
const RECORDED = {
  systemId: "c7a18906-1555-40ba-a1b2-caf83188238e",
  systemName: "ERP-SIM",
  latestRunId: "d3229ded-0708-4967-9dfb-1b7f4fada953",
  materialRunId: "c1f752b7-ab20-441e-9b13-f47754f0e910",
} as const;

const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

/** The instant the recording was made (fixtures.ts RECORDED_AT), so "since" and "as of" are stable. */
export const NOW = "2026-10-19T04:21:43Z";
const HOUR_AGO = "2026-10-19T03:21:43Z";
const DAYS_AGO_3 = "2026-10-16T04:21:43Z";

/** One to-do item, with the fields the API always sends; override what a case needs. */
export function attentionItem(over: Partial<AttentionItem> & Pick<AttentionItem, "id" | "kind" | "title">): AttentionItem {
  return {
    tier: 2, severity: "high", detail: "", href: "/fix", action_label: "Open", count: 1,
    object: null, system_id: null, system_name: null, module: null, since: HOUR_AGO, required_action: "view",
    ...over,
  };
}

/** The lead's list: a failed connection, a regression and an overdue invitation, worst first. */
export const LEAD_ITEMS: AttentionItem[] = [
  attentionItem({
    id: "connection:sim", kind: "connection", tier: 1, severity: "critical", title: `${RECORDED.systemName} cannot connect`,
    detail: "The last connection test failed 1 hour ago.", href: `/systems/${RECORDED.systemId}`, action_label: "Open system",
    system_id: RECORDED.systemId, system_name: RECORDED.systemName, required_action: "manage_systems",
  }),
  attentionItem({
    id: "regression:material_master", kind: "regression", tier: 2, severity: "high", title: "1 rule started failing again on Material master",
    detail: "9 records fail now that passed in the baseline.", href: `/fix?module=material_master&run=${RECORDED.materialRunId}&since=${RECORDED.latestRunId}`,
    action_label: "Review records", count: 9, object: "material_master", module: "material_master",
    system_id: RECORDED.systemId, system_name: RECORDED.systemName, required_action: "apply",
  }),
  attentionItem({
    id: "stale:business_partner", kind: "stale_object", tier: 3, severity: "medium", title: "Business partner has not been checked on schedule",
    detail: "Its daily check last ran 3 days ago.", href: "/objects/business_partner", action_label: "Re-check now", count: 1,
    object: "business_partner", module: "business_partner", system_id: RECORDED.systemId, system_name: RECORDED.systemName,
    since: DAYS_AGO_3, required_action: "trigger_sync",
  }),
  attentionItem({
    id: "invites:pending", kind: "invites_pending", tier: 5, severity: "low", title: "2 invitations are older than 7 days",
    detail: "Resend them or revoke the ones nobody will accept.", href: "/admin/users?status=invite_expired", action_label: "Review invitations",
    count: 2, since: DAYS_AGO_3, required_action: "manage_users",
  }),
];

const countsOf = (items: readonly AttentionItem[]): AttentionCounts => {
  const c: AttentionCounts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const i of items) c[i.severity] += 1;
  return c;
};

/**
 * Answer the list and the count from `items`. `GET /attention?object=` keeps the items of that object, as the API
 * does; the count carries the top item.
 */
export async function mockAttention(page: Page, items: readonly AttentionItem[]) {
  await page.route(/\/api\/v1\/attention\/count(\?.*)?$/, (r) =>
    r.request().method() === "GET" ? r.fulfill(json({ ...countsOf(items), top: items[0] ?? null })) : r.fallback());
  await page.route(/\/api\/v1\/attention(\?.*)?$/, (r) => {
    if (r.request().method() !== "GET") return r.fallback();
    const object = new URL(r.request().url()).searchParams.get("object");
    const shown = object ? items.filter((i) => i.object === object || i.module === object) : [...items];
    return r.fulfill(json({ items: shown, generated_at: NOW, counts: countsOf(shown) }));
  });
}

/** A monitor row for one object, scheduled daily and fresh; override the parts a case needs. */
export function monitorOf(module: string, over: Partial<ObjectMonitor> = {}): ObjectMonitor {
  return {
    module, system_id: RECORDED.systemId, last_run_at: HOUR_AGO, last_version_id: RECORDED.materialRunId, trigger: "scheduled",
    requested_by_label: null,
    cadence: { cron: "0 2 * * *", active: true, interval_seconds: 86_400, profile_id: "p-1" },
    next_run_at: "2026-10-20T02:00:00Z", freshness: "fresh",
    baseline: { kind: "pinned", version_id: RECORDED.latestRunId, run_at: "2026-10-12T05:00:00Z" },
    drift: { new_failing: 9, recovered: 4, newly_failing_rules: [{ check_id: "MM101", severity: "high", new: 9 }], recovered_rules: [{ check_id: "MM045" }], newly_failing_rule_count: 1, recovered_rule_count: 1 },
    ...over,
  };
}

/** The state of an object that was never scheduled and has only one run. */
export const FIRST_RUN_MANUAL = {
  trigger: "upload" as const,
  cadence: { cron: null, active: null, interval_seconds: null, profile_id: null },
  next_run_at: null, freshness: "manual" as const,
  baseline: { kind: null, version_id: null, run_at: null },
  drift: { new_failing: 0, recovered: 0, newly_failing_rules: [], recovered_rules: [], newly_failing_rule_count: 0, recovered_rule_count: 0 },
  system_id: null,
};

/** Answer one object's monitor and the list of all of them. `rows` are keyed by module. */
export async function mockObjectMonitors(page: Page, rows: readonly ObjectMonitor[]) {
  await page.route(/\/api\/v1\/objects\/monitor(\?.*)?$/, (r) =>
    r.request().method() === "GET" ? r.fulfill(json({ objects: rows })) : r.fallback());
  await page.route(/\/api\/v1\/objects\/([^/?]+)\/monitor(\?.*)?$/, (r) => {
    if (r.request().method() !== "GET") return r.fallback();
    const mod = /\/objects\/([^/?]+)\/monitor/.exec(r.request().url())?.[1];
    const row = rows.find((x) => x.module === mod);
    return row ? r.fulfill(json(row)) : r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "No monitor for this object" }) });
  });
}

/** Single sign-on settings of a tenant that has not set it up. */
export async function mockSso(page: Page) {
  await page.route(/\/api\/v1\/admin\/sso(\?.*)?$/, (r) =>
    r.request().method() === "GET"
      ? r.fulfill(json({
        configured: false, issuer: "", client_id: "", has_secret: false, display_name: "", allowed_domains: [],
        default_role: "viewer", enforce: false, redirect_uri: "http://localhost:3000/auth/oidc/callback",
      }))
      : r.fallback());
}

/** What every spec sees unless it says otherwise: the lead's list and single sign-on not configured. */
export async function mockMonitoringDefaults(page: Page) {
  await mockAttention(page, LEAD_ITEMS);
  await mockObjectMonitors(page, [monitorOf("material_master"), monitorOf("business_partner", { freshness: "stale", last_run_at: DAYS_AGO_3 })]);
  await mockSso(page);
}
