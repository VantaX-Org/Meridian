import { expect, RECORDED, test } from "./fixtures";

/**
 * An object page only ever shows a run that measured the object. Without ?run= it opens the object's own latest
 * run; a ?run= of another object's run (here the 100k business partner run) is a not-in-this-run state with a way
 * back to the object's latest run, never "Could not reach the server".
 */
test("object page without ?run= opens the object's own latest run", async ({ app }) => {
  await app.goto("/objects/material_master", { waitUntil: "load" });
  await expect(app.getByTestId("run-scope")).toContainText("Material master", { timeout: 20_000 });
  await expect(app.getByText(/could not reach the server/i)).toHaveCount(0);
  await expect(app.getByText(/is not in this run/i)).toHaveCount(0);
});

test("object page with another object's ?run= says not in this run and links to the latest run", async ({ app }) => {
  // The recording has no material master read against the business partner run; the API answers that with a 404.
  await app.route(new RegExp(`/api/v1/objects/material_master.*${RECORDED.businessPartnerRunId}`), (r) =>
    r.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: "Object not found for this run" }) }));
  await app.goto(`/objects/material_master?run=${RECORDED.businessPartnerRunId}`, { waitUntil: "load" });
  await expect(app.getByText("Material master is not in this run")).toBeVisible({ timeout: 20_000 });
  await expect(app.getByText(/could not reach the server/i)).toHaveCount(0);
  const back = app.getByRole("link", { name: "Show latest run of Material master" });
  await expect(back).toHaveAttribute("href", "/objects/material_master");
  await back.click();
  await expect(app).toHaveURL(/\/objects\/material_master$/);
  await expect(app.getByTestId("run-scope")).toBeVisible({ timeout: 20_000 });
});
