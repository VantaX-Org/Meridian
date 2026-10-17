/**
 * Empty states for the wave-9 routes. Uses the signed-in `app` fixture; each
 * list API is then overridden with an empty body, so the page shows its spec
 * sentence rather than the recorded tenant's rows. Built-in rules ship with
 * every install, so /rules checks that its list is not blank instead.
 */

import { expect, test } from "./fixtures";

const ROUTES: ReadonlyArray<readonly [string, RegExp]> = [
  ["/systems", /^No systems yet$/],
  ["/objects", /^No objects measured yet$/],
  ["/runs", /^No runs yet$/],
  ["/search", /Search objects, records, checks and rules\./],
  ["/import", /^No imports yet$/],
  ["/migration", /No migration waves yet\. Create one to track readiness\./],
];

for (const [path, sentence] of ROUTES) {
  test(`${path} shows its fresh-install sentence`, async ({ app }) => {
    // registered after the HAR so it wins
    await app.route(/\/api\/v1\/(systems|versions|objects|migration\/waves)(\?|$|\/)/, (route) =>
      route.fulfill({ json: /\/api\/v1\/systems(\?|$)/.test(route.request().url()) ? [] : { versions: [], objects: [], waves: [], items: [] } }),
    );
    await app.goto(path, { waitUntil: "load" });
    await expect(app.getByText(sentence).first()).toBeVisible();
  });
}

test("/rules lists the shipped built-in rules", async ({ app }) => {
  await app.goto("/rules", { waitUntil: "load" });
  // the rule library is a DataTable (role=grid); the recording holds the full catalogue
  await expect(app.getByRole("grid").first()).toBeVisible();
});
