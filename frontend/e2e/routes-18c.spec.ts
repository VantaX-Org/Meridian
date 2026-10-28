/** Wave 18c: every screens.md §4 route and tab renders without a page error, a crash screen or "coming soon". */
import { expect, RECORDED, test } from "./fixtures";

const ROUTES = [
  `/systems/${RECORDED.systemId}?tab=config`,
  `/systems/${RECORDED.systemId}?tab=custom`,
  `/systems/${RECORDED.systemId}?tab=pilot`,
  "/runs/v1?tab=config",
  "/runs/v1?tab=findings",
  "/inbox",
  // retired into Fix work (routes-b.spec.ts asserts the redirect); it opens the viewer's own records there
  "/inbox?kind=issues",
  "/inbox?kind=sap",
  "/inbox?kind=approvals",
  "/fix?tab=cleaning",
  "/fix?tab=batches",
  "/objects?view=monitoring",
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

/** Routes backed by the 18c mocks or the recording: the seeded text must appear, proving real content, not an error state. */
const CONTENT: Record<string, RegExp> = {
  // the recorded configuration health table (one row per SAP module)
  [`/systems/${RECORDED.systemId}?tab=config`]: /Config health/,
  // the recorded custom-object registry (63 entries); KTEXT and KURZTEXT are two of its field names
  [`/systems/${RECORDED.systemId}?tab=custom`]: /KTEXT|KURZTEXT/,
  "/runs/v1?tab=config": /MM101|MM102|config_driven|data_error/i,
  "/inbox?kind=sap": /Nightly extract job failed/,
  "/inbox?kind=approvals": /Approve/,
  "/fix?tab=dedup": /LIFNR=V1|93/,
  "/rules?tab=suppressions": /Accepted by the data owner|MM101/,
  "/rules?tab=feedback": /MM101/,
};

for (const path of ROUTES) {
  test(`${path} renders`, async ({ app }) => {
    const errors: string[] = [];
    app.on("pageerror", (e) => errors.push(e.message));
    await app.goto(path, { waitUntil: "load" });
    await expect(app.getByRole("main")).toBeVisible();
    await expect(app.getByRole("main").getByText(/application error|something went wrong|coming soon/i)).toHaveCount(0);
    await expect(app.getByRole("main").getByText("Could not reach the server.")).toHaveCount(0);
    const want = CONTENT[path];
    if (want) await expect(app.getByRole("main").getByText(want).first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}
