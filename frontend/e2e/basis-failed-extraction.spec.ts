/**
 * Basis opens a failed extraction and reads the error line (spec section 13).
 *
 * Deviation from the brief: in the real markup (app/(app)/systems/[systemId]/page.tsx),
 * the Runs tab's row — both the "Run" cell's <Link> and the table's onRowClick — navigates
 * to `/runs/${versionId}`, never to `/systems/:id/extractions/:runId`. Nothing in the app
 * links to the extractions page today (grepped for "extractions/" across app/ and design/ —
 * only the page itself and its own Vitest test reference that path). So this journey is
 * split into what the real UI supports (seeing the failed run on the system page) and a
 * direct navigation to the extraction page (the only way to reach it), rather than a
 * click-through the brief's example assumed.
 */

import { expect, test } from "./fixtures";

test("basis opens a failed extraction and reads the error line", async ({ app }) => {
  await app.goto("/systems/s1", { waitUntil: "load" });

  // design/primitives/Tabs.tsx renders BaseTabs.Tab, which exposes role="tab".
  await app.getByRole("tab", { name: "Runs" }).click();

  // runColumns()'s Status cell renders <Pill>{labelOf(status)}</Pill> — "Failed" for status "failed".
  // Both tab panels stay mounted (Base UI Tabs), and the Overview tab also shows the latest
  // run's status, so scope to the Runs tabpanel to disambiguate.
  await expect(app.getByRole("tabpanel", { name: "Runs" }).getByText("Failed")).toBeVisible();

  // No in-app link reaches /systems/:id/extractions/:runId (see module doc above) — go there directly.
  await app.goto("/systems/s1/extractions/r1", { waitUntil: "load" });

  // app/(app)/systems/[systemId]/extractions/[runId]/page.tsx: the failed step's role="alert" line.
  // Next also renders its own (empty) route-announcer with role="alert", so filter by text.
  await expect(
    app.getByRole("alert").filter({ hasText: "RFC_COMMUNICATION_FAILURE" }),
  ).toContainText("RFC_COMMUNICATION_FAILURE: connection reset");
});
