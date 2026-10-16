/**
 * Steward accepts a proposal and sees the batch (spec section 13).
 *
 * `/fix` and `/fix/[batchId]` render no page heading (ExplorerPage has no
 * title prop — confirmed by reading design/templates/ExplorerPage.tsx and
 * app/(app)/fix/page.tsx), so this asserts on the real table/button content
 * instead of a "Fix batches" heading. The recorded queue (500 detected items)
 * carries no batch, so the list is replaced with the fixture's batch item here.
 */

import { CLEANING_ITEM, expect, json, test } from "./fixtures";

test("steward accepts a proposal and sees the batch", async ({ app }) => {
  await app.route(/\/api\/v1\/cleaning\/queue\?(?!.*batch_id=)/, (r) =>
    r.fulfill(json({ items: [CLEANING_ITEM], total: 1, page: 1, per_page: 100 })));
  await app.goto("/fix", { waitUntil: "load" });

  // app/(app)/fix/page.tsx: the Batch column cell wraps batch_id in <Mono>.
  await app.getByText("B1").click();
  await expect(app).toHaveURL(/\/fix\/B1/);

  // app/(app)/fix/[batchId]/page.tsx: per-row "Approve" button, fires approveCleaning.
  await app.getByRole("button", { name: "Approve" }).first().click();

  // onSuccess: toast("Approved") (sonner, mounted once by design/shell/Toaster.tsx); the row's
  // status pill reads "Approved" too, so look in the toaster region.
  await expect(app.getByRole("region", { name: /^Notifications/ }).getByText("Approved")).toBeVisible();
});
