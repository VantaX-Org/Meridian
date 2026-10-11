/** Wave 18b: every gap route renders its page (heading or designed empty state) with the signed-in `app` fixture. */
import { expect, test } from "./fixtures";

const NEW_ROUTES = [
  "/insights/operations", "/insights/reports", "/insights/exec", "/mdm", "/mdm/survivorship",
  "/admin/audit", "/admin/notifications", "/admin/jobs", "/admin/reference",
  "/fix/what-if", "/rules/drafts", "/rules/dictionary", "/rules/scoring",
];

for (const path of NEW_ROUTES) {
  test(`${path} renders`, async ({ app }) => {
    const errors: string[] = [];
    app.on("pageerror", (e) => errors.push(e.message));
    await app.goto(path, { waitUntil: "load" });
    await expect(app.getByRole("main")).toBeVisible();
    await expect(app.getByRole("main").getByText(/application error|something went wrong/i)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
