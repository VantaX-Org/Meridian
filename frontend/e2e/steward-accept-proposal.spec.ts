/**
 * Steward accepts a proposal and sees the batch (spec section 13).
 *
 * `/fix` and `/fix/[batchId]` render no page heading (ExplorerPage has no
 * title prop — confirmed by reading design/templates/ExplorerPage.tsx and
 * app/(app)/fix/page.tsx), so this asserts on the real table/button content
 * instead of a "Fix batches" heading.
 */

import { expect, test } from "./fixtures";

test("steward accepts a proposal and sees the batch", async ({ app }) => {
  await app.goto("/fix", { waitUntil: "load" });

  // app/(app)/fix/page.tsx: the Batch column cell wraps batch_id in <Mono>.
  await app.getByText("B1").click();
  await expect(app).toHaveURL(/\/fix\/B1/);

  // app/(app)/fix/[batchId]/page.tsx: per-row "Approve" button, fires approveCleaning.
  await app.getByRole("button", { name: "Approve" }).first().click();

  // onSuccess: toastManager.add({ title: "Approved" }) (design/primitives/Toast.tsx renders <BaseToast.Title />).
  await expect(app.getByText("Approved")).toBeVisible();
});
