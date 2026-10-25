import { expect, RECORDED, test } from "./fixtures";

/**
 * A lead reaches a failing record by rule: objects list -> object (opens on Records to fix) -> Rules tab ->
 * rule's failing records -> record fix sheet. All on the recorded 25k-row material master run: MM045 (material
 * description is missing) is its critical rule and MAT00000010 its first failing record.
 */
test("lead reaches a failing record through the object's rules", async ({ app }) => {
  const RUN = RECORDED.materialRunId;
  const RULE = RECORDED.materialRuleId;

  await app.goto(`/objects?run=${RUN}`, { waitUntil: "load" });
  // Scoped to the grid (DataTable is role=grid): the "Most affected" stat hint also names the object.
  const objectCell = app.getByRole("grid").getByText("Material master");
  await expect(objectCell).toBeVisible();

  // Click 1: objects list -> object detail, which opens on Records to fix; then its Rules tab.
  await objectCell.click();
  await expect(app).toHaveURL(/\/objects\/material_master\?/);
  await app.getByRole("tab", { name: "Rules" }).click();
  await expect(app.getByText(RULE).first()).toBeVisible();

  // Click 2: rule row -> that rule's failing records. The whole row is the click target.
  await app.getByRole("row", { name: new RegExp(RULE) }).first().click();
  await expect(app).toHaveURL(new RegExp(`/objects/material_master\\?.*tab=records.*check_id=${RULE}`));
  const fixSheetLink = app.getByRole("link", { name: "Open record", exact: true });
  await expect(fixSheetLink.first()).toBeVisible();

  // Click 3: failing record -> record fix sheet.
  await fixSheetLink.first().click();
  await expect(app).toHaveURL(/\/objects\/material_master\/records\/.+\?run=/);
  await expect(app.getByRole("heading", { name: "Identity" })).toBeVisible();
  await expect(app.getByText("MAT00000010").first()).toBeVisible();
});
