/** Wave 18b: every gap route renders its page (heading or designed empty state) with the signed-in `app` fixture. */
import { expect, test } from "./fixtures";

/** Route and the designed text its page shows against the empty bodies in `mockGapRoutes`. */
const NEW_ROUTES: [string, string][] = [
  ["/insights/operations", "No queue activity to analyse yet."],
  ["/insights/reports", "Choose a run"],
  ["/insights/exec", "No executive summary data for this run yet."],
  ["/mdm", "Could not reach the server."],
  ["/mdm/survivorship", "No survivorship rules."],
  ["/admin/audit", "Could not reach the server."],
  ["/admin/notifications", "No alert channels."],
  ["/admin/jobs", "No jobs have run yet."],
  ["/admin/reference", "Could not reach the server."],
  ["/fix/what-if", "Could not reach the server."],
  ["/rules/drafts", "No drafts."],
  ["/rules/dictionary", "No data dictionary snapshot yet. It is captured during extraction."],
  ["/rules/scoring", "Cost model (ZAR)"],
];

for (const [path, title] of NEW_ROUTES) {
  test(`${path} renders`, async ({ app }) => {
    const errors: string[] = [];
    app.on("pageerror", (e) => errors.push(e.message));
    await app.goto(path, { waitUntil: "load" });
    await expect(app.getByRole("main")).toBeVisible();
    await expect(app.getByRole("main").getByText(title, { exact: true }).first()).toBeVisible();
    await expect(app.getByRole("main").getByText(/application error|something went wrong/i)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
