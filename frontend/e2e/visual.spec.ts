/**
 * Visual QA — every workspace route in light, dark and reduced-motion.
 * Each pass saves a full-page screenshot under test-results (no committed
 * baselines) and runs axe against WCAG 2.1 A/AA with zero violations allowed.
 * The reduced-motion pass also asserts that no element, or its ::before or
 * ::after, has a computed animation-name other than none. The empty pass
 * replays a fresh install (no systems, runs, objects or waves) in light.
 * Outside /design (which shows the error state on purpose) no route may
 * render an ErrorState. A second group opens a Select popup, a dialog, a
 * menu and a drill drawer on representative routes and re-runs axe there.
 */

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, ROUTES, test } from "./fixtures";
import { mockRoutes12 } from "./fixtures/mocks-12";

type Mode = "light" | "dark" | "reduced-motion" | "empty";
const MODES: Mode[] = ["light", "dark", "reduced-motion", "empty"];

async function prepare(page: Page, mode: Mode): Promise<void> {
  // content for every route, scoped to this spec so other specs keep the plain recording
  await mockRoutes12(page);
  const theme = mode === "dark" ? "dark" : "light";
  await page.addInitScript((t) => window.localStorage.setItem("aurora:theme", t), theme);
  await page.emulateMedia({ reducedMotion: mode === "reduced-motion" ? "reduce" : "no-preference" });
  if (mode === "empty") {
    // a fresh install: no systems, runs, objects or waves (registered last, so it wins)
    // lists come back empty and any single item is not found
    await page.route(/\/api\/v1\/(systems|versions|objects|migration\/waves)(\?|$|\/)/, (route) => {
      const url = route.request().url();
      if (/\/api\/v1\/(systems|versions|objects|migration\/waves)\/[^?]/.test(url)) return route.fulfill({ status: 404, json: { detail: "Not found" } });
      return route.fulfill({ json: /\/api\/v1\/systems(\?|$)/.test(url) ? [] : { versions: [], objects: [], waves: [], items: [] } });
    });
  }
}

async function axe(page: Page): Promise<void> {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const summary = result.violations
    .map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(" ")).join("\n  ")}`)
    .join("\n");
  expect(result.violations, summary).toEqual([]);
}

async function settle(page: Page): Promise<void> {
  // Next streams metadata and hoists <title> into <head> once the stream ends, so wait for the
  // network to go quiet before reading it; otherwise axe can catch the title mid-move
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(() => document.title !== "");
  // axe reads mid-fade opacity as low contrast, so wait for finite animations to end
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity));
}

for (const r of ROUTES) {
  for (const mode of MODES) {
    test(`visual — ${r.name} (${mode})`, async ({ app }, testInfo) => {
      await prepare(app, mode);
      await app.goto(r.path, { waitUntil: "load" });
      await expect(app.getByRole("heading", { level: 1, name: r.heading })).toBeVisible();
      if (mode === "dark") await expect(app.locator("html")).toHaveAttribute("data-theme", "dark");
      await settle(app);

      await app.screenshot({ path: testInfo.outputPath(`${r.name}-${mode}.png`), fullPage: true });

      // the empty pass may show a not-found error for a detail route whose item no longer exists
      if (r.path !== "/design" && mode !== "empty") await expect(app.locator('[data-state="error"]')).toHaveCount(0);

      await axe(app);

      if (mode === "reduced-motion") {
        const animated = await app.evaluate(() => {
          const found: string[] = [];
          for (const el of Array.from(document.querySelectorAll("*"))) {
            for (const pseudo of [null, "::before", "::after"]) {
              const name = getComputedStyle(el, pseudo).animationName;
              if (name !== "none") found.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}${pseudo ?? ""}: ${name}`);
            }
          }
          return found;
        });
        expect(animated).toEqual([]);
      }
    });
  }
}

/** Overlays render in a portal outside the initial scan: open each, settle, and scan again. */
test.describe("visual — overlays", () => {
  test.beforeEach(async ({ app }) => {
    await prepare(app, "light");
  });

  async function open(app: Page, path: string, heading: string | RegExp) {
    await app.goto(path, { waitUntil: "load" });
    await expect(app.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await settle(app);
  }

  async function popup(app: Page, role: "listbox" | "dialog" | "menu") {
    await expect(app.getByRole(role).last()).toBeVisible();
    await settle(app);
    await axe(app);
    await app.keyboard.press("Escape");
    await expect(app.getByRole(role)).toHaveCount(0);
  }

  test("rules: filter Select and the rule drill drawer", async ({ app }) => {
    await open(app, "/rules", "Rules");
    await app.getByRole("combobox").first().click();
    await popup(app, "listbox");
    await app.locator("main table").last().locator("tbody tr").first().click();
    await popup(app, "dialog");
  });

  test("inbox: type Select and the reject drawer", async ({ app }) => {
    await open(app, "/inbox", "Inbox");
    await app.getByRole("combobox").first().click();
    await popup(app, "listbox");
    await app.getByRole("button", { name: "Reject", exact: true }).first().click();
    await popup(app, "dialog");
  });

  test("admin/users: row menu, edit form Select and the invite drawer", async ({ app }) => {
    await open(app, "/admin/users", "Users and audit");
    await app.getByRole("button", { name: /^Actions for / }).first().click();
    await popup(app, "menu");
    await app.getByRole("button", { name: "Invite user" }).click();
    await popup(app, "dialog");
    await app.getByRole("button", { name: /^Actions for / }).first().click();
    await app.getByRole("menuitem", { name: "Edit" }).click();
    await app.getByRole("combobox", { name: "Role" }).click();
    await popup(app, "listbox");
  });

  test("admin/triage: team dialog and its strategy Select", async ({ app }) => {
    await open(app, "/admin/triage", "Triage");
    await app.getByRole("button", { name: "Add team" }).click();
    await expect(app.getByRole("dialog", { name: "Add team" })).toBeVisible();
    await settle(app);
    await axe(app);
    await app.getByRole("combobox", { name: "Strategy" }).click();
    await expect(app.getByRole("listbox")).toBeVisible();
    await settle(app);
    await axe(app);
  });
});
