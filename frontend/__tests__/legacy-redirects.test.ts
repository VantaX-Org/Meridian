// frontend/__tests__/legacy-redirects.test.ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

/**
 * Every route the old interface served under app/(app), listed from git before the cut-over deleted it
 * (`git ls-tree -r --name-only HEAD 'frontend/app/(app)' | grep page.tsx`). Each one must still open something: a
 * permanent redirect in next.config.ts, or a live page at the same address (Administration kept its addresses).
 */
const OLD_ROUTES = [
  "/admin/alerts", "/admin/audit", "/admin/billing", "/admin/jobs", "/admin/licence", "/admin/mappings",
  "/admin/notifications", "/admin/reference", "/admin/roles", "/admin/settings", "/admin/sign-in", "/admin/triage",
  "/admin/users", "/attention", "/design", "/docs", "/features", "/fix", "/fix/proposals/[runId]", "/fix/what-if",
  "/help", "/home", "/home/basis", "/home/lead", "/home/process", "/home/steward", "/import", "/inbox",
  "/inbox/notifications", "/insights", "/insights/duplicates", "/insights/exec", "/insights/forecast",
  "/insights/impact", "/insights/lineage", "/insights/mining", "/insights/owners", "/insights/process",
  "/insights/process/designer", "/insights/progress", "/insights/readiness", "/insights/reports", "/insights/rules",
  "/insights/trends", "/mdm", "/mdm/glossary", "/mdm/glossary/[id]", "/mdm/golden", "/mdm/golden/[id]",
  "/mdm/golden/merge", "/mdm/match-rules", "/mdm/survivorship", "/me/preferences", "/migration",
  "/migration/[waveId]", "/migration/dry-run", "/objects", "/objects/[object]", "/objects/[object]/records/[key]",
  "/objects/[object]/rules/[ruleId]", "/process", "/process/[l1]", "/process/runs", "/process/runs/[runId]", "/rules",
  "/rules/[ruleId]", "/rules/contracts", "/rules/dictionary", "/rules/drafts", "/rules/learned", "/rules/scoring",
  "/runs", "/runs/[versionId]", "/runs/[versionId]/vs/[b]", "/search", "/systems", "/systems/[systemId]",
  "/systems/[systemId]/extractions/[runId]",
] as const;

/** A sample value for each dynamic segment, so `/runs/[versionId]` is tested as `/runs/R1`. */
const concrete = (route: string): string => route.replace(/\[([^\]]+)\]/g, (_, name: string) => `${name.toUpperCase()}1`);

/** The pages the app serves now: every page.tsx under app/, route groups dropped, `[x]` as one segment. */
function livePatterns(): RegExp[] {
  const root = path.resolve(__dirname, "../app");
  const out: RegExp[] = [];
  const walk = (dir: string, parts: string[]) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) {
        if (e.name.startsWith("_") || e.name === "__tests__" || e.name === "api") continue;
        walk(path.join(dir, e.name), /^\(.*\)$/.test(e.name) ? parts : [...parts, e.name]);
      } else if (e.name === "page.tsx") {
        const segs = parts.map((p) => (/^\[\[?\.\.\./.test(p) ? "(?:/.*)?" : /^\[.*\]$/.test(p) ? "/[^/]+" : `/${p}`));
        out.push(new RegExp(`^${segs.join("") || "/"}$`));
      }
    }
  };
  walk(root, []);
  return out;
}

/** Next's source syntax (`:name`, `:name*`) as a regex over a path. */
function sourcePattern(source: string): RegExp {
  const body = source.replace(/\/:(\w+)\*/g, "(?:/.*)?").replace(/:(\w+)/g, "[^/]+");
  return new RegExp(`^${body}$`);
}

/** Where a plain (query-free) request for `pathname` lands: the first unconditional rule's destination, or null. */
async function land(pathname: string): Promise<string | null> {
  const rules = await nextConfig.redirects!();
  for (const rule of rules) {
    if (rule.has?.length) continue;
    const m = sourcePattern(rule.source).exec(pathname);
    if (!m) continue;
    const names = [...rule.source.matchAll(/:(\w+)/g)].map((x) => x[1]);
    const values = pathname.split("/").filter(Boolean);
    const srcParts = rule.source.split("/").filter(Boolean);
    const params: Record<string, string> = {};
    srcParts.forEach((p, i) => {
      if (p.startsWith(":")) params[p.slice(1).replace(/\*$/, "")] = p.endsWith("*") ? values.slice(i).join("/") : values[i];
    });
    let dest = rule.destination;
    for (const n of names) dest = dest.replaceAll(`:${n}*`, params[n] ?? "").replaceAll(`:${n}`, params[n] ?? "");
    return dest;
  }
  return null;
}

describe("the cut-over redirects", () => {
  const live = livePatterns();
  const isLive = (p: string) => live.some((re) => re.test(p.split("?")[0].split("#")[0]));

  it("knows the pages the app serves", () => {
    for (const p of ["/", "/work", "/runs", "/people", "/reports", "/rules", "/admin", "/admin/users", "/o/a/b", "/o/a/b/rules", "/r/MM142", "/run/R1", "/run/R1/vs/R2", "/s/new", "/s/S1", "/share/T1", "/status", "/sign-in"]) {
      expect(isLive(p), p).toBe(true);
    }
    expect(isLive("/fix")).toBe(false);
    expect(isLive("/home")).toBe(false);
  });

  it.each(OLD_ROUTES.map((r) => [r]))("%s still opens something", async (route) => {
    const url = concrete(route);
    const target = await land(url);
    if (target === null) {
      // Not redirected: the same address must be a live page of the new tree.
      expect(isLive(url), `${route} has neither a redirect nor a live page`).toBe(true);
    } else {
      expect(target, `${route} redirects to itself`).not.toBe(url);
      expect(isLive(target), `${route} redirects to ${target}, which is not a page`).toBe(true);
    }
  });

  it("every redirect is permanent and lands on a live page", async () => {
    const rules = await nextConfig.redirects!();
    for (const rule of rules) {
      expect(rule.permanent, rule.source).toBe(true);
      if (rule.source === "/v2/:path*") continue; // the whole tree, checked by the /v2 case below
      const sample = rule.destination.replace(/:(\w+)\*/g, "x").replace(/:(\w+)/g, "X1");
      expect(isLive(sample), `${rule.source} -> ${rule.destination}`).toBe(true);
    }
  });

  it("keeps every /v2 address for a release, with its path and query", async () => {
    expect(await land("/v2")).toBe("/");
    expect(await land("/v2/work")).toBe("/work");
    expect(await land("/v2/o/ecc-production/material-master/rules")).toBe("/o/ecc-production/material-master/rules");
    expect(await land("/v2/status")).toBe("/status");
  });

  it("sends the old pages to the job's new place", async () => {
    const cases: Record<string, string> = {
      "/home/steward": "/",
      "/fix": "/work",
      "/inbox": "/work?open=inbox",
      "/objects/material_master": "/o/_/material_master",
      "/objects/material_master/rules/MM142": "/r/MM142",
      "/objects/material_master/records/MATNR=100": "/work?module=material_master&open=record%3Amaterial_master%3AMATNR=100",
      "/insights/readiness": "/?view=waves",
      "/insights/owners": "/people",
      "/rules/MM142": "/r/MM142",
      "/rules/drafts": "/rules?view=drafts",
      "/rules/contracts": "/people?open=contracts",
      "/runs/R1": "/run/R1",
      "/runs/R1/vs/R2": "/run/R1/vs/R2",
      "/systems/S1": "/s/S1",
      "/admin/jobs": "/admin/system",
      "/admin/sign-in": "/admin/signin",
      "/help": "/?open=help",
      "/me/preferences": "/?open=preferences",
      "/import": "/admin/runs",
      "/migration/W1": "/?view=waves&open=waves",
      "/mdm/golden/G1": "/?open=golden%3AG1",
    };
    for (const [from, to] of Object.entries(cases)) expect(await land(from), from).toBe(to);
  });

  it("carries the filter of an old address into the ledger", async () => {
    const rules = await nextConfig.redirects!();
    const when = (source: string, key: string) => rules.find((r) => r.source === source && r.has?.some((h) => h.key === key));
    expect(when("/fix", "check")?.destination).toBe("/work?rule=:check");
    expect(when("/fix", "mine")?.destination).toBe("/work?assigned=me");
    expect(when("/fix", "batch")?.destination).toBe("/work?batch=:batch");
    expect(when("/inbox", "kind")?.destination).toBe("/work?filter=approvals");
    expect(when("/insights/readiness", "module")?.destination).toBe("/o/_/:module/readiness");
    expect(when("/objects/:object", "tab")?.destination).toBe("/o/_/:object/runs");
    // A conditional rule comes before the plain rule for the same address: the first match wins.
    for (const [i, rule] of rules.entries()) {
      if (!rule.has) continue;
      const plain = rules.findIndex((x) => x.source === rule.source && !x.has);
      if (plain >= 0) expect(plain, rule.source).toBeGreaterThan(i);
    }
  });
});
