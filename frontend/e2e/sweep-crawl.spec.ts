/**
 * Element-level sweep of every route in fixture mode. For each page of the app router (dynamic segments filled from the
 * fixture ids) it checks that the page draws, raises no uncaught error, has no dead internal link, and that every
 * visible button, tab and menu item in the page body does something observable when clicked (navigates, opens a
 * sheet or dialog, mutates the DOM, sends a request or starts a download). What each element did is written to
 * docs/qa/crawl/<route>.json; scripts/qa-matrix.mjs turns those files into docs/qa/coverage-matrix.md.
 *
 * A click with no observable effect fails the test unless the element is listed in NO_EFFECT_OK below with the reason.
 * "Observable" is a weak oracle: it proves the control is wired, not that the outcome is right; the targeted specs
 * (sweep-flows.spec.ts and the older ones) assert outcomes.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3102 npx playwright test e2e/sweep-crawl.spec.ts
 */

import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const NAV = { timeout: 90_000 };
const APP = path.join(__dirname, "..", "app");
const OUT = path.join(__dirname, "..", "..", "docs", "qa", "crawl");

// ids that exist in the fixture data the demo build serves (same table as v2-journeys.spec.ts)
const SAMPLE: Record<string, string> = {
  system: "ecc-production",
  module: "material-master",
  section: "users",
  key: "MATNR-100",
  id: "f0000000-0000-4000-8000-000000000500",
  b: "f0000000-0000-4000-8000-000000000499",
  pair: "mig-0002",
  token: "demo-token",
  "sign-in": "",
  "sign-up": "",
};
// per-route overrides where the generic id is wrong for the route
const ID_FOR: [RegExp, string][] = [
  [/^\/load\/waves\//, "w-1"],
  [/^\/load\/runs\//, "mig-0002"],
  [/^\/mdm\/(golden|match)\//, "gr-0"],
  [/^\/requests\//, "CR-1001"],
  [/^\/r\//, "MM142"],
  [/^\/s\//, "a1b2c3d4-0001-4000-8000-000000000001"],
  [/^\/run\//, "f0000000-0000-4000-8000-000000000500"],
];

/** Controls that legitimately do nothing visible in fixture mode, with the reason. Keyed `route|label`. */
const NO_EFFECT_OK: Record<string, string> = {};

function routesOnDisk(dir = APP, rel = ""): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...routesOnDisk(dir, path.join(rel, e.name)));
    else if (e.name === "page.tsx") {
      const segs = rel.split(path.sep).filter((s) => !/^\(.*\)$/.test(s));
      out.push("/" + segs.join("/"));
    }
  }
  return out;
}

function fill(route: string): string {
  let url = route.replace(/\/\[{1,2}(?:\.\.\.)?([a-z-]+)\]{1,2}/g, (_, k: string) => (SAMPLE[k] ? "/" + SAMPLE[k] : ""));
  for (const [re, id] of ID_FOR) if (re.test(route) && /\]$/.test(route)) url = url.replace(/\/[^/]+$/, "/" + id);
  if (route === "/run/[id]/vs/[b]") url = `/run/${SAMPLE.id}/vs/${SAMPLE.b}`;
  if (route === "/o/[system]/[module]/records/[key]") url = `/o/${SAMPLE.system}/${SAMPLE.module}/records/${SAMPLE.key}`;
  return url === "" ? "/" : url;
}

// Pages outside the signed-in shell: covered by sign-in-states.spec.ts and redirects.spec.ts, not by a body crawl.
const AUTH = /^\/(accept-invite|forgot-password|licence-error|login|reset-password|sign-in|sign-up)/;

const ROUTES = routesOnDisk().filter((r) => !AUTH.test(r)).sort();

async function prepare(page: Page) {
  await page.context().addCookies([{ name: "mn_session", value: "1", domain: "localhost", path: "/" }]);
  await page.route("**/api/v1/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
}

type Row = { kind: "button" | "link" | "tab" | "menuitem"; label: string; target?: string; effect: string; ok: boolean };

const INTERACTIVE = "main a[href], main button, main [role=tab], main [role=menuitem]";

async function open(page: Page, url: string) {
  const res = await page.goto(`${url}${url.includes("?") ? "&" : "?"}fixture=1`, { waitUntil: "load", ...NAV });
  expect(res?.status(), `${url} answered`).toBeLessThan(400);
  await expect(page.locator("main h1, h1").first()).toBeVisible(NAV);
  await expect(page.getByText("This page could not be found")).toHaveCount(0);
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
}

test.describe.configure({ mode: "parallel" });

test("every page.tsx has a sample address or is an auth page", () => {
  for (const r of ROUTES) expect(fill(r), `${r} left a placeholder`).not.toMatch(/\[/);
  expect(ROUTES.length).toBeGreaterThan(80);
});

for (const route of ROUTES) {
  test(`sweep ${route}`, async ({ page }) => {
    test.setTimeout(480_000);
    const url = fill(route);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    await prepare(page);
    await open(page, url);

    // 1. inventory (labels, kinds, hrefs) of the page body
    const items = await page.locator(INTERACTIVE).evaluateAll((els) =>
      els.map((el, i) => {
        const e = el as HTMLElement;
        const r = e.getBoundingClientRect();
        const visible = r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
        const role = e.getAttribute("role");
        const kind: Row["kind"] = e.tagName === "A" ? "link" : role === "tab" ? "tab" : role === "menuitem" ? "menuitem" : "button";
        const label = (e.getAttribute("aria-label") || e.textContent || e.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 80);
        const disabled = (e as HTMLButtonElement).disabled === true || e.getAttribute("aria-disabled") === "true";
        const selected = e.getAttribute("aria-selected") === "true" || e.getAttribute("aria-pressed") === "true" || e.getAttribute("aria-checked") === "true" || e.getAttribute("aria-current") === "page";
        return { i, kind, label, href: e.getAttribute("href"), visible, disabled, selected, download: e.hasAttribute("download") };
      }),
    );
    const rows: Row[] = [];

    // 2. links: internal ones must resolve; external, mailto and anchors are recorded, not fetched
    const seen = new Set<string>();
    for (const it of items.filter((x) => x.kind === "link" && x.visible)) {
      const href = it.href ?? "";
      if (!href || href.startsWith("#") || /^(mailto:|tel:|javascript:)/.test(href) || /^https?:\/\//.test(href) && !href.startsWith("http://localhost")) {
        rows.push({ kind: "link", label: it.label, target: href, effect: "not fetched (external, anchor or mailto)", ok: true });
        continue;
      }
      if (seen.has(href)) continue;
      seen.add(href);
      if (it.download) {
        rows.push({ kind: "link", label: it.label, target: href, effect: "download link, covered by the export checks", ok: true });
        continue;
      }
      const target = href.startsWith("http") ? href : new URL(href, page.url()).toString();
      const res = await page.request.get(`${target}${target.includes("?") ? "&" : "?"}fixture=1`, { timeout: 90_000 });
      rows.push({ kind: "link", label: it.label, target: href, effect: `GET ${res.status()}`, ok: res.status() < 400 });
    }

    // 3. buttons, tabs, menu items: click each from a fresh load and watch what happens
    const clickable = items.filter((x) => x.kind !== "link" && x.visible);
    for (const it of clickable) {
      if (it.disabled) {
        rows.push({ kind: it.kind, label: it.label, effect: "disabled in fixture state (not clicked)", ok: true });
        continue;
      }
      if (it.selected) {
        rows.push({ kind: it.kind, label: it.label, effect: "already the selected tab, chip or page link (a click re-selects it, nothing to show)", ok: true });
        continue;
      }
      await open(page, url);
      const el = page.locator(INTERACTIVE).nth(it.i);
      if (!(await el.isVisible()) || (await el.evaluate((e) => (e.getAttribute("aria-label") || e.textContent || e.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 80)).catch(() => "")) !== it.label && it.label !== "") {
        // The body re-rendered into a different arrangement between loads (async data): do not guess which control it was.
        rows.push({ kind: it.kind, label: it.label, effect: "SKIPPED: page rearranged between loads, not clicked", ok: false });
        continue;
      }
      const requests: string[] = [];
      const onReq = (r: { url(): string; method(): string }) => {
        const u = r.url();
        if (!/\.(js|css|woff2?|png|svg|ico|map)(\?|$)/.test(u) && !u.includes("_next/") && !u.includes("__nextjs")) requests.push(`${r.method()} ${new URL(u).pathname}`);
      };
      page.on("request", onReq);
      let downloaded = false;
      const onDl = () => { downloaded = true; };
      page.on("download", onDl);
      await page.evaluate(() => {
        const w = window as unknown as { __mut: number };
        w.__mut = 0;
        new MutationObserver((m) => { w.__mut += m.length; }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
      });
      const before = page.url();
      const errsBefore = errors.length;
      let clickErr = "";
      await el.click({ timeout: 8_000, trial: false }).catch((e: Error) => { clickErr = e.message.split("\n")[0]; });
      await page.waitForTimeout(500);
      page.off("request", onReq);
      page.off("download", onDl);
      const mut = await page.evaluate(() => (window as unknown as { __mut?: number }).__mut ?? -1).catch(() => -1); // -1: page navigated
      const nav = page.url() !== before || mut === -1;
      const dialog = await page.locator("[role=dialog], [role=alertdialog], [role=menu], [role=listbox]").count().catch(() => 0);
      const effects = [nav && "navigates", dialog && "opens dialog or menu", mut > 0 && `DOM changes (${mut})`, requests.length && `requests: ${[...new Set(requests)].slice(0, 3).join(", ")}`, downloaded && "download"].filter(Boolean);
      const key = `${route}|${it.label}`;
      let effect = effects.join("; ");
      let ok = true;
      if (clickErr) { effect = `CLICK FAILED: ${clickErr}`; ok = false; }
      else if (errors.length > errsBefore) { effect = `UNCAUGHT ERROR: ${errors[errors.length - 1]}`; ok = false; }
      else if (!effects.length) {
        effect = NO_EFFECT_OK[key] ? `none, accepted: ${NO_EFFECT_OK[key]}` : "NO OBSERVABLE EFFECT";
        ok = !!NO_EFFECT_OK[key];
      }
      rows.push({ kind: it.kind, label: it.label, effect, ok });
    }

    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${route.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "") || "home"}.json`), JSON.stringify({ route, url, errors, rows }, null, 1));
    const bad = rows.filter((r) => !r.ok).map((r) => `${r.kind} "${r.label}"${r.target ? ` -> ${r.target}` : ""}: ${r.effect}`);
    expect([...errors, ...bad], `${route}: ${rows.length} elements`).toEqual([]);
  });
}
