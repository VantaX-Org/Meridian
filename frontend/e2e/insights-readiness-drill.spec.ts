import { expect, test } from "./fixtures";

/** A no_go readiness cell drills into the object's failing rows: insights readiness -> object detail. */
test("clicking a no-go readiness cell drills into the failing rows", async ({ app }) => {
  const VERSION_ID = "65988d5a-0243-4f9b-bdff-52779e71c6ed";

  await app.goto(`/insights/readiness?run=${VERSION_ID}`, { waitUntil: "load" });
  const cell = app.getByText("no_go").first();
  await expect(cell).toBeVisible();
  await cell.click();
  await expect(app).toHaveURL(/\/objects\//);
  await expect(app.getByRole("table")).toBeVisible();
});
