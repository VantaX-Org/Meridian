/** Wave 18c: every screens.md §4 route and tab renders without a page error, a crash screen or "coming soon". */
import { expect, test } from "./fixtures";

const ROUTES = [
  "/systems/s1?tab=config",
  "/systems/s1?tab=custom",
  "/systems/s1?tab=pilot",
  "/runs/v1?tab=config",
  "/runs/v1?tab=findings",
  "/inbox",
  "/inbox?kind=issues",
  "/inbox?kind=sap",
  "/inbox?kind=approvals",
  "/fix?tab=cleaning",
  "/fix?tab=batches",
  "/fix?tab=monitor",
  "/fix?tab=dedup",
  "/fix/what-if",
  "/mdm/golden/merge",
  "/mdm/match-rules",
  "/migration",
  "/migration/w1",
  "/rules",
  "/rules?tab=suppressions",
  "/rules?tab=feedback",
  "/rules/contracts",
  "/rules/learned",
  "/rules/drafts",
  "/rules/dictionary",
  "/rules/scoring",
];

for (const path of ROUTES) {
  test(`${path} renders`, async ({ app }) => {
    const errors: string[] = [];
    app.on("pageerror", (e) => errors.push(e.message));
    await app.goto(path, { waitUntil: "load" });
    await expect(app.getByRole("main")).toBeVisible();
    await expect(app.getByRole("main").getByText(/application error|something went wrong|coming soon/i)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
