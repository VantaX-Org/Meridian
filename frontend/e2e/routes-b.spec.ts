/**
 * Wave-10 smoke: the retired routes land where their work moved, and the dev design gallery renders, with the
 * signed-in (admin) `app` fixture.
 */
import { expect, test, ROUTES } from "./fixtures";

/** The page a URL shows: its path and query, as the address bar has it. */
const here = (url: string) => { const u = new URL(url); return u.pathname + u.search; };

// /insights (the overview that repeated Home) opens the viewer's home; Inbox › Issues opens Fix work on the viewer's
// own records. Each is a routes.json entry with `redirectsTo`.
for (const r of ROUTES.filter((x) => x.redirectsTo)) {
  test(`${r.path} redirects to ${r.redirectsTo}`, async ({ app }) => {
    await app.goto(r.path, { waitUntil: "load" });
    await expect.poll(() => here(app.url()), { timeout: 30_000 }).toBe(r.redirectsTo);
    await expect(app.getByRole("heading", { level: 1, name: r.heading }).first()).toBeAttached();
  });
}

test("an old /insights?run= link opens that run", async ({ app }) => {
  await app.goto("/insights?run=v1", { waitUntil: "load" });
  await expect.poll(() => here(app.url()), { timeout: 30_000 }).toBe("/runs/v1");
});

test("/fix?tab=dedup opens Match review, where duplicate pairs are reviewed", async ({ app }) => {
  await app.goto("/fix?tab=dedup", { waitUntil: "load" });
  await expect.poll(() => new URL(app.url()).pathname, { timeout: 30_000 }).toBe("/mdm/golden/merge");
});

test("Fix work has no Duplicates tab, and its batches tab points approvals at Inbox › Approvals", async ({ app }) => {
  await app.goto("/fix?tab=batches", { waitUntil: "load" });
  await expect(app.getByRole("tab", { name: "Batches and export" })).toBeVisible({ timeout: 30_000 });
  await expect(app.getByRole("tab", { name: "Duplicates" })).toHaveCount(0);
  await expect(app.getByRole("link", { name: "Open approvals" })).toHaveAttribute("href", "/inbox?kind=approvals");
});

test("Inbox › Approvals lists fix batches beside the SAP write-backs", async ({ app }) => {
  await app.goto("/inbox?kind=approvals", { waitUntil: "load" });
  const main = app.getByRole("main");
  await expect(main.getByText("Fix batches", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(main.getByText("SAP write-backs", { exact: true })).toBeVisible();
  // Tasks, Approvals and SAP monitor: exceptions are a view of Tasks, and Issues moved to Fix work.
  await expect(main.getByRole("tab", { name: "Issues" })).toHaveCount(0);
  await expect(main.getByRole("tab", { name: "Exceptions" })).toHaveCount(0);
});

test("/design shows notices in both themes", async ({ app }) => {
  await app.goto("/design", { waitUntil: "load" });
  await expect(app.getByText("Danger notice.").first()).toBeVisible();
});
