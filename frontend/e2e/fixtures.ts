/**
 * Signed-in Aurora page with the API replayed from a recording.
 *
 * `e2e/fixtures/api.har` holds the API responses the routes in `routes.json`
 * made against the simulation stack (seeded tenant, no customer data).
 * Replaying it means the specs need no backend: the dev server serves the
 * pages, the HAR answers `/api/v1/*`, and the clock is pinned to the
 * recording time so relative durations and "last 24 h" figures are stable.
 *
 * Re-record after changing which endpoints a route calls:
 *   npm run e2e:record   (see e2e/record.mjs)
 */

import fs from "node:fs";
import path from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import routes from "./routes.json";

export const HAR = path.join(__dirname, "fixtures", "api.har");
/** The instant the HAR was recorded; Date.now() in the page returns this. */
export const RECORDED_AT = new Date("2026-10-02T14:13:00Z");
export const ROUTES: ReadonlyArray<{ name: string; path: string; heading: string }> = routes;

/** The recording is stored against http://localhost:3000; replay it on whatever origin the suite runs. */
function harFor(origin: string): string {
  const out = path.join(__dirname, "..", "test-results", `api.${origin.replace(/\W+/g, "_")}.har`);
  if (!fs.existsSync(out)) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, fs.readFileSync(HAR, "utf8").replaceAll("http://localhost:3000/", `${origin}/`));
  }
  return out;
}

export const test = base.extend<{ app: Page }>({
  app: async ({ page, context, baseURL }, provide) => {
    const origin = new URL(baseURL ?? "http://localhost:3000").origin;
    await context.addCookies([{ name: "mn_session", value: "1", domain: new URL(origin).hostname, path: "/" }]);
    await page.addInitScript(() => {
      localStorage.setItem("mn_auth_token", "e2e-recorded-session");
      sessionStorage.setItem("mn_landed", "1");
    });
    await page.clock.install({ time: RECORDED_AT });
    await page.routeFromHAR(harFor(origin), { url: /\/api\/v1\//, notFound: "abort" });
    // registered last so it wins: the job stream never ends and is not in the
    // recording; the 15 s poll covers the rail
    await page.route("**/api/v1/jobs/events", (r) => r.fulfill({ status: 204 }));
    await mockInbox(page);
    await provide(page);
  },
});

/** Inbox endpoints that are not in the recording: three open tasks and matching metrics. */
const INBOX_ITEMS = [
  { id: "a1f0c2d4-0000-4000-8000-000000000001", item_type: "merge_decision", domain: "business_partner", priority: 1, status: "open", sla_state: "at_risk", source_id: "BP-0001" },
  { id: "a1f0c2d4-0000-4000-8000-000000000002", item_type: "exception", domain: "material_master", priority: 2, status: "open", sla_state: "on_track", source_id: "MAT-0042" },
  { id: "a1f0c2d4-0000-4000-8000-000000000003", item_type: "golden_record_review", domain: "accounts_payable", priority: 3, status: "open", sla_state: "on_track", source_id: "VND-0107" },
].map((t) => ({
  ...t, tenant_id: "e2e", due_at: null, assigned_to: null, sla_hours: 48, ai_recommendation: null, ai_confidence: null,
  created_at: "2026-10-01T08:00:00Z", updated_at: "2026-10-01T08:00:00Z",
}));
const json = (body: unknown) => ({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

async function mockInbox(page: Page) {
  await page.route(/\/api\/v1\/stewardship\?/, (r) =>
    r.fulfill(json(new URL(r.request().url()).searchParams.get("status") === "open" ? { items: INBOX_ITEMS, total: INBOX_ITEMS.length } : { items: [], total: 0 })));
  await page.route("**/api/v1/stewardship/metrics", (r) => r.fulfill(json({
    items_by_type: { merge_decision: 1, exception: 1, golden_record_review: 1 }, items_by_status: { open: 3 },
    avg_resolution_hours_by_type: { merge_decision: 6, exception: 12 }, backlog_total: 3, sla_compliance_rate: 0.92,
    ai_acceptance_rate: null, steward_breakdown: [],
  })));
  await page.route(/\/api\/v1\/triage\/metrics/, (r) => r.fulfill(json({
    weeks: 8, backlog_by_owner: [], backlog_by_team: [], unassigned: 3, resolved_in_sla: 9, resolved_total: 10, sla_attainment_pct: 90,
    mtta_hours: 2, mttr_hours: 9, breach_count: 1,
    weekly: [{ week: "2026-09-28", opened: 5, resolved: 4, resolved_in_sla: 4, breached: 0 }],
  })));
}

export { expect };
