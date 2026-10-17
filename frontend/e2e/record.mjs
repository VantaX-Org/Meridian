// Re-record e2e/fixtures/api.har.gz: the API traffic behind every route in
// routes.json, from a running Meridian with seeded (never customer) data.
//
//   E2E_TOKEN=<bearer token> E2E_BASE=http://localhost:3001 node e2e/record.mjs
//
// Then set RECORDED_AT in fixtures.ts to the time printed and refresh the
// visual baselines (npm run e2e:update).
//
// routes.json may mark a route `"mocked": true` (its data exists only in the
// spec mocks, e.g. a wave or batch the seeded tenant does not hold; the route
// is not visited) or list `"knownBad": [url prefixes]` for API calls on that
// route that fail on the seeded stack today. Each knownBad entry is a defect
// that has been reported; the recorder prints them but does not fail on them,
// so the rest of the recording stays usable. Anything else at 400+ fails.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { chromium } from "playwright";

const base = process.env.E2E_BASE ?? "http://localhost:3000";
const token = process.env.E2E_TOKEN;
if (!token) throw new Error("E2E_TOKEN (a bearer token for the seeded tenant) is required");
const here = path.dirname(new URL(import.meta.url).pathname);
// stored gzipped: the rule library alone is ten pages of a thousand rules
const out = path.join(here, "fixtures", "api.har.gz");
const raw = path.join(here, "fixtures", "api.har.recording.tmp");
const routes = JSON.parse(fs.readFileSync(path.join(here, "routes.json"), "utf8"));

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordHar: { path: raw, urlFilter: /\/api\/v1\//, mode: "minimal" },
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
const known = [];
let current = null;
page.on("response", (r) => {
  if (!r.url().includes("/api/") || r.status() < 400) return;
  const path = r.url().replace(base, "");
  // the extraction page asks for its download job and expects it to be gone once the run is done
  if (r.status() === 404 && /\/api\/v1\/jobs\/dl-/.test(path)) return;
  if (current?.knownBad?.some((prefix) => path.startsWith(prefix))) { known.push(`${r.status()} ${path} (${current.name})`); return; }
  problems.push(`${r.status()} ${r.url()}`);
});
const startedAt = new Date().toISOString();
for (const r of routes) {
  if (r.mocked) { console.log(r.name, "-> skipped (mocked)"); continue; }
  current = r;
  await page.goto(`${base}${r.path}`, { waitUntil: "load" });
  // heavy routes (a 25k-record object, the rule library) take well over 4 s to finish their
  // calls; leaving early records them as aborted and the replay has nothing to answer with
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2000);
  console.log(r.name, "->", page.url());
}
await ctx.close();
await browser.close();

// the token travelled in request headers; the replay needs neither headers nor cookies.
// URLs are stored against localhost:3000; fixtures.ts rewrites them to the suite's origin.
const har = JSON.parse(fs.readFileSync(raw, "utf8").replaceAll(`${base}/`, "http://localhost:3000/"));
fs.rmSync(raw);
for (const e of har.log.entries) {
  e.request.headers = [];
  e.request.cookies = [];
  e.response.cookies = [];
  e.response.headers = e.response.headers.filter((h) => h.name.toLowerCase() === "content-type");
}
// The shell asks for the same dozen endpoints on every route, so most entries repeat an
// identical response; keep one copy of each (method, url, body, response). A request the
// recorder navigated away from (status -1) is dropped, and is a problem when nothing else
// answered that url.
// A 5xx for a url that also answered 2xx in this same pass is the stack's proxy dropping a
// connection under load (ECONNRESET), not the page's behaviour: dropped, so the replay never
// picks it over the real answer, and the problem list is cleared of it.
const answered = new Set(har.log.entries.filter((e) => e.response.status > 0).map((e) => e.request.url));
const ok = new Set(har.log.entries.filter((e) => e.response.status >= 200 && e.response.status < 300).map((e) => e.request.url));
const transient = new Set();
const seen = new Set();
har.log.entries = har.log.entries.filter((e) => {
  if (e.response.status <= 0) {
    if (!answered.has(e.request.url)) problems.push(`no completed response recorded for ${e.request.url}`);
    return false;
  }
  if (e.response.status >= 500 && ok.has(e.request.url)) {
    transient.add(`${e.response.status} ${e.request.url}`);
    return false;
  }
  const key = [e.request.method, e.request.url, e.request.postData?.text ?? "", e.response.status, e.response.content?.text ?? ""].join("\n");
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});
fs.writeFileSync(out, zlib.gzipSync(JSON.stringify(har), { level: 9 }));
console.log(`recorded ${har.log.entries.length} responses at ${startedAt} → ${out}`);
if (transient.size) {
  console.warn("transient failures (the same url answered 2xx in this pass), dropped:", [...transient]);
  for (const t of transient) for (let i = problems.length - 1; i >= 0; i--) if (problems[i] === t) problems.splice(i, 1);
}
if (known.length) console.warn("known defects (routes.json knownBad):", [...new Set(known)]);
if (problems.length) {
  console.error("problems during recording:", problems);
  process.exit(1);
}
