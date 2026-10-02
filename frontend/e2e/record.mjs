// Re-record e2e/fixtures/api.har: the API traffic behind every route in
// routes.json, from a running Meridian with seeded (never customer) data.
//
//   E2E_TOKEN=<bearer token> E2E_BASE=http://localhost:3001 node e2e/record.mjs
//
// Then set RECORDED_AT in fixtures.ts to the time printed and refresh the
// visual baselines (npm run e2e:update).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const base = process.env.E2E_BASE ?? "http://localhost:3000";
const token = process.env.E2E_TOKEN;
if (!token) throw new Error("E2E_TOKEN (a bearer token for the seeded tenant) is required");
const here = path.dirname(new URL(import.meta.url).pathname);
const out = path.join(here, "fixtures", "api.har");
const routes = JSON.parse(fs.readFileSync(path.join(here, "routes.json"), "utf8"));

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordHar: { path: out, urlFilter: /\/api\/v1\//, mode: "minimal" },
});
await ctx.addCookies([{ name: "mn_session", value: "1", domain: new URL(base).hostname, path: "/" }]);
await ctx.addInitScript((t) => {
  localStorage.setItem("mn_auth_token", t);
  sessionStorage.setItem("mn_landed", "1");
}, token);
const page = await ctx.newPage();
await page.route("**/api/v1/jobs/events", (r) => r.fulfill({ status: 204 })); // never ends
const problems = [];
page.on("pageerror", (e) => problems.push(e.message));
page.on("response", (r) => { if (r.url().includes("/api/") && r.status() >= 400) problems.push(`${r.status()} ${r.url()}`); });
const startedAt = new Date().toISOString();
for (const r of routes) {
  await page.goto(`${base}${r.path}`, { waitUntil: "load" });
  await page.waitForTimeout(4000);
  console.log(r.name, "->", page.url());
}
await ctx.close();
await browser.close();

// the token travelled in request headers; the replay needs neither headers nor cookies.
// URLs are stored against localhost:3000; fixtures.ts rewrites them to the suite's origin.
const har = JSON.parse(fs.readFileSync(out, "utf8").replaceAll(`${base}/`, "http://localhost:3000/"));
for (const e of har.log.entries) {
  e.request.headers = [];
  e.request.cookies = [];
  e.response.cookies = [];
  e.response.headers = e.response.headers.filter((h) => h.name.toLowerCase() === "content-type");
}
fs.writeFileSync(out, JSON.stringify(har));
console.log(`recorded ${har.log.entries.length} responses at ${startedAt} → ${out}`);
if (problems.length) {
  console.error("problems during recording:", problems);
  process.exit(1);
}
