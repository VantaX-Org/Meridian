/**
 * Export smoke (addendum T14 / I8): clicking Export on /objects downloads a
 * file whose name carries the `meridian-` brand prefix used by every xlsx/csv
 * export (see api/services/branded_xlsx.py:xlsx_filename).
 */

import { expect, test } from "./fixtures";

test("Export on /objects downloads a meridian-objects- file", async ({ app }) => {
  await app.route("**/api/v1/objects/export**", (r) =>
    r.fulfill({
      status: 200,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      headers: { "content-disposition": 'attachment; filename="meridian-objects-latest-20261002-1413-SAST.xlsx"' },
      body: Buffer.from("stub workbook bytes"),
    }),
  );

  await app.goto("/objects", { waitUntil: "load" });
  // exact: the DataTable toolbar has its own "Export table" button
  await expect(app.getByRole("button", { name: "Export", exact: true })).toBeVisible();

  // Export is a menu (design/primitives/ExportMenu.tsx); the download starts from its Excel item
  await app.getByRole("button", { name: "Export", exact: true }).click();
  const [download] = await Promise.all([
    app.waitForEvent("download"),
    app.getByRole("menuitem", { name: "Newest run's objects (.xlsx)" }).click(),
  ]);

  expect(download.suggestedFilename()).toMatch(/^meridian-objects-/);
});
