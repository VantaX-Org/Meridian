/**
 * Steward accepts a proposal and sees the batch (spec section 13).
 *
 * Proposals are records with a suggested value in Fix work (/fix?sugg=1); a group of one run's proposals is a drill page
 * (fixtures.ts mockFixBatch: run "B1", field LFA1.NAME1), which this opens directly.
 */

import { expect, test } from "./fixtures";

test("steward accepts a proposal and sees the batch", async ({ app }) => {
  await app.goto("/fix/proposals/B1?kind=LFA1.NAME1", { waitUntil: "load" });
  await expect(app).toHaveURL(/\/fix\/proposals\/B1\?kind=LFA1\.NAME1/);

  // app/(app)/fix/[batchId]/page.tsx: per-row "Approve" button, fires approveCleaning.
  await app.getByRole("button", { name: "Approve", exact: true }).first().click();

  // onSuccess: toast("Approved") (sonner, mounted once by design/shell/Toaster.tsx); the row's
  // status pill reads "Approved" too, so look in the toaster region.
  await expect(app.getByRole("region", { name: /^Notifications/ }).getByText("Approved")).toBeVisible();
});
