/**
 * Wave 16 acceptance: a viewer sees no mutating control on any (app) route.
 *
 * Routes are every nav href in lib/nav.ts (read from the source, so the spec
 * needs no React/icon imports) plus the recorded detail routes in
 * routes.json, which are where the gated primaries live. The only mutating
 * labels allowed in the DOM are the four primaries (Approve, Write back,
 * Sign off, Extract now), and only disabled.
 */

import fs from "node:fs";
import path from "node:path";
import { expect, test, ROUTES } from "./fixtures";
import { LEGACY_PERMISSIONS, permissionsPayload } from "./fixtures/legacy-permissions";
import { mockRoutes12 } from "./fixtures/mocks-12";

const NAV_SOURCE = fs.readFileSync(path.join(__dirname, "..", "lib", "nav.ts"), "utf8");
const NAV_HREFS = [...NAV_SOURCE.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
// /fix?tab=batches covers the batch-level Export, which lives off the default tab.
const PATHS = [...new Set([...NAV_HREFS, ...ROUTES.map((r) => r.path), "/fix?tab=batches"])];

const MUTATING = /^(approve|reject|write ?back|sign off|extract now|apply|accept|assign|merge|delete|remove|create|new|add|upload|import|run|re-run|rerun|sync|test|save|edit|discover|start|generate|invite|promote|publish|retry|resolve|dismiss|claim|export|bulk|deactivate|revoke|grant|decline)\b/i;
const PRIMARY = /^(approve|write back|sign off|extract now)\b/i;

test.describe("viewer gating", () => {
  test.beforeEach(async ({ app }) => {
    // the detail routes render their content (and so their controls) rather than an error state
    await mockRoutes12(app);
    const viewer = permissionsPayload("viewer");
    await app.route(/\/api\/v1\/me\/permissions/, (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(viewer) }));
    await app.route(/\/api\/v1\/auth\/me(\?|$)/, (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          user: { id: "e2e-viewer", email: "viewer@example.test", name: "Viewer", role: "viewer", permissions: [...LEGACY_PERMISSIONS.viewer].sort() },
          must_change_password: false,
        }),
      }));
  });

  test("route list is not empty", () => {
    expect(NAV_HREFS.length).toBeGreaterThan(10);
  });

  test("Extract now stays visible, disabled, and Request access opens the Dialog", async ({ app }) => {
    await app.goto("/systems/s1", { waitUntil: "load" });
    const extract = app.getByRole("button", { name: /^Extract now\. Needs SAP Basis on ECC Prod — Request access$/ });
    await expect(extract).toBeVisible({ timeout: 20_000 });
    await expect(extract).toBeDisabled();
    await app.getByRole("button", { name: "Request access", exact: true }).click();
    await expect(app.getByRole("dialog", { name: "Request access" })).toBeVisible();
  });

  for (const href of PATHS) {
    test(`no mutating control on ${href}`, async ({ app }) => {
      await app.goto(href, { waitUntil: "load" });
      // The rail renders its items only once /me/permissions has arrived (fail closed before).
      await expect(app.getByRole("navigation").getByRole("link").first()).toBeVisible({ timeout: 20_000 });
      await expect(app.locator("main [aria-busy='true']")).toHaveCount(0, { timeout: 20_000 }).catch(() => {});

      const offenders = await app.locator("button, a, [role='button'], [role='menuitem']").evaluateAll((els) =>
        els
          .filter((el) => {
            const r = (el as HTMLElement).getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          })
          .map((el) => ({
            name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim(),
            disabled: (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true",
          })),
      );
      const bad = offenders.filter((c) => MUTATING.test(c.name) && !(c.disabled && PRIMARY.test(c.name)));
      expect(bad, `mutating controls on ${href}`).toEqual([]);
    });
  }
});

// Control for the detector above: the default (admin) fixture does see mutating controls.
test("an admin sees the Test and Extract now controls", async ({ app }) => {
  await app.goto("/systems", { waitUntil: "load" });
  await expect(app.getByRole("button", { name: "Test" }).first()).toBeEnabled({ timeout: 20_000 });
  await app.goto("/systems/s1", { waitUntil: "load" });
  const extract = app.getByRole("button", { name: "Extract now", exact: true });
  await expect(extract).toBeEnabled({ timeout: 20_000 });
  await extract.click();
  await expect(app.getByText("Extract objects into a new run")).toBeVisible();
});
