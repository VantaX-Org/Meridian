/**
 * Sign-in error states (addendum T6): validation, wrong credentials, rate
 * limit and an unreachable server, each mocked directly against
 * /api/v1/auth/login so no backend or recorded HAR is needed.
 */

import { expect, test } from "@playwright/test";

async function fillAndSubmit(page: import("@playwright/test").Page, email: string, password: string) {
  await page.getByLabel("Work email").fill(email);
  if (password) await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
}

test("empty submit shows per-field validation and no network call", async ({ page }) => {
  let called = false;
  await page.route("**/api/v1/auth/login", (r) => { called = true; return r.continue(); });
  await page.goto("/sign-in", { waitUntil: "load" });
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByText("Enter your work email")).toBeVisible();
  await expect(page.getByText("Enter your password")).toBeVisible();
  expect(called).toBe(false);
});

test("401 shows a wrong-credentials message", async ({ page }) => {
  await page.route("**/api/v1/auth/login", (r) =>
    r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ detail: "Incorrect email or password" }) }));
  await page.goto("/sign-in", { waitUntil: "load" });
  await fillAndSubmit(page, "steward@example.com", "wrong-password");
  await expect(page.getByRole("alert")).toContainText("Email or password is wrong.");
});

test("429 shows a rate-limit message and keeps the button enabled", async ({ page }) => {
  await page.route("**/api/v1/auth/login", (r) =>
    r.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ detail: "Too many requests" }) }));
  await page.goto("/sign-in", { waitUntil: "load" });
  await fillAndSubmit(page, "steward@example.com", "correct-password");
  await expect(page.getByRole("alert")).toContainText("Too many attempts. Wait a minute and try again.");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeEnabled();
});

test("a network error shows the server-unreachable message", async ({ page }) => {
  await page.route("**/api/v1/auth/login", (r) => r.abort("connectionrefused"));
  await page.goto("/sign-in", { waitUntil: "load" });
  await fillAndSubmit(page, "steward@example.com", "correct-password");
  await expect(page.getByRole("alert")).toContainText("Meridian could not be reached. Check that the server is running.");
});
