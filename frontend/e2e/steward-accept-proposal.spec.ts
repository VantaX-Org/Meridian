/**
 * Steward accepts a proposal and sees the batch (spec section 13).
 *
 * The cleaning proposals tab (Fix opens on Records to fix) groups open proposals by the run that found them and what they fix
 * (fixtures.ts mockFixBatch: run "B1", field LFA1.NAME1); a row opens that run's review page.
 */

import { expect, test } from "./fixtures";

test("steward accepts a proposal and sees the batch", async ({ app }) => {
  await app.goto("/fix?tab=cleaning", { waitUntil: "load" });

  // app/(app)/fix/page.tsx: one row per run and kind, with a Review link to the run's page.
  await app.getByRole("link", { name: "Review Fix LFA1.NAME1 from business_partner_100k" }).click();
  await expect(app).toHaveURL(/\/fix\/B1\?kind=LFA1\.NAME1/);

  // app/(app)/fix/[batchId]/page.tsx: per-row "Approve" button, fires approveCleaning.
  await app.getByRole("button", { name: "Approve", exact: true }).first().click();

  // onSuccess: toast("Approved") (sonner, mounted once by design/shell/Toaster.tsx); the row's
  // status pill reads "Approved" too, so look in the toaster region.
  await expect(app.getByRole("region", { name: /^Notifications/ }).getByText("Approved")).toBeVisible();
});
