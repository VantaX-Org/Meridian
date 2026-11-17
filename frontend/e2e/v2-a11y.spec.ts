/**
 * WCAG 2.1 AA evidence for the journey shell, in fixture mode (`?fixture=1`), against a running server.
 *
 *   1. axe (wcag2a, wcag2aa, wcag21a, wcag21aa) on every top-level page, in English, German and Japanese, light and
 *      dark, at 1440: no critical or serious violation.
 *   2. 200 % zoom at 1440 (a 720 px viewport at device scale 2) and reflow at 320: no sideways scroll, no control cut off.
 *   3. The skip link moves focus to the main region.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 npx playwright test e2e/v2-a11y.spec.ts
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const NAV = { timeout: 90_000 };
const LOCALES = [
  { lang: "en", tag: null },
  { lang: "de", tag: "de-DE" },
  { lang: "ja", tag: "ja-JP" },
] as const;
const SCHEMES = ["light", "dark"] as const;

/** Every top-level page of the journey shell. */
const PAGES: { name: string; url: string }[] = [
  { name: "home", url: "/?fixture=1" },
  { name: "work", url: "/work?fixture=1" },
  { name: "runs", url: "/runs?fixture=1" },
  { name: "load", url: "/load?fixture=1" },
  { name: "object", url: "/o/ecc-production/material-master?fixture=1" },
  { name: "people", url: "/people?fixture=1" },
  { name: "rules", url: "/rules?fixture=1" },
  { name: "systems", url: "/s?fixture=1" },
  { name: "admin", url: "/admin?fixture=1" },
  { name: "reports", url: "/reports?fixture=1" },
  { name: "status", url: "/status?fixture=1" },
];

async function prepare(page: Page, scheme: "light" | "dark", tag: string | null, reduced = false) {
  await page.context().addCookies([{ name: "mn_session", value: "1", domain: "localhost", path: "/" }]);
  await page.addInitScript(
    ([s, l]) => {
      try {
        localStorage.setItem("meridian:theme", s as string);
        if (l) localStorage.setItem("meridian:prefs", JSON.stringify({ theme: s, locale: l }));
      } catch {
        /* blocked storage: the page falls back to its defaults */
      }
    },
    [scheme, tag],
  );
  if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/v1/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
}

async function open(page: Page, url: string) {
  await page.goto(url, { waitUntil: "load", timeout: 90_000 });
  await expect(page.locator("h1").first()).toBeVisible(NAV);
  // Some pages poll (the job line, the status refresh): settle, but never wait on a page that never goes idle.
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
}

async function axe(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const blockers = result.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  const other = result.violations.filter((v) => v.impact !== "critical" && v.impact !== "serious");
  const summary = blockers.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s), ${v.help}\n  ${v.nodes.map((n) => n.target.join(" ")).join("\n  ")}`).join("\n");
  console.log(`[axe] ${label}: ${result.passes.length} rules passed, ${blockers.length} critical or serious, ${other.length} moderate or minor${other.length ? ` (${other.map((v) => v.id).join(", ")})` : ""}`);
  expect(blockers, summary).toEqual([]);
}

const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

/** Every visible button, link and field of the selector lies inside the viewport horizontally. */
async function noneClipped(page: Page, selector: string) {
  const out = await page.evaluate((sel) => {
    const w = window.innerWidth;
    return Array.from(document.querySelectorAll<HTMLElement>(sel))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
      })
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.left < -1 || r.right > w + 1;
      })
      // A control inside its own scroll container (a wide table, a tab strip)
      // is reachable by scrolling that container, which 1.4.10 allows.
      .filter((el) => {
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const ox = getComputedStyle(a).overflowX;
          if (ox === "auto" || ox === "scroll") return false;
        }
        return true;
      })
      .map((el) => `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}"`);
  }, selector);
  return out;
}

/* 1. axe on every page, every language, both themes */

for (const loc of LOCALES) {
  for (const scheme of SCHEMES) {
    test.describe(`axe, ${loc.lang}, ${scheme}`, () => {
      test.use({ viewport: { width: 1440, height: 900 }, colorScheme: scheme });
      test.setTimeout(600_000);
      test(`every page has no critical or serious violation`, async ({ page }) => {
        await prepare(page, scheme, loc.tag);
        for (const p of PAGES) {
          await open(page, p.url);
          if (loc.tag) await expect(page.locator(".nx-root[lang], .m2-root[lang]").first()).toHaveAttribute("lang", loc.tag);
          await axe(page, `${p.name} ${loc.lang} ${scheme}`);
        }
      });
    });
  }
}

/* 2. 200 % zoom and reflow at 320 */

for (const vp of [
  { label: "200% zoom", viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 },
  { label: "reflow 320", viewport: { width: 320, height: 640 }, deviceScaleFactor: 1 },
]) {
  test.describe(vp.label, () => {
    test.use({ viewport: vp.viewport, deviceScaleFactor: vp.deviceScaleFactor });
    test.setTimeout(300_000);
    test("no sideways scroll and no control cut off", async ({ page }) => {
      await prepare(page, "light", null);
      for (const p of PAGES) {
        await open(page, p.url);
        expect(await noSideways(page), `${p.name}: sideways scroll`).toBe(true);
        expect(await noneClipped(page, "main a, main button, main input, main select"), `${p.name}: clipped`).toEqual([]);
      }
    });
  });
}

/* 3. The skip link */

test("the skip link moves focus to the main region", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare(page, "light", null);
  await open(page, "/?fixture=1");
  await page.keyboard.press("Tab");
  const skip = page.locator('nav[aria-label="Skip links"] a[href="#nx-main"]');
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#nx-main")).toBeFocused();
});
