/** Wave 18b: every gap route renders its page (heading or designed empty state) with the signed-in `app` fixture. */
import { expect, test } from "./fixtures";

/** Valid empty bodies for endpoints the recording does not cover, per route (none today: every route below is recorded). */
const EMPTY: Record<string, [RegExp, unknown][]> = {};

/** The one endpoint whose failure puts the page in its error state. */
const FAILING: Record<string, RegExp> = {
  "/insights/reports": /\/api\/v1\/versions(\?.*)?$/,
  "/mdm": /\/api\/v1\/mdm-metrics(\?.*)?$/,
  "/admin/audit": /\/api\/v1\/audit(\?.*)?$/,
  "/admin/reference": /\/api\/v1\/systems\/[^/]+\/reference(\?.*)?$/,
  "/fix/what-if": /\/api\/v1\/versions(\?.*)?$/,
};

/** Text each route shows on the recording (31 runs, jobs, audit entries, reference lists; no drafts, channels or survivorship rules). */
const NEW_ROUTES: [string, string][] = [
  ["/insights/operations", "Operations"],
  ["/insights/reports", "Latest completed runs"],
  ["/insights/exec", "Executive summary"],
  ["/mdm", "MDM overview"],
  ["/mdm/survivorship", "0 rules"],
  ["/admin/audit", "Who did what, AI calls and role changes"],
  ["/admin/notifications", "Outbound alert channels"],
  ["/admin/jobs", "Extractions, analyses, uploads and simulations"],
  ["/admin/reference", "Postal code and BIC lists held per system"],
  ["/fix/what-if", "Run simulation"],
  ["/rules/drafts", "No drafts"],
  ["/rules/dictionary", "SAP dictionary entries for TABLE.FIELD names"],
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
