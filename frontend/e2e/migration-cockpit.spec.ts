import { expect, test } from "./fixtures";

/** Migration lead journey: wave list -> wave cockpit -> blockers tab. */
test("a wave opens its cockpit and lists its blockers", async ({ app }) => {
  await app.goto("/migration", { waitUntil: "load" });
  const row = app.getByRole("row").nth(1);
  await expect(row).toBeVisible();
  await row.click();
  await expect(app).toHaveURL(/\/migration\/[^/]+$/);
  await expect(app.getByRole("tab", { name: "Objects" })).toBeVisible();
  await app.getByRole("tab", { name: "Blockers" }).click();
  await expect(app).toHaveURL(/tab=blockers/);
});
