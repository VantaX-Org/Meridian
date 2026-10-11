/** Wave 18b: every gap route renders its page (heading or designed empty state) with the signed-in `app` fixture. */
import { expect, test } from "./fixtures";

/** Valid empty bodies for endpoints neither the recording nor mockGapRoutes covers, per route. */
const EMPTY: Record<string, [RegExp, unknown][]> = {
  "/insights/reports": [[/\/api\/v1\/versions(\?.*)?$/, { versions: [] }]],
  "/mdm": [[/\/api\/v1\/mdm-metrics(\?.*)?$/, { latest: null, trend: [], active_systems_count: 0 }]],
  "/admin/audit": [[/\/api\/v1\/audit(\?.*)?$/, { entries: [], total: 0, limit: 100, offset: 0 }]],
  "/admin/reference": [[/\/api\/v1\/systems\/s1\/reference(\?.*)?$/, []]],
  "/fix/what-if": [[/\/api\/v1\/versions(\?.*)?$/, { versions: [] }]],
};

/** The one endpoint whose failure puts the page in its error state. */
const FAILING: Record<string, RegExp> = {
  "/insights/reports": /\/api\/v1\/versions(\?.*)?$/,
  "/mdm": /\/api\/v1\/mdm-metrics(\?.*)?$/,
  "/admin/audit": /\/api\/v1\/audit(\?.*)?$/,
  "/admin/reference": /\/api\/v1\/systems\/s1\/reference(\?.*)?$/,
  "/fix/what-if": /\/api\/v1\/versions(\?.*)?$/,
};

const NEW_ROUTES: [string, string][] = [
  ["/insights/operations", "No queue activity to analyse yet."],
  ["/insights/reports", "No completed run to report on."],
  ["/insights/exec", "No executive summary data for this run yet."],
  ["/mdm", "No MDM health snapshot yet."],
  ["/mdm/survivorship", "No survivorship rules."],
  ["/admin/audit", "No audit activity recorded yet."],
  ["/admin/notifications", "No alert channels."],
  ["/admin/jobs", "No jobs have run yet."],
  ["/admin/reference", "No reference data loaded."],
  ["/fix/what-if", "No finished run to simulate."],
  ["/rules/drafts", "No drafts."],
  ["/rules/dictionary", "No data dictionary snapshot yet. It is captured during extraction."],
  ["/rules/scoring", "Cost model (ZAR)"],
];

for (const [path, title] of NEW_ROUTES) {
  test(`${path} renders`, async ({ app }) => {
    const errors: string[] = [];
    app.on("pageerror", (e) => errors.push(e.message));
    for (const [re, body] of EMPTY[path] ?? []) {
      await app.route(re, (r) => (r.request().method() === "GET" ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }) : r.fallback()));
    }
    await app.goto(path, { waitUntil: "load" });
    await expect(app.getByRole("main")).toBeVisible();
    await expect(app.getByRole("main").getByText(title, { exact: true }).first()).toBeVisible();
    await expect(app.getByRole("main").getByText(/application error|something went wrong/i)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

for (const [path, re] of Object.entries(FAILING)) {
  test(`${path} shows its error state when the server fails`, async ({ app }) => {
    await app.route(re, (r) => (r.request().method() === "GET" ? r.fulfill({ status: 500, contentType: "application/json", body: "{}" }) : r.fallback()));
    await app.goto(path, { waitUntil: "load" });
    await expect(app.getByRole("main").getByText("Could not reach the server.", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  });
}
