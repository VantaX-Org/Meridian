/**
 * Wave-10 smoke: insights hub and the dev design gallery render with the
 * signed-in `app` fixture. Not run in this wave.
 */
import { expect, test } from "./fixtures";

test("/insights renders its heading or fresh-install sentence", async ({ app }) => {
  await app.goto("/insights", { waitUntil: "load" });
  await expect(app.getByRole("link", { name: /readiness/i }).or(app.getByText(/No insights yet\./)).first()).toBeVisible();
});

test("/design shows notices in both themes", async ({ app }) => {
  await app.goto("/design", { waitUntil: "load" });
  await expect(app.getByText("Danger notice.").first()).toBeVisible();
});
