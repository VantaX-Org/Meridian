/**
 * Aurora performance budget — navigation start to `load` plus the hub heading
 * on screen, per workspace route, against the production build the Playwright
 * web server runs in CI (`next build && next start`). The API is replayed from
 * the recording, so the figure is the frontend's own cost. Budgets are CI
 * ceilings (cold runner, one worker), not the spec's 500 ms P95 target.
 */

import { expect, ROUTES, test } from "./fixtures";

const BUDGET_MS: Record<string, number> = {
  "command-centre": 2500,
  "executive-report": 2500,
  runs: 2500,
  workbench: 2500,
  process: 3000,
  admin: 2500,
};

for (const r of ROUTES) {
  const budget = BUDGET_MS[r.name] ?? 2500;
  test(`perf — ${r.name} settles under ${budget} ms`, async ({ app }) => {
    const started = Date.now();
    await app.goto(r.path, { waitUntil: "load" });
    await expect(app.getByRole("heading", { level: 1, name: r.heading })).toBeVisible();
    const elapsed = Date.now() - started;
    console.log(`[perf] ${r.name}: ${elapsed} ms (budget ${budget} ms)`);
    expect(elapsed).toBeLessThanOrEqual(budget);
  });
}
