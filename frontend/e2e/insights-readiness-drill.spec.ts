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

/**
 * Without ?run=, Waves describes the current state (each object at its own latest run), Home's scope: its S/4
 * blockers are Home's S/4 card's (the recorded /findings/s4-readiness?scope=current: 27 blocking), and with no wave it
 * gives each object Home's go-live verdict instead of saying no object gets one. No previous run is compared.
 */
test("Waves opens on the current state, with Home's blockers and verdicts", async ({ app }) => {
  await app.goto("/insights/readiness", { waitUntil: "load" });
  await expect(app.getByTestId("insight-scope")).toHaveAttribute("data-scope", "current");
  await expect(app.getByText("27 rules would block an S/4 load, and no wave is set up yet")).toBeVisible();
  await expect(app.getByTestId("s4-strip")).toContainText("Blockers27");
  await expect(app.getByText(/objects? (is|are) not ready for go-live.*; no wave groups them for loading yet/)).toBeVisible();
  await expect(app.getByText("The previous run could not be read")).toHaveCount(0);
  await expect(app.getByText(/no object gets a go or no-go/)).toHaveCount(0);
  await expect(app.getByText("No blockers in this run")).toHaveCount(0);
});
