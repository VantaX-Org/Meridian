/**
 * The buyer's acceptance walk against a live stack (API, worker, beat, Postgres, Redis, object storage and the built
 * frontend), not fixture mode. Skipped unless ACCEPTANCE_BASE_URL is set. Results of the October 2026 run:
 * frontend/docs/acceptance-2026-10.md.
 *
 * Before it runs, the stack holds what the walk reads (the run in the report did this through the API):
 *   - the default administrator's password changed to ACCEPTANCE_ADMIN_PASSWORD;
 *   - one user per role, <role>@ACCEPTANCE_DOMAIN with ACCEPTANCE_PASSWORD: lead (programme_lead), steward
 *     (data_steward), owner (data_owner), basis (sap_basis), analyst (analyst), auditor (auditor);
 *   - a system (ACCEPTANCE_SYSTEM, slug of its name) with business partner and material master uploaded and analysed,
 *     business partner twice so two runs can be compared;
 *   - a webhook to an https listener and a digest (the walk sends a test and a digest from the screens).
 *
 *   ACCEPTANCE_BASE_URL=http://127.0.0.1:3010 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3010 \
 *   ACCEPTANCE_ADMIN_PASSWORD=... ACCEPTANCE_PASSWORD=... npx playwright test e2e/acceptance.spec.ts
 *
 * The walk changes data (a decision, an approval, an exception, a pack applied, sandbox entered and left): run it on an
 * acceptance tenant, never on production.
 */

import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const BASE = process.env.ACCEPTANCE_BASE_URL ?? "";
const API = process.env.ACCEPTANCE_API_URL ?? BASE;
const DOMAIN = process.env.ACCEPTANCE_DOMAIN ?? "acceptance.test";
const ADMIN = process.env.ACCEPTANCE_ADMIN_EMAIL ?? "admin@meridian.local";
const ADMIN_PW = process.env.ACCEPTANCE_ADMIN_PASSWORD ?? "";
const PW = process.env.ACCEPTANCE_PASSWORD ?? "";
const SYSTEM = process.env.ACCEPTANCE_SYSTEM ?? "ecc-acceptance";
const OBJECT = process.env.ACCEPTANCE_OBJECT ?? "business-partner";
const MODULE = OBJECT.replace(/-/g, "_");
const CHECK = process.env.ACCEPTANCE_CHECK ?? "BP002";

const ROLES = {
  lead: "Programme lead / CIO",
  steward: "Data steward",
  owner: "Data owner / approver",
  basis: "SAP Basis / integration admin",
  analyst: "Analyst",
  auditor: "Auditor",
} as const;
type Who = keyof typeof ROLES | "admin";

test.skip(!BASE, "ACCEPTANCE_BASE_URL is not set: the acceptance walk needs a live stack");
// in order, one worker (--workers=1); a failed step does not stop the walk, so the report counts every step
test.describe.configure({ mode: "default" });
test.use({ baseURL: BASE });
test.setTimeout(180_000);

const email = (who: Who) => (who === "admin" ? ADMIN : `${who}@${DOMAIN}`);
const password = (who: Who) => (who === "admin" ? ADMIN_PW : PW);

/** The number on a step, kept in the report as an annotation. */
function note(text: string) {
  test.info().annotations.push({ type: "observed", description: text });
}

type Saved = Awaited<ReturnType<ReturnType<Page["context"]>["storageState"]>>;
const sessions = new Map<Who, Saved>();

/** Sign in through the form once per role, then reuse the session: the API allows a handful of sign-ins a minute
 * from one address, and the walk signs in about twenty times. */
async function signIn(page: Page, who: Who) {
  const saved = sessions.get(who);
  if (saved) {
    await page.context().addCookies(saved.cookies);
    const storage = saved.origins.find((o) => o.origin === new URL(BASE).origin)?.localStorage ?? [];
    await page.addInitScript((items) => { for (const { name, value } of items) window.localStorage.setItem(name, value); }, storage);
    await page.goto("/", { waitUntil: "load" });
    await expect(page.getByRole("button", { name: /^Account/ })).toBeVisible({ timeout: 30_000 });
    return;
  }
  await page.goto("/sign-in", { waitUntil: "load" });
  await expect(page.getByLabel("Work email")).toBeFocused();
  await page.getByLabel("Work email").fill(email(who));
  await page.getByLabel("Password", { exact: true }).fill(password(who));
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^Account/ })).toBeVisible({ timeout: 30_000 });
  sessions.set(who, await page.context().storageState());
}

const tokens = new Map<Who, string>();
async function token(request: APIRequestContext, who: Who): Promise<string> {
  const hit = tokens.get(who);
  if (hit) return hit;
  // the session the browser already holds (lib/api/client.ts keeps it in localStorage): no extra sign-in
  const kept = sessions.get(who)?.origins.flatMap((o) => o.localStorage).find((i) => i.name === "mn_auth_token")?.value;
  if (kept) {
    tokens.set(who, kept);
    return kept;
  }
  const r = await request.post(`${API}/api/v1/auth/login`, { data: { email: email(who), password: password(who) } });
  expect(r.status(), `sign-in of ${who} through the API`).toBe(200);
  const t = (await r.json()).token as string;
  tokens.set(who, t);
  return t;
}
async function apiGet<T>(request: APIRequestContext, who: Who, path: string): Promise<T> {
  const r = await request.get(`${API}/api/v1${path}`, { headers: { Authorization: `Bearer ${await token(request, who)}` } });
  expect(r.status(), `GET ${path} as ${who}`).toBe(200);
  return (await r.json()) as T;
}
async function apiPost<T>(request: APIRequestContext, who: Who, path: string, data?: unknown): Promise<{ status: number; body: T }> {
  const r = await request.post(`${API}/api/v1${path}`, { headers: { Authorization: `Bearer ${await token(request, who)}` }, data });
  return { status: r.status(), body: (await r.json().catch(() => ({}))) as T };
}

/** Choose a language in Preferences and wait until the server kept it (the next page load reads it back). */
async function chooseLanguage(page: Page, lang: "en" | "de" | "ja") {
  await page.goto("/?open=preferences");
  const picker = page.getByTestId("language-picker");
  await expect(picker).toBeVisible({ timeout: 30_000 });
  if ((await picker.inputValue()) === lang) return;
  const saved = page.waitForResponse((r) => r.url().includes("/api/v1/me/preferences") && r.request().method() === "PATCH");
  await picker.selectOption(lang);
  expect((await saved).status()).toBe(200);
  await expect.poll(() => page.evaluate(() => document.documentElement.lang), { timeout: 30_000 }).toMatch(new RegExp(`^${lang}`));
}

/** The canvas never shows the not-found page or a read error. */
async function expectScreen(page: Page) {
  await expect(page.getByText("There is nothing at this address")).toHaveCount(0);
  await expect(page.getByText(/could not be read/i)).toHaveCount(0);
}

test("1. the default administrator signs in; the six role users are listed", async ({ page }) => {
  await signIn(page, "admin");
  await page.goto("/admin/users");
  const table = page.locator("main");
  await expect(table.getByText(/seats? in use/)).toBeVisible({ timeout: 30_000 });
  for (const who of Object.keys(ROLES) as (keyof typeof ROLES)[]) {
    await expect(table.getByText(email(who))).toBeVisible();
  }
  note(`${(await table.getByText(/seats? in use/).innerText()).trim()}`);
});

for (const [who, label] of Object.entries(ROLES) as [keyof typeof ROLES, string][]) {
  test(`2. ${who} signs in and sees the landscape as ${label}`, async ({ page }) => {
    await signIn(page, who);
    await expect(page.getByRole("button", { name: new RegExp(`^Account, ${label.split(" /")[0]}`) })).toBeVisible();
    await page.goto("/");
    await expect(page.getByText(/objects? (is|are) held under 85|objects? scored/).first()).toBeVisible({ timeout: 30_000 });
    await expectScreen(page);
  });
}

test("3. lead: the object canvas, its receipt and every tab", async ({ page }) => {
  await signIn(page, "lead");
  await page.goto(`/o/${SYSTEM}/${OBJECT}`);
  await expect(page.getByTestId("receipt")).toBeVisible({ timeout: 30_000 });
  note((await page.getByText(/^Measured [\d.]+/).first().innerText()).trim());
  for (const tab of ["records", "fixes", "runs", "readiness", "processes", "lineage", "glossary", "golden"]) {
    await page.goto(`/o/${SYSTEM}/${OBJECT}/${tab}`);
    await page.waitForLoadState("load");
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 30_000 });
    await expectScreen(page);
  }
});

test("4. lead: the rule canvas and its four tabs", async ({ page }) => {
  await signIn(page, "lead");
  await page.goto(`/r/${CHECK}`);
  await expect(page.getByText(/failing across \d+ objects?/)).toBeVisible({ timeout: 45_000 });
  note((await page.getByText(/failing across \d+ objects?/).innerText()).trim());
  for (const tab of ["Failing records", "Impact", "History", "Definition"]) {
    await page.getByRole("link", { name: tab, exact: true }).or(page.getByRole("tab", { name: tab, exact: true })).first().click();
    await expectScreen(page);
  }
});

test("5. steward: a decision and a proposed fix in the Work ledger", async ({ page }) => {
  await signIn(page, "steward");
  await page.goto(`/work?module=${MODULE}`);
  const decisions = page.getByLabel(/^Decision for /);
  await expect(decisions.first()).toBeVisible({ timeout: 45_000 });
  const before = (await page.getByRole("button", { name: /^Waiting for approval/ }).innerText()).replace(/\D+/g, "");
  // a fix: a new value and the decision "fix"
  const firstKey = ((await decisions.nth(1).getAttribute("aria-label")) ?? "").replace("Decision for ", "");
  await page.getByLabel(`New value for ${firstKey}`).fill("1000009101");
  await page.getByLabel(`Decision for ${firstKey}`).selectOption({ label: "fix" });
  // a decision: not an issue
  const secondKey = ((await decisions.nth(2).getAttribute("aria-label")) ?? "").replace("Decision for ", "");
  await page.getByLabel(`Decision for ${secondKey}`).selectOption({ label: "not an issue" });
  await expect.poll(async () => (await page.getByRole("button", { name: /^Waiting for approval/ }).innerText()).replace(/\D+/g, ""),
    { timeout: 30_000 }).not.toBe(before);
  note(`waiting for approval ${before} -> ${(await page.getByRole("button", { name: /^Waiting for approval/ }).innerText()).replace(/\D+/g, "")}; fixed ${firstKey}, not an issue ${secondKey}`);
});

test("6. owner: approves the waiting batch (four eyes)", async ({ page }) => {
  await signIn(page, "owner");
  await page.goto("/work?filter=approvals");
  const approve = page.getByRole("button", { name: /^Approve batch / }).first();
  await expect(approve).toBeVisible({ timeout: 45_000 });
  const label = (await approve.getAttribute("aria-label")) ?? "";
  await approve.click();
  await expect(page.getByRole("button", { name: label })).toHaveCount(0, { timeout: 30_000 });
  note(`${label} approved by the owner`);
});

test("7. steward: an exception is raised and listed", async ({ page, request }) => {
  await signIn(page, "steward");
  const r = await apiPost<{ id: string }>(request, "steward", "/exceptions", {
    type: "data_quality", category: "master_data", severity: "medium", title: "Acceptance walk exception",
    description: "Raised by the acceptance walk.", object_type: MODULE });
  expect(r.status).toBe(201);
  await page.goto("/work?filter=exceptions");
  await expect(page.getByRole("button", { name: /^Exceptions \d+/ })).toBeVisible({ timeout: 45_000 });
  note((await page.getByRole("button", { name: /^Exceptions \d+/ }).innerText()).replace(/\s+/g, " "));
});

test("8. owner: send an approved batch to SAP; no SAP is reachable, so Meridian hands the load file", async ({ request }) => {
  const batches = await apiGet<{ items: { id: string; status: string; created_by?: string }[] }>(request, "owner", "/remediation/batches");
  const approved = batches.items.find((b) => b.status === "approved");
  test.skip(!approved, "no approved batch to send");
  const r = await request.post(`${API}/api/v1/remediation/batches/${approved!.id}/export?format=cockpit_xlsx`,
    { headers: { Authorization: `Bearer ${await token(request, "owner")}` } });
  expect(r.status()).toBe(200);
  const body = await r.body();
  expect(body.subarray(0, 2).toString()).toBe("PK");
  const live = await apiGet<{ live_enabled: boolean }>(request, "owner", "/writeback/approvals");
  note(`load file ${body.length} bytes, sha256 ${r.headers()["x-content-sha256"]?.slice(0, 12)}; live write-back ${live.live_enabled ? "on" : "off"}`);
});

test("9. lead: the run canvas and the comparison with the run before", async ({ page, request }) => {
  const runs = await apiGet<{ runs: { id: string }[] }>(request, "lead", "/runs/timeline?limit=8");
  const latest = runs.runs[runs.runs.length - 1].id;
  await signIn(page, "lead");
  await page.goto(`/run/${latest}`);
  await expect(page.getByRole("heading", { name: "By object" })).toBeVisible({ timeout: 45_000 });
  await page.getByRole("button", { name: "Compare" }).or(page.getByRole("link", { name: "Compare" })).first().click();
  await expect(page.locator("h1").filter({ hasText: / vs / })).toBeVisible({ timeout: 30_000 });
  await expectScreen(page);
  const compared = (await page.locator("h1").first().innerText()).trim();
  const counts = (await page.getByText(/objects? scored higher/).first().innerText()).trim();
  note(`${compared}: ${counts}`);
  // the run compared with should measure the same objects as this run
  await expect(page.getByText(/0 rules that ran cleanly in both runs/), "the default comparison shares no rule with this run").toHaveCount(0);
});

test("10. lead: people and reports, one PDF generated", async ({ page }) => {
  await signIn(page, "lead");
  await page.goto("/people");
  await expect(page.getByText(/persons? holds? open work/)).toBeVisible({ timeout: 45_000 });
  await page.goto("/reports");
  await page.getByRole("button", { name: "Create a report" }).click();
  const download = page.waitForEvent("download", { timeout: 90_000 });
  await page.getByRole("button", { name: "Create the PDF report" }).click();
  const file = await download;
  note(`report downloaded: ${file.suggestedFilename()}`);
  expect(file.suggestedFilename()).toMatch(/\.pdf$/);
});

test("11. admin: roles, a policy pack applied, a webhook test, a digest preview and send-now", async ({ page, request }) => {
  await signIn(page, "admin");
  await page.goto("/admin/roles");
  await expect(page.getByText("Data steward").first()).toBeVisible({ timeout: 30_000 });
  await page.goto("/admin/policypacks");
  const apply = page.getByRole("button", { name: "Apply the pack" }).first();
  if (await apply.isVisible({ timeout: 20_000 }).catch(() => false)) {
    await apply.click();
    await expect(page.getByText(/\d of 3 packs applied/)).toBeVisible({ timeout: 30_000 });
  }
  note((await page.getByText(/\d of 3 packs applied/).innerText()).split(".")[0]);
  const list = (await apiGet<{ webhooks: { id: string }[] }>(request, "admin", "/webhooks")).webhooks;
  if (list.length) {
    const t = await apiPost<{ status: string; response_code: number }>(request, "admin", `/webhooks/${list[0].id}/test`);
    expect(t.status).toBe(200);
    note(`webhook test: ${t.body.status}, listener answered ${t.body.response_code}`);
  }
  await page.goto("/admin/digests");
  await expect(page.getByText(/\d+ digests?\./)).toBeVisible({ timeout: 30_000 });
  const d = (await apiGet<{ digests: { id: string }[] }>(request, "admin", "/digests")).digests[0];
  if (d) {
    await page.goto(`/admin/digests?open=digest:${d.id}`);
    const sent = await apiPost<{ status: string; delivered: number }>(request, "admin", `/digests/${d.id}/send-now`);
    expect(sent.status).toBe(200);
    note(`digest send-now: ${sent.body.status}, delivered ${sent.body.delivered}`);
  }
});

test("12. admin: sandbox mode entered and left from Settings", async ({ page, request }) => {
  await signIn(page, "admin");
  try {
    await page.goto("/admin/settings");
    const enter = page.getByRole("button", { name: "Enter sandbox mode" });
    await expect(enter).toBeVisible({ timeout: 45_000 });
    await enter.click();
    await page.getByRole("button", { name: "Copy the latest run and enter" }).click();
    await expect(page.getByText("Sandbox: nothing leaves this deployment.")).toBeVisible({ timeout: 45_000 });
    note((await page.getByText(/Runs copied/).locator("..").innerText()).replace(/\s+/g, " "));
    await page.getByRole("button", { name: "Exit sandbox mode" }).click();
    await page.getByRole("button", { name: "Discard the sandbox and exit" }).click();
    await expect(page.getByRole("button", { name: "Enter sandbox mode" })).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText("Sandbox: nothing leaves this deployment.")).toHaveCount(0);
  } finally {
    await apiPost(request, "admin", "/admin/sandbox/exit"); // never leave the tenant in sandbox mode
  }
});

test("13. auditor: a record's history across runs", async ({ page, request }) => {
  const recs = await apiGet<{ items: { record_key: string }[] }>(request, "auditor", `/work/records?scope=current&module=${MODULE}&check_id=${CHECK}&limit=1`);
  const key = recs.items[0].record_key;
  await signIn(page, "auditor");
  await page.goto(`/work?module=${MODULE}&open=${encodeURIComponent(`record:${MODULE}:${key}`)}`);
  const tab = page.getByRole("tab", { name: "History" });
  await expect(tab).toBeVisible({ timeout: 45_000 });
  await tab.click();
  await expect(page.locator("#rec-panel")).toBeVisible();
  note(`record ${key}: ${(await page.locator("#rec-panel").innerText()).split("\n").slice(0, 3).join(" / ")}`);
});

test("14. analyst: the command line in plain words", async ({ page }) => {
  await signIn(page, "analyst");
  await page.getByRole("button", { name: "Search or type a command" }).click();
  await page.getByRole("combobox", { name: "Search or type a command" }).fill("?critical business partner issues");
  await expect(page.getByText("The filter that will run")).toBeVisible({ timeout: 30_000 });
  note((await page.getByText(/^Records severity/).innerText()).trim());
  await page.getByRole("button", { name: "Open in Work" }).click();
  await page.waitForURL(/\/work\?/, { timeout: 30_000 });
  expect(page.url()).toContain("severity=critical");
  note(`question opened ${new URL(page.url()).pathname}${new URL(page.url()).search}`);
});

test("15. basis: the help panel, both themes, German and Japanese", async ({ page }) => {
  await signIn(page, "basis");
  // start in English whatever an earlier walk left in this user's preferences
  await chooseLanguage(page, "en");
  await page.goto("/");
  await page.getByRole("button", { name: "Help" }).click();
  await expect(page.getByLabel("Search help")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: /^The Work ledger/ }).click();
  await expect(page.getByRole("dialog")).toContainText(/Work ledger/);
  await page.keyboard.press("Escape");
  for (const theme of ["Dark", "Light"]) {
    await page.getByRole("button", { name: /^Account/ }).click();
    await page.getByRole("menuitemradio", { name: theme }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute("data-theme")), { timeout: 10_000 }).toBe(theme.toLowerCase());
  }
  for (const [lang, heading] of [["de", /^Landschaft/], ["ja", /./], ["en", /^Landscape/]] as const) {
    await chooseLanguage(page, lang);
    await page.goto("/");
    await expect(page.locator("h1").first()).toHaveText(heading, { timeout: 30_000 });
    note(`${lang}: ${(await page.locator("h1").first().innerText()).trim()}`);
  }
});

test("16. the status page reads signed out", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/status`);
  await expect(page.getByText(/Operational|Degraded|Down/).first()).toBeVisible({ timeout: 45_000 });
  note((await page.getByText(/uptime over the last 30 days/).first().innerText()).trim());
  await ctx.close();
});
