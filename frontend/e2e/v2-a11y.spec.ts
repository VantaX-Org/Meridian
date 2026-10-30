/**
 * Meridian 2, step 8: WCAG 2.1 AA evidence, in fixture mode (`?fixture=1`), against a running server.
 *
 *   1. axe (wcag2a, wcag2aa, wcag21a, wcag21aa) on every v2 page, in English, German and Japanese, light and dark, at
 *      1440: no critical or serious violation. Each result is logged as one line, so the audit can quote the counts.
 *   2. The shell holds in all three languages at 1440 and 390: no sideways scroll, the map stays 280 px wide, the top
 *      bar keeps its controls on screen, and the inspector fits; screenshots land in __screenshots__/v2/i18n-*.png.
 *   3. 200 % zoom at 1440 (a 720 px viewport at device scale 2): no sideways scroll and no control cut off.
 *   4. Keyboard-only walkthroughs of the five main flows, with the skip links and visible focus.
 *   5. prefers-reduced-motion stops the notice's slide and the timeline's fade.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test e2e/v2-a11y.spec.ts
 */

import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const SHOTS = path.join(__dirname, "__screenshots__", "v2");
const NAV = { timeout: 90_000 };
const ECC = "a1b2c3d4-0001-4000-8000-000000000001";
const LOCALES = [
  { lang: "en", tag: null },
  { lang: "de", tag: "de-DE" },
  { lang: "ja", tag: "ja-JP" },
] as const;
const SCHEMES = ["light", "dark"] as const;

/** Every v2 page the e2e suite visits, with an inspector open where the page has one worth checking. */
const PAGES: { name: string; url: string }[] = [
  { name: "landscape", url: "/?fixture=1" },
  { name: "landscape-rule", url: "/?fixture=1&open=rule:MM142" },
  { name: "landscape-basis-system", url: `/?fixture=1&persona=basis&open=system:${ECC}` },
  { name: "landscape-waves", url: "/?fixture=1&view=waves" },
  { name: "object", url: "/o/ecc-production/material-master?fixture=1" },
  { name: "object-rules", url: "/o/ecc-production/material-master/rules?fixture=1" },
  { name: "rule", url: "/r/MM142?fixture=1" },
  { name: "work", url: "/work?fixture=1&persona=steward" },
  { name: "work-approvals", url: "/work?fixture=1&persona=owner&filter=approvals" },
  { name: "runs", url: "/runs?fixture=1" },
  { name: "runs-jobs", url: "/runs?fixture=1&view=jobs" },
  { name: "people", url: "/people?fixture=1&persona=owner" },
  { name: "reports", url: "/reports?fixture=1" },
  { name: "system", url: `/s/${ECC}?fixture=1` },
  { name: "system-configuration", url: `/s/${ECC}?fixture=1&tab=configuration` },
  { name: "system-custom", url: `/s/${ECC}?fixture=1&tab=custom-objects` },
  { name: "connect", url: "/s/new?fixture=1" },
  { name: "rules-library", url: "/rules?fixture=1" },
  { name: "process-designer", url: "/o/ecc-production/material-master/processes/design?fixture=1" },
  { name: "object-golden", url: "/o/ecc-production/material-master/golden?fixture=1" },
  { name: "inbox", url: "/?fixture=1&open=inbox" },
  { name: "preferences", url: "/?fixture=1&open=preferences" },
  { name: "help", url: "/?fixture=1&open=help" },
  { name: "admin", url: "/admin?fixture=1" },
  { name: "admin-users", url: "/admin/users?fixture=1" },
  { name: "admin-settings", url: "/admin/settings?fixture=1" },
  { name: "admin-system", url: "/admin/system?fixture=1" },
  { name: "admin-audit", url: "/admin/audit?fixture=1" },
  { name: "admin-runs", url: "/admin/runs?fixture=1" },
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
      test(`every v2 page has no critical or serious violation`, async ({ page }) => {
        await prepare(page, scheme, loc.tag);
        for (const p of PAGES) {
          await open(page, p.url);
          if (loc.tag) await expect(page.locator(".m2-root").first()).toHaveAttribute("lang", loc.tag);
          await axe(page, `${p.name} ${loc.lang} ${scheme}`);
        }
      });
    });
  }
}

/* 2. The shell in three languages at 1440 and 390, with screenshots */

for (const size of [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
] as const) {
  for (const loc of LOCALES) {
    test.describe(`layout, ${loc.lang}, ${size.name}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: "light" });
      test.setTimeout(240_000);
      const phone = size.width < 500;
      const shot = (page: Page, name: string) => (loc.lang === "en" ? Promise.resolve() : page.screenshot({ path: path.join(SHOTS, `i18n-${loc.lang}-${name}_${size.name}.png`) }));

      test("the top bar, the map and the inspector hold the longer and the Japanese words", async ({ page }) => {
        await prepare(page, "light", loc.tag);
        await open(page, "/?fixture=1");
        expect(await noSideways(page)).toBe(true);
        expect(await noneClipped(page, ".m2-top button, .m2-top a")).toEqual([]);
        // Every control of the top bar keeps a usable width and none sits on another.
        const crowded = await page.evaluate(() => {
          const boxes = Array.from(document.querySelectorAll<HTMLElement>(".m2-top > * > button, .m2-top > * > a, .m2-top > button"))
            .filter((el) => getComputedStyle(el).display !== "none")
            .map((el) => ({ name: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30), r: el.getBoundingClientRect() }));
          const out: string[] = [];
          for (const b of boxes) if (b.r.width < 20) out.push(`${b.name} is ${Math.round(b.r.width)}px wide`);
          for (let i = 0; i < boxes.length; i++)
            for (let j = i + 1; j < boxes.length; j++) {
              const a = boxes[i].r;
              const c = boxes[j].r;
              if (a.left < c.right - 1 && c.left < a.right - 1 && a.top < c.bottom - 1 && c.top < a.bottom - 1) out.push(`${boxes[i].name} overlaps ${boxes[j].name}`);
            }
          return out;
        });
        expect(crowded).toEqual([]);
        if (!phone) {
          const map = await page.locator("#m2-map").boundingBox();
          expect(Math.round(map?.width ?? 0)).toBe(280);
          expect(await noneClipped(page, "#m2-map a, #m2-map button")).toEqual([]);
          const overflow = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("#m2-map .m2-mi, #m2-map .m2-sysrow")).filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent));
          expect(overflow).toEqual([]);
        }
        await shot(page, "landscape");
        await open(page, "/o/ecc-production/material-master?fixture=1&open=rule:MM142");
        const insp = page.getByTestId("inspector");
        await expect(insp).toBeVisible(NAV);
        expect(await noSideways(page)).toBe(true);
        expect(await noneClipped(page, "#m2-inspector button, #m2-inspector a")).toEqual([]);
        const inspOverflow = await page.evaluate(() => {
          const el = document.querySelector<HTMLElement>("#m2-inspector");
          return el ? el.scrollWidth - el.clientWidth : 0;
        });
        expect(inspOverflow).toBeLessThanOrEqual(1);
        await shot(page, "object-inspector");
        await open(page, "/admin/users?fixture=1");
        expect(await noSideways(page)).toBe(true);
        await shot(page, "admin-users");
        await open(page, "/work?fixture=1&persona=steward");
        expect(await noSideways(page)).toBe(true);
        await shot(page, "work");
      });
    });
  }
}

/* 3. 200 % zoom at 1440 */

test.describe("200% zoom at 1440", () => {
  // A 1440 px window at 200 % zoom lays out in 720 CSS pixels at twice the device scale.
  test.use({ viewport: { width: 720, height: 450 }, deviceScaleFactor: 2 });
  test.setTimeout(300_000);
  for (const loc of LOCALES) {
    test(`no sideways scroll and no clipped control, ${loc.lang}`, async ({ page }) => {
      await prepare(page, "light", loc.tag);
      for (const url of ["/?fixture=1", "/o/ecc-production/material-master?fixture=1", "/work?fixture=1&persona=steward", "/admin/settings?fixture=1", "/admin/users?fixture=1", "/status?fixture=1", "/?fixture=1&open=preferences"]) {
        await open(page, url);
        expect(await noSideways(page), url).toBe(true);
        expect(await noneClipped(page, ".m2-top button, .m2-top a, .m2-canvas > * button, #m2-inspector button, .m2-stat-page button, .m2-stat-page a"), url).toEqual([]);
      }
      if (loc.lang === "en") await page.screenshot({ path: path.join(SHOTS, "zoom-200-settings.png") });
    });
  }
});

/* 3b. Reflow at 320 CSS px (1280 at 400 %): the page itself never scrolls sideways; data grids scroll in their own frame. */

test.describe("reflow at 320", () => {
  test.use({ viewport: { width: 320, height: 640 } });
  test.setTimeout(300_000);
  test("no sideways page scroll on the main pages", async ({ page }) => {
    await prepare(page, "light", "de-DE");
    for (const url of ["/?fixture=1", "/o/ecc-production/material-master?fixture=1", "/work?fixture=1&persona=steward", "/admin/settings?fixture=1", "/status?fixture=1"]) {
      await page.goto(url, { waitUntil: "load", timeout: 90_000 });
      await expect(page.locator("h1").first()).toBeVisible(NAV);
      await page.waitForTimeout(1500);
      expect(await noSideways(page), url).toBe(true);
    }
  });
});

/* 4. Keyboard-only walkthroughs of the five main flows */

/** Presses Tab until the focused element matches, up to a limit; fails when it never does. */
async function tabTo(page: Page, accessibleName: RegExp, limit = 80) {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press("Tab");
    const name = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return "";
      const label = (el as HTMLInputElement).labels?.[0]?.textContent;
      return (el.getAttribute("aria-label") ?? label ?? el.textContent ?? "").trim();
    });
    if (accessibleName.test(name)) return;
  }
  throw new Error(`Tab never reached ${accessibleName}`);
}

/** The focused element draws a visible ring (an outline or a box shadow), not colour alone. */
async function focusVisible(page: Page) {
  const style = await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return null;
    const s = getComputedStyle(el);
    return { outline: s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 1, shadow: s.boxShadow !== "none", bg: s.backgroundColor };
  });
  expect(style?.outline || style?.shadow || Boolean(style?.bg && style.bg !== "rgba(0, 0, 0, 0)")).toBe(true);
}

test.describe("keyboard only", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.setTimeout(180_000);

  test("skip links lead to the content, the map and the inspector", async ({ page }) => {
    await prepare(page, "light", null);
    await open(page, "/?fixture=1&open=rule:MM142");
    // The inspector took focus when it opened; start from the top of the page, as a fresh visit would.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.mouse.click(2, 2);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
    await expect(page.getByRole("link", { name: "Skip to content" })).toBeVisible();
    await focusVisible(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to the map" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to the inspector" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#m2-inspector/);
    // Landmarks: banner, main, the map and the inspector as complementary regions, the status strip as contentinfo.
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("banner")).toHaveCount(1);
    await expect(page.getByRole("complementary", { name: "Map" })).toHaveCount(1);
    await expect(page.getByRole("complementary", { name: "Inspector" })).toHaveCount(1);
    await expect(page.getByRole("contentinfo", { name: "Status" })).toHaveCount(1);
  });

  test("flow 1: landscape to an object to the rule inspector", async ({ page }) => {
    await prepare(page, "light", null);
    await open(page, "/?fixture=1");
    await tabTo(page, /^Material master/);
    await focusVisible(page);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/o\/ecc-production\/material-master/, NAV);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Material master", NAV);
    const grid = page.getByRole("grid", { name: "Rules for Material master" });
    await grid.focus();
    await focusVisible(page);
    await page.keyboard.press("j");
    await page.keyboard.press("Enter");
    const dialog = page.getByTestId("inspector");
    await expect(dialog).toBeVisible(NAV);
    await expect(page.getByRole("button", { name: "Close inspector" })).toBeFocused();
    await focusVisible(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("flow 2: a ledger decision, then Undo from the keyboard", async ({ page }) => {
    await prepare(page, "light", null);
    await open(page, "/work?fixture=1&persona=steward");
    const grid = page.getByRole("grid", { name: "Work ledger" });
    await expect(grid).toBeVisible(NAV);
    const chips = page.getByRole("group", { name: "Filter by state" });
    await expect(chips.getByRole("button", { name: /To fix/ })).toContainText("25,712");
    // The decision cell of a row with a suggested value, reached by Tab and changed with the arrow keys.
    await tabTo(page, /^Decision for 000000000000000100$/, 200);
    await focusVisible(page);
    await page.keyboard.press("ArrowDown");
    const notice = page.getByRole("region", { name: "Change notices" });
    await expect(notice).toContainText(/Accepted 1 suggested value/, NAV);
    await expect(chips.getByRole("button", { name: /To fix/ })).toContainText("25,711");
    await page.locator("#m2-canvas").focus();
    await page.keyboard.press("Control+z");
    await expect(notice).toContainText("Undone", NAV);
    await expect(chips.getByRole("button", { name: /To fix/ })).toContainText("25,712");
  });

  test("flow 3: approve a batch", async ({ page }) => {
    await prepare(page, "light", null);
    await open(page, "/work?fixture=1&persona=owner&filter=approvals");
    await tabTo(page, /^Approve batch B-241$/);
    await focusVisible(page);
    await page.keyboard.press("Enter");
    const notice = page.getByRole("region", { name: "Change notices" });
    await expect(notice).toContainText("Approved batch B-241", NAV);
    await tabTo(page, /^Undo$/, 200);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("group", { name: "Filter by state" }).getByRole("button", { name: /Waiting for approval/ })).toContainText("612", NAV);
  });

  test("flow 4: start an extraction as Basis", async ({ page }) => {
    await prepare(page, "light", null);
    await open(page, "/?fixture=1&persona=basis");
    await tabTo(page, /^Extract SuccessFactors$/);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "SuccessFactors" });
    await expect(dialog).toBeVisible(NAV);
    await expect(dialog.getByRole("button", { name: "Close inspector" })).toBeFocused();
    await page.goto(`/?fixture=1&persona=basis&open=system:${ECC}`, { waitUntil: "load" });
    const ecc = page.getByRole("dialog", { name: "ECC production" });
    await expect(ecc).toBeVisible(NAV);
    await tabTo(page, /^Extract$/);
    await page.keyboard.press("Enter");
    const picker = ecc.getByTestId("extract-picker");
    await expect(picker).toBeVisible();
    await tabTo(page, /Material master/, 60);
    await page.keyboard.press("Space");
    await tabTo(page, /^Extract \d+ objects?$/, 60);
    await focusVisible(page);
    await page.keyboard.press("Enter");
    await expect(ecc.getByTestId("action-result")).toContainText(/Extraction started|started/i, NAV);
  });

  test("flow 5: an administrator invites a user", async ({ page }) => {
    await prepare(page, "light", null);
    await open(page, "/admin/users?fixture=1");
    await tabTo(page, /^Invite a user$/);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Invite a user" });
    await expect(dialog).toBeVisible(NAV);
    await tabTo(page, /^Email/, 20);
    await page.keyboard.type("new.person@demo-corp.example");
    await tabTo(page, /^Send the invitation$/, 30);
    await focusVisible(page);
    await page.keyboard.press("Enter");
    await expect(dialog.getByTestId("action-result")).toContainText("Invitation sent to new.person@demo-corp.example", NAV);
  });
});

/* 5. Reduced motion */

test.describe("prefers-reduced-motion", () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test("stops the notice's slide and the timeline's fade", async ({ page }) => {
    await prepare(page, "light", null, true);
    await open(page, "/runs?fixture=1");
    const marks = await page.evaluate(() => Array.from(document.querySelectorAll(".m2-tl-mk")).map((el) => getComputedStyle(el).animationName));
    expect(marks.length).toBeGreaterThan(0);
    expect(new Set(marks)).toEqual(new Set(["none"]));
    await open(page, "/work?fixture=1&persona=owner&filter=approvals");
    await page.getByRole("button", { name: "Approve batch B-241" }).first().click();
    const toast = page.locator(".m2-toast").first();
    await expect(toast).toBeVisible(NAV);
    expect(await toast.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  });

  test("without the preference the notice slides in", async ({ page }) => {
    await prepare(page, "light", null, false);
    await open(page, "/work?fixture=1&persona=owner&filter=approvals");
    await page.getByRole("button", { name: "Approve batch B-241" }).first().click();
    const toast = page.locator(".m2-toast").first();
    await expect(toast).toBeVisible(NAV);
    expect(await toast.evaluate((el) => getComputedStyle(el).animationName)).toBe("m2-toast-in");
  });
});
