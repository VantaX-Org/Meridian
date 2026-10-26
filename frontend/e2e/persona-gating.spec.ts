/**
 * Persona roles end to end: for each persona key in api/services/rbac.py PERSONA_ROLES (fixtures in
 * fixtures/persona-permissions.ts), signed in with /me/permissions and /auth/me answering for that role only:
 *  - /home lands on the persona's home (lib/persona.ts homeHrefForRole),
 *  - the index bar shows exactly the pills and More entries lib/nav.ts gives that role (visibleNav, then the
 *    Rail's own railSplit), computed here from the same code so the spec tracks nav changes,
 *  - its pills open without an error panel, and every other page its nav offers opens for the first persona that
 *    has it (TAIL), so every nav page is opened at least once,
 *  - each page's primary actions show (enabled) exactly when the role's permissions allow them.
 * Modelled on viewer-gating.spec.ts; the API is the recording (fixtures.ts).
 */

import type { Page } from "@playwright/test";
import { expect, test, RECORDED } from "./fixtures";
import { PERSONA_ROLES, personaActions, personaPermissionsPayload, type PersonaRole } from "./fixtures/persona-permissions";
import { homeHrefForRole, pillSetFor } from "../lib/persona";
import { MAX_PILLS, resolveNavHref, visibleNav } from "../lib/nav";
import { railSplit } from "../design/shell/Rail";

type Resources = Record<string, Record<string, boolean>>;

/** What the Rail renders for a role: pill hrefs and the More panel as { group, hrefs }. */
function expectedNav(role: PersonaRole) {
  const p = personaPermissionsPayload(role);
  const actions = new Set(p.actions);
  const groups = visibleNav({
    can: (a) => actions.has(a),
    // the recorded licence is "not yet checked" (valid: null), which enables every menu item
    isMenuItemEnabled: () => true,
    has: (r, a) => p.resources[r]?.[a] === true,
  });
  // the Rail resolves with the viewer's `can`: a data owner's Home is Inbox › Approvals, not /fix
  const resolve = (href: string) => resolveNavHref(href, role, (a) => actions.has(a));
  const { main, more } = railSplit(groups, pillSetFor(role), resolve);
  return {
    pills: main.map((i) => resolve(i.href)),
    more: more.map((g) => ({ group: g.group, hrefs: g.items.map((i) => resolve(i.href)) })),
  };
}

/**
 * Primary actions per page. `allowed` is the gate the page applies (the same permission name or resource pair);
 * when allowed the control is visible and enabled, otherwise no enabled control of that name is on the page.
 * `gated` is the accessible name of the disabled stand-in a GatedPrimary leaves (rbac.md section 5, ruling 2).
 */
interface Primary {
  path: string;
  name: string;
  allowed: (actions: ReadonlySet<string>, resources: Resources) => boolean;
  gated?: RegExp;
}

const SYSTEM = `/systems/${RECORDED.systemId}`;
const PRIMARIES: readonly Primary[] = [
  { path: SYSTEM, name: "Extract", allowed: (a) => a.has("trigger_sync"), gated: new RegExp(`^Extract\\. Needs SAP Basis on ${RECORDED.systemName}`) },
  { path: SYSTEM, name: "Test connection", allowed: (a) => a.has("trigger_sync") },
  { path: SYSTEM, name: "Edit", allowed: (a) => a.has("manage_systems") },
  { path: "/systems", name: "Connect system", allowed: (_a, r) => r.systems?.create === true },
  { path: "/import", name: "Choose file", allowed: (a) => a.has("upload") },
  { path: "/rules", name: "New rule", allowed: (a) => a.has("manage_rules") },
  { path: "/rules/contracts", name: "New contract", allowed: (a) => a.has("manage_rules") },
  { path: "/admin/users", name: "Invite user", allowed: (a) => a.has("manage_users") },
  { path: "/process", name: "Run discovery", allowed: (a) => a.has("run_process_discovery") },
];

/**
 * Pages whose API is not in the recording: they show "Could not reach the server" for every role, the default
 * (admin) fixture included, so they are fixture gaps, not persona gaps. Their page checks are fixme until the
 * recording (or a mock in fixtures.ts) answers them. Empty: /process, /process/runs, /home/process, /fix,
 * /insights/progress, /mdm/golden/merge, /mdm/glossary and /admin/audit are answered by fixtures/mocks-unrecorded.ts.
 */
const MISSING_FIXTURES: Record<string, string> = {};

/**
 * Each persona's More entries not already opened by an earlier persona (PERSONA_ROLES order): every nav page is
 * opened at least once, and each persona opens its own pills, without repeating the long tail six times.
 */
const TAIL = new Map<PersonaRole, string[]>();
{
  const opened = new Set<string>();
  for (const role of PERSONA_ROLES) {
    const nav = expectedNav(role);
    nav.pills.forEach((h) => opened.add(h));
    const tail = nav.more.flatMap((g) => g.hrefs).filter((h) => !opened.has(h));
    tail.forEach((h) => opened.add(h));
    TAIL.set(role, tail);
  }
}

async function signInAs(page: Page, role: PersonaRole) {
  const payload = personaPermissionsPayload(role);
  await page.route(/\/api\/v1\/me\/permissions/, (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) }));
  await page.route(/\/api\/v1\/auth\/me(\?|$)/, (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: { id: `e2e-${role}`, email: `${role}@example.test`, name: role, role, permissions: payload.actions, home: payload.home },
        must_change_password: false,
      }),
    }));
}

/**
 * Waits for the shell to have its permissions and the page to settle, the way viewer-gating.spec.ts does: the
 * Rail renders its links only once /me/permissions has arrived, then the page's own loading states clear. The
 * shell's one h1 is the Breadcrumb's (sr-only when the page draws its own title), outside <main>, so it is waited
 * for as attached, not visible.
 */
async function settle(page: Page) {
  await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link").first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("h1").first()).toBeAttached({ timeout: 30_000 });
  await expect(page.locator("main [aria-busy='true']")).toHaveCount(0, { timeout: 20_000 }).catch(() => {});
}

/** The fixture gap a page hits, by its exact href: a tab (/fix?tab=batches) may not make the call its page's default tab does. */
const gapFor = (href: string): string | undefined => MISSING_FIXTURES[href];

for (const role of PERSONA_ROLES) {
  test.describe(`persona ${role}`, () => {
    const actions = new Set(personaActions(role));
    const resources = personaPermissionsPayload(role).resources;
    const nav = expectedNav(role);
    const home = homeHrefForRole(role, (a) => actions.has(a));
    const pages = [...new Set([...nav.pills, ...(TAIL.get(role) ?? [])])];

    test.beforeEach(async ({ app }) => {
      await signInAs(app, role);
    });

    test("expected nav is not empty", () => {
      expect(nav.pills.length).toBeGreaterThan(0);
      expect(nav.pills.length).toBeLessThanOrEqual(MAX_PILLS);
    });

    test(`/home lands on ${home}`, async ({ app }) => {
      // only the redirect is checked here, so a home whose API is not recorded (MISSING_FIXTURES) still runs
      await app.goto("/home", { waitUntil: "load" });
      await expect.poll(() => { const u = new URL(app.url()); return u.pathname + u.search; }, { timeout: 30_000 }).toBe(home);
    });

    test("index bar shows exactly its pills and More entries", async ({ app }) => {
      await app.goto("/rules/dictionary", { waitUntil: "load" });
      await settle(app);
      const pills = await app.getByTestId("rail-nav-items").getByRole("link").evaluateAll((els) =>
        // a Fix pill opens the Cleaning tab when the newest run has no work list; it is still the /fix pill
        els.map((el) => (el.getAttribute("href") ?? "").replace(/\?tab=cleaning$/, "")));
      expect(pills).toEqual(nav.pills);

      const moreButton = app.getByRole("navigation", { name: "Main" }).getByRole("button", { name: "More" });
      if (nav.more.length === 0) {
        await expect(moreButton).toHaveCount(0);
        return;
      }
      await moreButton.click();
      const panel = app.getByTestId("topnav-more-panel");
      await expect(panel).toBeVisible();
      const more = await panel.locator(".m-topnav-group").evaluateAll((groups) =>
        groups.map((g) => ({
          group: g.querySelector(".m-topnav-group-label")?.textContent ?? "",
          hrefs: [...g.querySelectorAll("a")].map((a) => a.getAttribute("href") ?? ""),
        })));
      expect(more).toEqual(nav.more);
    });

    for (const href of pages) {
      test(`opens ${href} without an error panel`, async ({ app }) => {
        test.fixme(gapFor(href) !== undefined, gapFor(href));
        // A call the recording does not hold is aborted (fixtures.ts notFound: "abort"); the page shows its error
        // panel only after React Query's retry, which can land after settle(). So when a call failed, give the
        // panel time to appear before asserting there is none, and name the calls in the failure.
        const failed: string[] = [];
        app.on("requestfailed", (r) => { if (r.url().includes("/api/v1/")) failed.push(new URL(r.url()).pathname); });
        await app.goto(href, { waitUntil: "load" });
        await settle(app);
        const errorPanel = app.locator("main [data-state='error']");
        if (failed.length) await expect(errorPanel).not.toHaveCount(0, { timeout: 10_000 }).catch(() => {});
        await expect(errorPanel, `error panel; aborted API calls: ${[...new Set(failed)].join(", ")}`).toHaveCount(0);
      });
    }

    for (const p of PRIMARIES) {
      const allowed = p.allowed(actions, resources);
      test(`${allowed ? "sees" : "does not see"} "${p.name}" on ${p.path}`, async ({ app }) => {
        test.fixme(gapFor(p.path) !== undefined, gapFor(p.path));
        await app.goto(p.path, { waitUntil: "load" });
        await settle(app);
        const control = app.locator("main").getByRole("button", { name: p.name, exact: true });
        if (allowed) {
          await expect(control.first()).toBeEnabled({ timeout: 20_000 });
        } else {
          await expect(control.and(app.locator(":enabled"))).toHaveCount(0);
          if (p.gated) await expect(app.getByRole("button", { name: p.gated }).first()).toBeDisabled();
        }
      });
    }
  });
}
