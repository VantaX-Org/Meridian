import { expect, json, RECORDED, test } from "./fixtures";

/**
 * A no-go readiness cell drills into the object's failing rows: insights readiness -> object detail.
 * The seeded tenant has no readiness waves, so the readiness grid is mocked here with one no-go
 * cell on the recorded material master run; the drill lands on that run's recorded object page.
 */
test("clicking a no-go readiness cell drills into the failing rows", async ({ app }) => {
  const RUN = RECORDED.materialRunId;
  await app.route(/\/api\/v1\/insights\/readiness(\?.*)?$/, (r) => r.fulfill(json({
    version_id: RUN, threshold: 90, configured: true, waves: ["wave_1"],
    cells: [{ module: "material_master", wave: "wave_1", verdict: "no_go", blocker_count: 1, dqs: 70, score: 40, records_blocked: 658 }],
  })));

  await app.goto(`/insights/readiness?run=${RUN}`, { waitUntil: "load" });
  const cell = app.getByText("No-go", { exact: true }).first();
  await expect(cell).toBeVisible();
  await cell.click();
  await expect(app).toHaveURL(/\/objects\//);
  await expect(app.getByRole("grid")).toBeVisible();
});
