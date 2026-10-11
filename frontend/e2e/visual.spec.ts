/**
 * Visual QA — every workspace route in light, dark and reduced-motion.
 * Each pass saves a full-page screenshot under test-results (no committed
 * baselines) and runs axe against WCAG 2.1 A/AA with zero violations allowed.
 * The reduced-motion pass also asserts that no element, or its ::before or
 * ::after, has a computed animation-name other than none. The empty pass
 * replays a fresh install (no systems, runs, objects or waves) in light.
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

      const result = await new AxeBuilder({ page: app })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
        .analyze();
      const summary = result.violations
        .map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.map((n) => n.target.join(" ")).join("\n  ")}`)
        .join("\n");
      expect(result.violations, summary).toEqual([]);

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
