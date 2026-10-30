/**
 * The cut-over (Meridian 2, step 7): the addresses of the retired interface and of /v2 still open the page that does
 * the same job, by a permanent redirect (next.config.ts, table in docs/guide/redirects.md), with the query carried
 * along. Also axe on the pages that stand outside the shell: sign in, forgot password, licence needed, the status
 * page and an address that leads nowhere.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3100 PW_CHROMIUM=/opt/pw-browsers/chromium-1194/chrome-linux/chrome npx playwright test e2e/redirects.spec.ts
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/** Old address, the address it must answer with (path and query, as the Location header says it), and the status. */
const SAMPLE: [string, string][] = [
  ["/v2", "/"],
  ["/v2/work?filter=approvals", "/work?filter=approvals"],
  ["/v2/o/ecc-production/material-master/rules", "/o/ecc-production/material-master/rules"],
  ["/v2/status", "/status"],
  ["/home", "/"],
  ["/home/steward", "/"],
  ["/fix", "/work"],
  ["/fix?check=MM014", "/work?rule=MM014&check=MM014"],
  ["/fix?mine=1", "/work?assigned=me&mine=1"],
  ["/inbox", "/work?open=inbox"],
  ["/inbox?kind=approvals", "/work?filter=approvals&kind=approvals"],
  ["/objects", "/"],
  ["/objects/material_master", "/o/_/material_master"],
  ["/objects/material_master?tab=history", "/o/_/material_master/runs?tab=history"],
  ["/objects/material_master/rules/MM014", "/r/MM014"],
  ["/insights/readiness", "/?view=waves"],
  ["/insights/readiness?module=material_master", "/o/_/material_master/readiness?module=material_master"],
  ["/insights/owners", "/people"],
  ["/insights/trends", "/runs"],
  ["/rules/MM014", "/r/MM014"],
  ["/rules/drafts", "/rules?view=drafts"],
  ["/rules/contracts", "/people?open=contracts"],
  ["/runs/R1", "/run/R1"],
  ["/runs/R1/vs/R2", "/run/R1/vs/R2"],
  ["/systems", "/"],
  ["/systems/S1", "/s/S1"],
  ["/mdm/golden/G1", "/?open=golden%3AG1"],
  ["/migration", "/?view=waves&open=waves"],
  ["/admin/jobs", "/admin/system"],
  ["/admin/sign-in", "/admin/signin"],
  ["/help", "/?open=help"],
  ["/me/preferences", "/?open=preferences"],
  ["/import", "/admin/runs"],
  ["/workbench?tab=batches&batch=B1", "/work?batch=B1&tab=batches"],
];

/** The Location of a redirect as path and query, whether the server wrote it absolute or relative. */
const where = (location: string | undefined): string => {
  if (!location) return "";
  const u = new URL(location, "http://x");
  return `${u.pathname}${u.search}`;
};

/** The same query, whatever order the keys come in. */
const same = (a: string, b: string) => {
  const [pa, qa = ""] = a.split("?");
  const [pb, qb = ""] = b.split("?");
  const sort = (q: string) => [...new URLSearchParams(q).entries()].map(([k, v]) => `${k}=${v}`).sort().join("&");
  return pa === pb && sort(qa) === sort(qb);
};

test.describe("old addresses", () => {
  for (const [from, to] of SAMPLE) {
    test(`${from} answers with a permanent redirect to ${to}`, async ({ request }) => {
      const r = await request.get(from, { maxRedirects: 0 });
      expect(r.status(), from).toBe(308);
      const got = where(r.headers()["location"]);
      expect(same(got, to), `${from} went to ${got}`).toBe(true);
    });
  }

  // The pages behind the redirect need the signed-in marker cookie; fixture mode answers the API.
  test.beforeEach(async ({ page, baseURL }) => {
    await page.context().addCookies([{ name: "mn_session", value: "1", url: baseURL ?? "http://localhost:3000" }]);
  });

  test("an old object link lands on the object of the system that holds it", async ({ page }) => {
    await page.goto("/objects/material_master?fixture=1", { waitUntil: "load", timeout: 90_000 });
    await expect(page).toHaveURL(/\/o\/ecc-production\/material_master(\?|$)/, { timeout: 90_000 });
    await expect(page.getByRole("heading", { level: 1, name: "Material master" })).toBeVisible();
  });

  test("an old Fix work link opens the Work ledger with the same filter", async ({ page }) => {
    await page.goto("/fix?fixture=1&check=MM014", { waitUntil: "load", timeout: 90_000 });
    await expect(page).toHaveURL(/\/work\?.*rule=MM014/, { timeout: 90_000 });
  });
});

test.describe("pages outside the shell", () => {
  const PAGES = [
    { name: "sign-in", url: "/sign-in", h1: "Sign in" },
    { name: "forgot-password", url: "/forgot-password", h1: "Reset password" },
    { name: "licence-error", url: "/licence-error", h1: "Licence needed" },
    { name: "status", url: "/status?fixture=1", h1: "Status" },
    // Signed out, an unknown address goes to sign in like any other; the marker cookie lets it reach the 404.
    { name: "not-found", url: "/no-such-page", h1: "There is nothing at this address", signedIn: true },
  ];
  for (const p of PAGES) {
    test(`${p.name} has one h1 and no critical or serious axe violation`, async ({ page, baseURL }) => {
      if ("signedIn" in p) await page.context().addCookies([{ name: "mn_session", value: "1", url: baseURL ?? "http://localhost:3000" }]);
      await page.goto(p.url, { waitUntil: "load", timeout: 90_000 });
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(p.h1, { timeout: 90_000 });
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const bad = result.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
      expect(bad.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    });
  }
});
