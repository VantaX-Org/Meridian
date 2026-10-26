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

type Mode = "light" | "dark" | "reduced-motion" | "empty";
const MODES: Mode[] = ["light", "dark", "reduced-motion", "empty"];

async function prepare(page: Page, mode: Mode): Promise<void> {
  const theme = mode === "dark" ? "dark" : "light";
  await page.addInitScript((t) => window.localStorage.setItem("meridian:theme", t), theme);
  // the recorded user's server-side preference is light and would win over the local choice
  await page.route("**/api/v1/me/preferences", (r) =>
    r.request().method() === "GET" ? r.fulfill({ json: { theme, density: "default" } }) : r.fallback());
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
  // and for it to stop moving: axe reads an empty title while Next swaps the element
  const title = await page.title();
  await page.waitForFunction((t) => document.title === t && document.querySelector("head > title")?.textContent === t, title);
  // axe reads mid-fade opacity as low contrast, so wait for finite animations to end
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity));
}

for (const r of ROUTES) {
  for (const mode of MODES) {
    test(`visual — ${r.name} (${mode})`, async ({ app }, testInfo) => {
      await prepare(app, mode);
      await app.goto(r.path, { waitUntil: "load" });
      // a detail route's heading is its item's name, which a fresh install does not have
      await expect(app.getByRole("heading", { level: 1, ...(mode === "empty" ? {} : { name: r.heading }) })).toBeVisible();
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
    // the rule ledger is the first table on the page; coverage by object follows it
    await app.locator("main table").first().locator("tbody tr").first().click();
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
    await open(app, "/admin/users", "Users");
    // the first row sits at the bottom of the viewport on the recording, where the row menu flips up
    // under the sticky table header and cannot be clicked; give it room below first
    const actions = app.getByRole("button", { name: /^Actions for / }).first();
    await actions.scrollIntoViewIfNeeded();
    await actions.click();
    await popup(app, "menu");
    await app.getByRole("button", { name: "Invite user" }).click();
    await popup(app, "dialog");
    await actions.scrollIntoViewIfNeeded();
    await actions.click();
    await expect(app.getByRole("menu")).toBeVisible();
    await app.getByRole("menuitem", { name: "Edit" }).click();
    await app.getByRole("combobox", { name: "Role" }).click();
    await popup(app, "listbox");
  });

  test("admin/triage: team dialog and its strategy Select", async ({ app }) => {
    await open(app, "/admin/triage", "Triage");
    // the header's button and the empty state's action share the label
    await app.getByRole("button", { name: "Add team" }).first().click();
    await expect(app.getByRole("dialog", { name: "Add team" })).toBeVisible();
    await settle(app);
    await axe(app);
    await app.getByRole("combobox", { name: "Strategy" }).click();
    await expect(app.getByRole("listbox")).toBeVisible();
    await settle(app);
    await axe(app);
  });
});

/**
 * Chart surfaces at two widths in light and dark. The charts have settled (nothing is
 * aria-busy, no skeleton is left), every chart names itself through its aria-label, no two
 * x-axis tick labels of one chart overlap, a screenshot is kept per route, width and theme,
 * and axe is clean.
 */
const CHART_ROUTE_NAMES = [
  "insights", "insights-trends", "insights-rules", "insights-impact", "insights-progress", "insights-exec", "insights-readiness",
  "home", "runs-detail", "systems-detail",
];
const CHART_ROUTES = CHART_ROUTE_NAMES.map((name) => {
  const route = ROUTES.find((r) => r.name === name);
  if (!route) throw new Error(`routes.json has no route named ${name}`);
  return route;
});
const CHART_WIDTHS = [1440, 1024];
const CHART_THEMES: Mode[] = ["light", "dark"];

type TickOverlap = { chart: string; a: string; b: string };

/** Pairs of x-axis tick labels whose boxes intersect, per chart (the chart is named by its aria-label). */
async function overlappingTicks(page: Page): Promise<TickOverlap[]> {
  return page.evaluate(() => {
    const found: { chart: string; a: string; b: string }[] = [];
    for (const wrapper of Array.from(document.querySelectorAll(".recharts-wrapper"))) {
      const chart = wrapper.closest("[role='img']")?.getAttribute("aria-label") ?? "(unnamed chart)";
      const ticks = Array.from(wrapper.querySelectorAll(".recharts-xAxis .recharts-cartesian-axis-tick text"))
        .map((t) => ({ text: (t.textContent ?? "").trim(), box: t.getBoundingClientRect() }))
        .filter((t) => t.text && t.box.width > 0 && t.box.height > 0);
      for (let i = 0; i < ticks.length; i++) {
        for (let j = i + 1; j < ticks.length; j++) {
          const p = ticks[i].box;
          const q = ticks[j].box;
          const apart = p.right <= q.left || q.right <= p.left || p.bottom <= q.top || q.bottom <= p.top;
          if (!apart) found.push({ chart, a: ticks[i].text, b: ticks[j].text });
        }
      }
    }
    return found;
  });
}

for (const r of CHART_ROUTES) {
  for (const width of CHART_WIDTHS) {
    for (const theme of CHART_THEMES) {
      test(`charts — ${r.name} at ${width} (${theme})`, async ({ app }, testInfo) => {
        await prepare(app, theme);
        await app.setViewportSize({ width, height: 900 });
        await app.goto(r.path, { waitUntil: "load" });
        await expect(app.getByRole("heading", { level: 1, name: r.heading })).toBeVisible();
        if (theme === "dark") await expect(app.locator("html")).toHaveAttribute("data-theme", "dark");
        await settle(app);

        // charts have settled: nothing is still loading and no skeleton is left on the page
        await expect(app.locator("[aria-busy='true']")).toHaveCount(0);
        await expect(app.locator(".m-skeleton-sweep")).toHaveCount(0);
        await expect(app.locator('[data-state="error"]')).toHaveCount(0);

        const charts = app.locator("[role='img']");
        const labels = await charts.evaluateAll((els) => els.map((el) => (el.getAttribute("aria-label") ?? "").trim()));
        testInfo.annotations.push({ type: "charts", description: `${labels.length} chart(s) on ${r.path} at ${width}` });
        expect(labels.filter((l) => l === ""), "every [role=img] chart carries a non-empty aria-label").toEqual([]);

        const overlaps = await overlappingTicks(app);
        expect(overlaps, "no two x-axis tick labels of one chart overlap").toEqual([]);

        await app.screenshot({ path: testInfo.outputPath(`${r.name}-${width}-${theme}.png`), fullPage: true });
        await axe(app);
      });
    }
  }
}
