/**
 * Aurora smoke — every workspace route renders its hub signed in (API replayed
 * from the recording, see fixtures.ts) with no page errors, and signed-out
 * visitors are sent to sign-in with the page they wanted.
 */

import { expect, ROUTES, test } from "./fixtures";

for (const r of ROUTES) {
  test(`${r.name} renders the ${r.heading} hub without page errors`, async ({ app }) => {
    const errors: string[] = [];
    app.on("pageerror", (e) => errors.push(e.message));
    await app.goto(r.path, { waitUntil: "load" });
    await expect(app.getByRole("heading", { level: 1, name: r.heading })).toBeVisible();
    // the workspace rail and the job rail are the shell's constant chrome
    await expect(app.getByRole("navigation", { name: "Workspaces" })).toBeVisible();
    await expect(app.getByRole("button", { name: /jobs/i })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("Home shows the verdict for the latest run", async ({ app }) => {
  await app.goto("/", { waitUntil: "load" });
  await expect(app.locator(".ui-verdict")).toBeVisible();
});

test("the Runs tab lists the recorded jobs with their outcome", async ({ app }) => {
  await app.goto("/data?tab=runs", { waitUntil: "load" });
  await expect(app.getByRole("heading", { level: 1, name: "Connect & load" })).toBeVisible();
  await expect(app.getByText(/analysis|download/i).first()).toBeVisible();
});

test.describe("signed out", () => {
  test("a workspace URL redirects to sign-in and remembers the destination", async ({ page }) => {
    const res = await page.goto("/data?tab=runs", { waitUntil: "domcontentloaded" });
    expect(res?.ok()).toBeTruthy();
    expect(new URL(page.url()).pathname).toBe("/sign-in");
    expect(new URL(page.url()).searchParams.get("next")).toBe("/data?tab=runs");
  });

  test("every legacy route still resolves", async ({ page }) => {
    for (const href of ["/command-centre", "/sync", "/executive-report", "/business-process", "/match-rules",
      "/settings/scoring", "/settings/field-mapping", "/workbench", "/process", "/admin", "/findings", "/cleaning", "/exceptions", "/dedup", "/golden-records", "/glossary", "/reports", "/notifications", "/settings", "/settings/rules", "/settings/ai", "/settings/licence", "/contracts"]) {
      const response = await page.request.get(href, { maxRedirects: 0 });
      expect([200, 307, 308], href).toContain(response.status());
    }
  });
});
