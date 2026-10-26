/**
 * Wave 16 acceptance: a viewer sees no mutating control on any (app) route.
 *
 * Routes are every nav href in lib/nav.ts (read from the source, so the spec
 * needs no React/icon imports) plus the recorded detail routes in
 * routes.json, which are where the gated primaries live. The only mutating
 * labels allowed in the DOM are the primaries components/gated-primary.tsx
 * keeps visible (Approve, Write back, Sign off, Extract now, plus Run
 * discovery and the golden record's Promote, an approval), and only disabled.
 */

import fs from "node:fs";
import path from "node:path";
import { expect, test, RECORDED, ROUTES } from "./fixtures";
import { LEGACY_PERMISSIONS, permissionsPayload } from "./fixtures/legacy-permissions";

const NAV_SOURCE = fs.readFileSync(path.join(__dirname, "..", "lib", "nav.ts"), "utf8");
const NAV_HREFS = [...NAV_SOURCE.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
// /fix?tab=batches covers the batch-level Export, which lives off the default tab.
// /design is the component gallery: it renders every state on purpose (an empty state's
// "Add the first one", an error state's "Retry") and is not a workspace route.
const PATHS = [...new Set([...NAV_HREFS, ...ROUTES.map((r) => r.path), "/fix?tab=batches"])].filter((p) => p !== "/design");

const MUTATING = /^(approve|reject|write ?back|sign off|extract( now)?|apply|accept|assign|merge|delete|remove|create|new|add|upload|import|run|re-run|rerun|sync|test|save|edit|discover|start|generate|invite|promote|publish|retry|resolve|dismiss|claim|export|bulk|deactivate|revoke|grant|decline)\b/i;
// A GatedPrimary names itself "<label>. Needs <role> on <scope> — Request access" when not permitted.
const PRIMARY = /^(approve|write back|sign off|extract( now)?|run discovery|promote|merge)\. Needs .+ — Request access$/i;

/**
 * Routes where a viewer still sees a control whose label starts with a mutating verb, each expected to fail here
 * until the page hides it for viewers. Empty: the /insights "Create remediation batch" (apply), /insights/readiness
 * "Create wave" (analyse) and the single-run "Import file" (upload) gaps are gated now.
 */
const KNOWN_GAPS: Record<string, string> = {};

test.describe("viewer gating", () => {
  test.beforeEach(async ({ app }) => {
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

  test("Extract stays visible, disabled, and Request access opens the Dialog", async ({ app }) => {
    await app.goto(`/systems/${RECORDED.systemId}`, { waitUntil: "load" });
    const extract = app.getByRole("button", { name: new RegExp(`^Extract\\. Needs SAP Basis on ${RECORDED.systemName} — Request access$`) });
    await expect(extract).toBeVisible({ timeout: 20_000 });
    await expect(extract).toBeDisabled();
    await app.getByRole("button", { name: "Request access", exact: true }).click();
    await expect(app.getByRole("dialog", { name: "Request access" })).toBeVisible();
  });

  test("Users shows the administrator notice instead of the user list", async ({ app }) => {
    await app.goto("/admin/users", { waitUntil: "load" });
    await expect(app.getByText(/only administrators manage users/i)).toBeVisible({ timeout: 20_000 });
    await expect(app.getByRole("button", { name: "Invite user" })).toHaveCount(0);
  });

  for (const href of PATHS) {
    test(`no mutating control on ${href}`, async ({ app }) => {
      test.fail(href in KNOWN_GAPS, KNOWN_GAPS[href]);
      await app.goto(href, { waitUntil: "load" });
      // The rail renders its items only once /me/permissions has arrived (fail closed before).
      await expect(app.getByRole("navigation").getByRole("link").first()).toBeVisible({ timeout: 20_000 });
      await expect(app.locator("main [aria-busy='true']")).toHaveCount(0, { timeout: 20_000 }).catch(() => {});

      // column-header sort buttons carry the column's name ("Run") and stat tiles their label and
      // value ("New failures 0", "Sync coverage 0%"), not an action
      const offenders = await app.locator("button, a, [role='button'], [role='menuitem']").evaluateAll((els) =>
        els
          .filter((el) => {
            const r = (el as HTMLElement).getBoundingClientRect();
            // a picker (the scope bar's run and object choice, a ChoiceGroup filter pill such as the jobs
            // page's Kind "Upload") changes what is shown, not the data; a chart's point buttons (the keyboard
            // path into its marks, design/charts/PointActions.tsx) are named after the data, e.g. the S/4 area
            // "New Asset Accounting, 2", and open a page; an error state's Retry reads the data again (pages
            // whose API is not in the recording show one)
            return r.width > 0 && r.height > 0 && !el.closest("th, [role='columnheader']") && !el.classList.contains("m-stat")
              && el.getAttribute("role") !== "combobox" && !el.classList.contains("m-choice")
              && !el.closest("[data-chart-points]") && !el.closest("[data-state='error']");
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
test("an admin sees the Test connection and Extract controls", async ({ app }) => {
  await app.goto(`/systems/${RECORDED.systemId}`, { waitUntil: "load" });
  await expect(app.getByRole("button", { name: "Test connection" })).toBeEnabled({ timeout: 20_000 });
  // The header primary; an empty object list repeats it as its own call to action.
  const extract = app.getByRole("button", { name: "Extract", exact: true }).first();
  await expect(extract).toBeEnabled({ timeout: 20_000 });
  await extract.click();
  await expect(app.getByText("Extract objects into a new run")).toBeVisible();
});
