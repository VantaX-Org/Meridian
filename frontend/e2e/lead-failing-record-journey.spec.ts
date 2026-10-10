import { expect, test } from "./fixtures";

/** A lead reaches a failing record in three clicks: objects list -> object rules tab -> rule's failing records -> record fix sheet. */
test("lead reaches a failing record in three clicks", async ({ app }) => {
  const VERSION_ID = "65988d5a-0243-4f9b-bdff-52779e71c6ed";

  await app.goto(`/objects?run=${VERSION_ID}`, { waitUntil: "load" });
  await expect(app.getByText("Material master")).toBeVisible();

  // Click 1: objects list -> object detail, rules tab.
  await app.getByText("Material master").click();
  await expect(app).toHaveURL(/\/objects\/material_master\?run=/);
  await expect(app.getByText("MM551")).toBeVisible();

  // Click 2: rule row -> that rule's failing records. The whole row is the click target.
  await app.getByRole("row", { name: /MM551/ }).click();
  await expect(app).toHaveURL(/\/objects\/material_master\?.*tab=records.*check_id=MM551/);
  const fixSheetLink = app.getByRole("link", { name: /open fix sheet/i });
  await expect(fixSheetLink).toBeVisible();

  // Click 3: failing record -> record fix sheet.
  await fixSheetLink.click();
  await expect(app).toHaveURL(/\/objects\/material_master\/records\/.+\?run=/);
  await expect(app.getByRole("heading", { name: "Identity" })).toBeVisible();
  await expect(app.getByText("Hydraulic pump seal kit 50mm")).toBeVisible();
});
