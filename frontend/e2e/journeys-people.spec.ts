/**
 * People, access, reports, inbox and the invite and reset journeys, clicked end to end in fixture mode.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3731 npx playwright test e2e/journeys-people.spec.ts
 */

import { expect, test, type Page } from "@playwright/test";

const NAV = { timeout: 90_000 };

test.setTimeout(180_000);

test.beforeEach(async ({ page }) => {
  await page.context().addCookies([{ name: "mn_session", value: "1", domain: "localhost", path: "/" }]);
  await page.addInitScript(() => {
    try {
      localStorage.setItem("meridian:theme", "light");
    } catch {
      /* blocked storage: the page falls back to the system scheme */
    }
  });
  await page.route("**/api/v1/**", (route) => route.fulfill({ status: 404, contentType: "application/json", body: "{}" }));
});

const toast = (page: Page, text: string | RegExp) => expect(page.getByText(text).first()).toBeVisible(NAV);

test.describe("admin users", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/admin/users?fixture=1", NAV);
    await expect(page.getByRole("button", { name: "Invite someone" })).toBeEnabled(NAV);
  });

  test("invites a person with a role", async ({ page }) => {
    await page.getByRole("button", { name: "Invite someone" }).click();
    const sheet = page.getByRole("dialog", { name: "Invite someone" });
    await sheet.getByLabel("Email").fill("new.person@example.com");
    await sheet.getByRole("combobox", { name: "Role" }).selectOption({ index: 1 });
    await sheet.getByRole("button", { name: "Send invitation" }).click();
    await toast(page, "Invitation sent.");
  });

  test("an invited person gets a resend and an invite link to the accept page", async ({ page }) => {
    await page.getByRole("button", { name: "Ines Fernandes" }).click();
    const sheet = page.getByRole("dialog", { name: "Ines Fernandes" });
    await sheet.getByRole("button", { name: "Resend invite" }).click();
    await toast(page, "Invitation sent again.");
    await sheet.getByRole("button", { name: "Invite link" }).click();
    await toast(page, "Invite link created.");
    await expect(sheet.getByText(/\/accept-invite\?token=/)).toBeVisible(NAV);
    await expect(sheet.getByRole("button", { name: "Copy" })).toBeVisible(NAV);
  });

  test("an active person gets a reset, a manager and a grant", async ({ page }) => {
    await page.getByRole("button", { name: "Aisha Khan" }).click();
    const sheet = page.getByRole("dialog", { name: "Aisha Khan" });
    await sheet.getByRole("button", { name: "Email a reset" }).click();
    await toast(page, "Reset email sent.");
    await sheet.getByRole("combobox", { name: "Manager" }).selectOption({ label: "Pieter van der Merwe" });
    await sheet.getByRole("button", { name: "Save manager" }).click();
    await toast(page, "Manager saved.");
    await sheet.getByRole("combobox", { name: "Role" }).selectOption({ index: 1 });
    await expect(sheet.getByText(/^Adds/)).toBeVisible(NAV);
    await sheet.getByRole("button", { name: "Add grant" }).click();
    await toast(page, "Grant added.");
  });

  test("suspending asks first and can be cancelled", async ({ page }) => {
    await page.getByRole("button", { name: "Thabo Molefe" }).click();
    await page.getByRole("dialog", { name: "Thabo Molefe" }).getByRole("button", { name: "Suspend" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Confirm" })).toHaveCount(0);
  });

  test("checks a CSV before importing it", async ({ page }) => {
    await page.getByRole("button", { name: "Import CSV" }).click();
    const sheet = page.getByRole("dialog", { name: "Import users" });
    await sheet.getByLabel("CSV with email, name and role").fill("email,name,role\nann@example.com,Ann,viewer\n");
    await sheet.getByRole("button", { name: "Check file" }).click();
    await toast(page, "File checked.");
    await expect(sheet.getByText(/accepted, \d+ rejected/)).toBeVisible(NAV);
  });

  test("selecting people shows the bulk actions", async ({ page }) => {
    await page.getByRole("checkbox", { name: "Select Aisha Khan" }).check();
    await expect(page.getByRole("group", { name: "Bulk actions" })).toBeVisible(NAV);
  });
});

test.describe("reports", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/reports?fixture=1", NAV);
    await expect(page.getByRole("button", { name: "Report guide" })).toBeVisible(NAV);
  });

  test("builds a report and downloads a built file", async ({ page }) => {
    const built = page.waitForEvent("download", NAV);
    await page.getByRole("button", { name: "Build" }).first().click();
    await built;
    await toast(page, "Report built.");
    await page.getByRole("button", { name: "Download" }).first().click();
    const saved = page.waitForEvent("download", NAV);
    await page.getByRole("button", { name: "Export", exact: true }).click();
    expect((await saved).suggestedFilename()).not.toBe("");
  });

  test("runs, adds and edits a schedule", async ({ page }) => {
    await page.getByRole("button", { name: "Run now" }).first().click();
    await toast(page, "Queued to run now.");
    await page.getByLabel("Name").first().fill("Weekly steward pack");
    await page.getByRole("button", { name: "Add schedule" }).click();
    await toast(page, "Schedule added.");
    await page.getByRole("button", { name: "Edit" }).first().click();
    const sheet = page.getByRole("dialog", { name: "Edit schedule" });
    await sheet.getByLabel("Time").fill("07:30");
    await sheet.getByRole("button", { name: "Save schedule" }).click();
    await toast(page, "Schedule saved.");
  });

  test("queues an export and says where it lands", async ({ page }) => {
    await page.getByRole("button", { name: "Start export" }).click();
    await toast(page, "Export queued. The file appears under Built files when it is ready.");
  });

  test("the report guide opens", async ({ page }) => {
    await page.getByRole("button", { name: "Report guide" }).click();
    await expect(page.getByRole("dialog")).toBeVisible(NAV);
  });
});

test.describe("me and the inbox", () => {
  test("each sheet on me opens and a test notification sends", async ({ page }) => {
    await page.goto("/me?fixture=1", NAV);
    await page.getByRole("button", { name: "Send a test" }).click();
    await toast(page, "Test notification sent.");
    for (const name of ["Licence", "Version", "Help", "Notification settings"]) {
      await page.getByRole("button", { name, exact: true }).click();
      const sheet = page.getByRole("dialog");
      await expect(sheet).toBeVisible(NAV);
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
    }
    await page.getByRole("link", { name: "Inbox" }).click();
    await expect(page).toHaveURL(/\/me\/notifications/, NAV);
  });

  test("marks one item read, then all", async ({ page }) => {
    await page.goto("/me/notifications?fixture=1", NAV);
    const one = page.getByRole("button", { name: "Mark read" });
    await expect(one.first()).toBeVisible(NAV);
    const before = await one.count();
    expect(before).toBeGreaterThan(0);
    await one.first().click();
    await expect(one).toHaveCount(before - 1, NAV);
    await page.getByRole("button", { name: "Mark all read" }).click();
    await expect(one).toHaveCount(0, NAV);
    await expect(page.getByRole("button", { name: "Mark all read" })).toBeDisabled();
  });
});

test.describe("people", () => {
  test("the invite, balance and delegation sheets work", async ({ page }) => {
    await page.goto("/people?fixture=1", NAV);
    await page.getByRole("button", { name: "Invite a person" }).click();
    let sheet = page.getByRole("dialog");
    await sheet.getByLabel("Email").fill("new.steward@example.com");
    await sheet.getByRole("button", { name: "Send invitation" }).click();
    await toast(page, "Invitation sent to new.steward@example.com");
    await page.getByRole("button", { name: "Balance the work" }).click();
    sheet = page.getByRole("dialog");
    await sheet.getByRole("button", { name: "Plan the moves" }).click();
    await expect(sheet.getByRole("button", { name: /^Apply \d+ moves$/ }).or(sheet.getByText("Already balanced"))).toBeVisible(NAV);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Delegations" }).click();
    sheet = page.getByRole("dialog");
    await expect(sheet.getByRole("button", { name: "Add delegation" })).toBeDisabled();
    await sheet.getByLabel("From").fill("2026-12-01");
    await sheet.getByLabel("Until").fill("2026-12-10");
    await expect(sheet.getByRole("button", { name: "Add delegation" })).toBeEnabled();
  });
});

test.describe("invite and reset links", () => {
  test("forgot password confirms without saying whether the account exists", async ({ page }) => {
    await page.route("**/api/v1/auth/forgot-password", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }));
    await page.goto("/forgot-password", NAV);
    await page.getByRole("button", { name: "Send link" }).click();
    await expect(page.getByText("Enter the email you sign in with")).toBeVisible(NAV);
    await page.getByLabel("Work email").fill("ann@example.com");
    await page.getByRole("button", { name: "Send link" }).click();
    await expect(page.getByText("Check your email")).toBeVisible(NAV);
  });

  test("accepting an invite whose sign-in is refused lands on sign-in with the email filled in", async ({ page }) => {
    await page.route("**/api/v1/auth/invite/preview", (r) => r.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ email: "ann@example.com", grants: [{ role_key: "viewer", role_label: "Viewer", system_name: null, module: null }] }) }));
    await page.route("**/api/v1/auth/accept-invite", (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true,"email":"ann@example.com"}' }));
    await page.goto("/accept-invite?token=demo-u-7", NAV);
    await expect(page.getByText("Invited as ann@example.com")).toBeVisible(NAV);
    await expect(page.getByText("Viewer, all systems, all objects")).toBeVisible(NAV);
    await page.getByLabel("New password").fill("a-long-password");
    await page.getByLabel("Confirm password").fill("a-long-password");
    await page.getByRole("button", { name: "Accept" }).click();
    await expect(page).toHaveURL(/\/sign-in\?invited=1&email=ann%40example\.com/, NAV);
    await expect(page.getByText("Password set. Sign in to finish joining.")).toBeVisible(NAV);
    await expect(page.getByLabel("Work email")).toHaveValue("ann@example.com");
  });

  test("a dead invitation shows no form", async ({ page }) => {
    await page.route("**/api/v1/auth/invite/preview", (r) => r.fulfill({ status: 400, contentType: "application/json", body: '{"detail":"expired"}' }));
    await page.goto("/accept-invite?token=old", NAV);
    await expect(page.getByText("This invitation link is invalid or has expired.")).toBeVisible(NAV);
    await expect(page.getByRole("button", { name: "Accept" })).toHaveCount(0);
  });
});
