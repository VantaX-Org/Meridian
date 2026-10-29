/**
 * The To do list end to end (plan section 3): what a lead sees, what a steward scoped to one object sees, and the
 * empty state. The list is the server's, already ranked and filtered by scope, so each case hands the mock the items
 * the API would return for that viewer (fixtures/mocks-monitoring.ts); the spec checks that the Rail badge, the
 * page, the filters, the object card and the empty state say what that list says.
 */

import type { Page } from "@playwright/test";
import { expect, RECORDED, test } from "./fixtures";
import { LEAD_ITEMS, mockAttention } from "./fixtures/mocks-monitoring";
import { personaPermissionsPayload, type PersonaRole } from "./fixtures/persona-permissions";

const STEWARD_OBJECT = "material_master";
const REGRESSION = LEAD_ITEMS.find((i) => i.kind === "regression")!;

/** Sign in as a persona, optionally scoped by a grant to one system and object (what /me/permissions returns for it). */
async function signInAs(page: Page, role: PersonaRole, scope?: { system_id: string; module: string }) {
  const payload = { ...personaPermissionsPayload(role), ...(scope ? { scopes: [scope] } : {}) };
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

const rows = (page: Page) => page.getByRole("main").getByRole("row");

test.describe("lead", () => {
  test("sees the ranked items on the page and the number on the Rail flag", async ({ app }) => {
    await app.goto("/attention", { waitUntil: "load" });

    await expect(app.getByRole("main").getByText("4 items in your scope, 2 critical or high, as of", { exact: false })).toBeVisible({ timeout: 20_000 });
    // worst first: blocked work, then the regression, then freshness, then admin
    const titles = await app.getByRole("main").locator("td span.flex-col > span.font-medium").allTextContents();
    expect(titles).toEqual(LEAD_ITEMS.map((i) => i.title));

    // the flag counts the critical and high items (one critical, one high), and says so in words
    const badge = app.getByTestId("attention-badge");
    await expect(badge).toHaveText("2");
    await expect(app.getByRole("link", { name: "To do" })).toHaveAccessibleName("To do, 2 critical or high to-do items");
  });

  test("every row offers its one action, which opens its fix", async ({ app }) => {
    await app.goto("/attention", { waitUntil: "load" });
    const action = app.getByRole("link", { name: `Review records: ${REGRESSION.title}` });
    await expect(action).toBeVisible({ timeout: 20_000 });
    await expect(action).toHaveAttribute("href", REGRESSION.href);
    await expect(app.getByRole("link", { name: `Open system: ${RECORDED.systemName} cannot connect` })).toHaveAttribute("href", `/systems/${RECORDED.systemId}`);
    await expect(app.getByRole("link", { name: /^Review invitations:/ })).toHaveAttribute("href", "/admin/users?status=invite_expired");
  });

  test("a priority filter keeps one tier and is part of the address", async ({ app }) => {
    await app.goto("/attention", { waitUntil: "load" });
    await expect(app.getByRole("main").getByText(REGRESSION.title)).toBeVisible({ timeout: 20_000 });

    await app.getByRole("button", { name: "Data regressions" }).click();
    await expect(app).toHaveURL(/tier=2/);
    await expect(app.getByRole("main").getByText(REGRESSION.title)).toBeVisible();
    await expect(app.getByRole("main").getByText(`${RECORDED.systemName} cannot connect`)).toHaveCount(0);

    await app.getByRole("button", { name: "All", exact: true }).first().click();
    await expect(app.getByRole("main").getByText(`${RECORDED.systemName} cannot connect`)).toBeVisible();
  });

  test("an object page lists only that object's items", async ({ app }) => {
    await app.goto(`/objects/${STEWARD_OBJECT}`, { waitUntil: "load" });
    const card = app.getByTestId("attention-card");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByTestId("attention-row")).toHaveCount(1);
    await expect(card).toContainText(REGRESSION.title);
    await expect(app.getByRole("link", { name: "All 1 to-do items" })).toHaveAttribute("href", `/attention?object=${STEWARD_OBJECT}`);
  });

  test("the home page card links to the full list", async ({ app }) => {
    await app.goto("/home/lead", { waitUntil: "load" });
    const card = app.getByTestId("attention-card");
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByTestId("attention-row")).toHaveCount(4);
    await expect(app.getByRole("link", { name: "All 4 to-do items" })).toHaveAttribute("href", "/attention");
  });
});

test.describe("steward scoped to one object", () => {
  test.beforeEach(async ({ app }) => {
    await signInAs(app, "data_steward", { system_id: RECORDED.systemId, module: STEWARD_OBJECT });
    // the API has already dropped the connection, the other object and the admin chores for this viewer
    await mockAttention(app, [REGRESSION]);
  });

  test("sees only the items of their object, and the flag counts only those", async ({ app }) => {
    await app.goto("/attention", { waitUntil: "load" });
    await expect(app.getByRole("main").getByText("1 item in your scope", { exact: false })).toBeVisible({ timeout: 20_000 });
    await expect(app.getByRole("main").getByText(REGRESSION.title)).toBeVisible();
    for (const hidden of [`${RECORDED.systemName} cannot connect`, "Business partner has not been checked", "invitations are older"]) {
      await expect(app.getByRole("main").getByText(hidden, { exact: false })).toHaveCount(0);
    }
    await expect(app.getByTestId("attention-badge")).toHaveText("1");
  });

  test("the object filter narrows the list and says which object", async ({ app }) => {
    await app.goto(`/attention?object=${STEWARD_OBJECT}`, { waitUntil: "load" });
    await expect(app.getByRole("main").getByText(REGRESSION.title)).toBeVisible({ timeout: 20_000 });
    await expect(app.getByRole("main").getByText("Material master", { exact: true }).first()).toBeVisible();
    await expect(app.getByRole("button", { name: "Show all objects" })).toBeVisible();
  });
});

test.describe("empty list", () => {
  test("says nothing is waiting and names the viewer's scope, with no badge", async ({ app }) => {
    await signInAs(app, "data_steward", { system_id: RECORDED.systemId, module: STEWARD_OBJECT });
    await mockAttention(app, []);
    await app.goto("/attention", { waitUntil: "load" });

    await expect(app.getByText("Nothing in your scope needs a person now")).toBeVisible({ timeout: 20_000 });
    await expect(app.getByText(`Your scope is Material master on ${RECORDED.systemName}.`, { exact: false })).toBeVisible();
    await expect(app.getByRole("link", { name: "Open objects" })).toHaveAttribute("href", "/objects");
    await expect(app.getByTestId("attention-badge")).toHaveCount(0);
    await expect(rows(app)).toHaveCount(0);
  });

  test("an unscoped viewer is told their scope is every system and object", async ({ app }) => {
    await mockAttention(app, []);
    await app.goto("/attention", { waitUntil: "load" });
    await expect(app.getByText("Nothing in your scope needs a person now")).toBeVisible({ timeout: 20_000 });
    await expect(app.getByText("Your scope is every system and object.", { exact: false })).toBeVisible();
    await expect(app.getByTestId("attention-badge")).toHaveCount(0);
  });
});
