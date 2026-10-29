/**
 * The Meridian 2 help videos: one recorded tour per guide chapter (docs/guide/tours.json), in fixture mode, so no
 * backend and no customer data is ever on camera. Run only by the `recording` project (RECORD_HELP=1). Each step shows
 * its caption, moves a visible cursor slowly to its target and acts, then holds long enough to read. The test writes
 * the caption cues and the poster time beside the capture (help-videos-raw/captions/<video>.json);
 * scripts/help-videos.mjs turns the capture into <video>.mp4, <video>.vtt and <video>.jpg in docs/help-videos/.
 *
 *   npx next build && PORT=3100 npm run start:standalone   (or any server; PLAYWRIGHT_BASE_URL points at it)
 *   RECORD_HELP=1 PLAYWRIGHT_BASE_URL=http://localhost:3100 PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome \
 *     npx playwright test --project=recording e2e/guided-tours-v2.spec.ts --workers=2
 *   node scripts/help-videos.mjs
 *
 * TOUR_DRY=1 walks every tour quickly to check each step's target exists, without waiting to be read.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test, type Locator, type Page } from "@playwright/test";
import tours from "../docs/guide/tours.json";

interface Target { role?: string; name?: string; exact?: boolean; text?: string; testid?: string; label?: string; nth?: number; optional?: boolean }
interface Step {
  caption: string;
  go?: string;
  point?: Target;
  click?: Target;
  check?: Target;
  select?: { label: string; value: string };
  fill?: { label: string; text: string };
  focus?: string;
  press?: string;
  scroll?: number;
  in?: "dialog";
}
interface Tour { video: string; chapter: string; params: string; steps: Step[] }

const DRY = process.env.TOUR_DRY === "1";
const RAW = path.join(__dirname, "..", "help-videos-raw", "captions");
/** Reading pace: a caption stays up at least this long, and longer for longer captions. */
const MIN_HOLD = DRY ? 150 : 4200;
const PER_WORD = DRY ? 0 : 330;
const MOVE_STEPS = DRY ? 2 : 40;

/** The cursor Playwright's video does not draw: a small arrow that follows the mouse and survives navigation. */
const CURSOR = `(() => {
  const draw = () => {
    if (document.getElementById("__tour_cursor")) return;
    const c = document.createElement("div");
    c.id = "__tour_cursor";
    c.setAttribute("aria-hidden", "true");
    c.innerHTML = '<svg width="22" height="26" viewBox="0 0 22 26"><path d="M2 2 L2 21 L7 16 L11 24 L14 23 L10 15 L17 15 Z" fill="#1A2233" stroke="#FFFFFF" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    c.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;will-change:transform";
    let at = { x: 720, y: 450 };
    try { at = JSON.parse(sessionStorage.getItem("__tour_cursor") || "") || at; } catch (e) {}
    c.style.transform = "translate(" + at.x + "px," + at.y + "px)";
    document.documentElement.appendChild(c);
    document.addEventListener("mousemove", (e) => {
      c.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px)";
      try { sessionStorage.setItem("__tour_cursor", JSON.stringify({ x: e.clientX, y: e.clientY })); } catch (err) {}
    }, true);
    document.addEventListener("mousedown", () => { c.style.opacity = "0.55"; }, true);
    document.addEventListener("mouseup", () => { c.style.opacity = "1"; }, true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", draw); else draw();
})();`;

function locate(page: Page, t: Target, inDialog: boolean): Locator {
  const scope = inDialog ? page.getByRole("dialog").last() : page;
  let l: Locator;
  if (t.testid) l = scope.getByTestId(t.testid);
  else if (t.role) l = scope.getByRole(t.role as Parameters<Page["getByRole"]>[0], t.name ? { name: t.name, exact: t.exact ?? true } : undefined);
  else if (t.label) l = scope.getByLabel(t.label);
  else l = scope.getByText(t.text ?? "", { exact: false });
  return l.filter({ visible: true }).nth(t.nth ?? 0);
}

async function moveTo(page: Page, l: Locator): Promise<void> {
  await l.scrollIntoViewIfNeeded({ timeout: 10_000 });
  const box = await l.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + Math.min(box.width / 2, 60), box.y + box.height / 2, { steps: MOVE_STEPS });
  if (!DRY) await page.waitForTimeout(350);
}

const withParams = (href: string, params: string) => `${href}${href.includes("?") ? "&" : "?"}fixture=1${params ? `&${params}` : ""}`;
const holdFor = (caption: string) => Math.max(MIN_HOLD, caption.split(/\s+/).length * PER_WORD);

async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(DRY ? 100 : 600);
}

for (const tour of (tours as { tours: Tour[] }).tours) {
  test(tour.video, async ({ page }) => {
    test.setTimeout(15 * 60_000);
    // Every action is bounded, so a missing target fails its step at once instead of holding the recording.
    page.setDefaultTimeout(15_000);
    const t0 = Date.now();
    await page.context().addCookies([{ name: "mn_session", value: "1", domain: new URL(test.info().project.use.baseURL ?? "http://localhost:3000").hostname, path: "/" }]);
    await page.addInitScript((s) => {
      try {
        localStorage.setItem("meridian:theme", s);
      } catch {
        /* blocked storage: the system scheme, which the project sets to light */
      }
    }, "light");
    await page.addInitScript(CURSOR);
    // Fixture mode answers every v2 read; nothing reaches an API, so no live data can appear in a recording.
    await page.route("**/api/v1/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));

    const cues: { start: number; end: number; text: string }[] = [];
    let poster: number | null = null;
    for (const [i, step] of tour.steps.entries()) {
      const start = (Date.now() - t0) / 1000;
      if (step.go) {
        await page.goto(withParams(step.go, tour.params), { waitUntil: "load", timeout: 90_000 });
        await settle(page);
      }
      const inDialog = step.in === "dialog";
      try {
        if (step.point) await moveTo(page, locate(page, step.point, inDialog));
        if (step.click) {
          const l = locate(page, step.click, inDialog);
          await moveTo(page, l);
          await l.click({ timeout: 10_000 });
          await settle(page);
        }
        if (step.check) {
          const l = locate(page, step.check, inDialog);
          await moveTo(page, l);
          await l.check({ timeout: 10_000 });
        }
        if (step.select) {
          const l = page.getByLabel(step.select.label).first();
          await moveTo(page, l);
          await l.selectOption(step.select.value);
          await settle(page);
        }
        if (step.fill) {
          const l = page.getByPlaceholder(step.fill.label).or(page.getByRole("textbox", { name: step.fill.label })).filter({ visible: true }).first();
          await l.fill("");
          await l.pressSequentially(step.fill.text, { delay: DRY ? 0 : 110 });
          await settle(page);
        }
        if (step.focus) await page.locator(step.focus).first().focus();
        if (step.press) {
          await page.keyboard.press(step.press);
          await settle(page);
        }
        if (step.scroll) {
          if (inDialog) await page.getByRole("dialog").last().hover().catch(() => undefined);
          await page.mouse.wheel(0, step.scroll);
          await page.waitForTimeout(DRY ? 50 : 700);
        }
      } catch (e) {
        const target = step.point ?? step.click ?? step.check;
        if (!target?.optional) throw new Error(`${tour.video} step ${i + 1} ("${step.caption}"): ${(e as Error).message.split("\n")[0]}`);
      }
      if (poster === null && i === 0) poster = start + 2.5;
      await page.waitForTimeout(holdFor(step.caption));
      cues.push({ start, end: (Date.now() - t0) / 1000, text: step.caption });
    }
    if (DRY) return;
    mkdirSync(RAW, { recursive: true });
    writeFileSync(path.join(RAW, `${tour.video}.json`), `${JSON.stringify({ video: tour.video, chapter: tour.chapter, outputDir: test.info().outputDir, poster, cues }, null, 2)}\n`);
  });
}
