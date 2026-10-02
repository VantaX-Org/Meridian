/**
 * Signed-in Aurora page with the API replayed from a recording.
 *
 * `e2e/fixtures/api.har` holds the API responses the routes in `routes.json`
 * made against the simulation stack (seeded tenant, no customer data).
 * Replaying it means the specs need no backend: the dev server serves the
 * pages, the HAR answers `/api/v1/*`, and the clock is pinned to the
 * recording time so relative durations and "last 24 h" figures are stable.
 *
 * Re-record after changing which endpoints a route calls:
 *   npm run e2e:record   (see e2e/record.mjs)
 */

import fs from "node:fs";
import path from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import routes from "./routes.json";

export const HAR = path.join(__dirname, "fixtures", "api.har");
/** The instant the HAR was recorded; Date.now() in the page returns this. */
export const RECORDED_AT = new Date("2026-10-02T06:56:00Z");
export const ROUTES: ReadonlyArray<{ name: string; path: string; heading: string }> = routes;

/** The recording is stored against http://localhost:3000; replay it on whatever origin the suite runs. */
function harFor(origin: string): string {
  const out = path.join(__dirname, "..", "test-results", `api.${origin.replace(/\W+/g, "_")}.har`);
  if (!fs.existsSync(out)) {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, fs.readFileSync(HAR, "utf8").replaceAll("http://localhost:3000/", `${origin}/`));
  }
  return out;
}

export const test = base.extend<{ app: Page }>({
  app: async ({ page, context, baseURL }, provide) => {
    const origin = new URL(baseURL ?? "http://localhost:3000").origin;
    await context.addCookies([{ name: "mn_session", value: "1", domain: new URL(origin).hostname, path: "/" }]);
    await page.addInitScript(() => {
      localStorage.setItem("mn_auth_token", "e2e-recorded-session");
      sessionStorage.setItem("mn_landed", "1");
    });
    await page.clock.install({ time: RECORDED_AT });
    await page.routeFromHAR(harFor(origin), { url: /\/api\/v1\//, notFound: "abort" });
    // registered last so it wins: the job stream never ends and is not in the
    // recording; the 15 s poll covers the rail
    await page.route("**/api/v1/jobs/events", (r) => r.fulfill({ status: 204 }));
    await provide(page);
  },
});

export { expect };
