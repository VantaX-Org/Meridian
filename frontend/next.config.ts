import type { NextConfig } from "next";

type Redirect = { source: string; destination: string; permanent: true; has?: { type: "query"; key: string; value?: string }[] };

/** A permanent redirect. Next carries the query of the old address along, so run, module and the rest ride with it. */
const r = (source: string, destination: string): Redirect => ({ source, destination, permanent: true });
/** A permanent redirect taken only when the old address carries `key` (and `value`, a regex that may name groups). */
const q = (source: string, key: string, value: string | undefined, destination: string): Redirect => ({
  source,
  destination,
  permanent: true,
  has: [{ type: "query", key, ...(value === undefined ? {} : { value }) }],
});

/**
 * Every address of the old interfaces (the first one, the /v2 tree, /next and /n), sent to the place that does the same
 * job in the one interface at the root. The table of old and new is frontend/docs/guide/redirects.md, and
 * __tests__/legacy-redirects.test.ts asserts that every route the old interface served lands here or on a live page.
 *
 * `/o/_/{module}` names an object without its system; the object canvas replaces `_` with the system that holds it.
 * Rules with `has` come before the plain rule for the same address, because the first rule that matches wins.
 */
export const REDIRECTS: Redirect[] = [
  // A rule here wins over a real page at the same address, so a row must never match a live route.
  // Meridian 2 lived under /v2 while both interfaces shipped. Kept for a release so bookmarks and share links still open.
  r("/v2", "/"),
  r("/v2/:path*", "/:path*"),

  // Home pages, per persona, and pages that were a way to get somewhere: the landscape is the start for every role.
  r("/home", "/"),
  r("/home/:persona", "/"),
  r("/dashboard", "/"),
  r("/insights/exec", "/"),
  r("/design", "/"),
  r("/search", "/"),
  r("/features", "/?open=help"),
  r("/help", "/?open=help"),
  r("/docs", "/?open=help"),
  r("/me/preferences", "/?open=preferences"),
  r("/command-centre", "/runs"),

  // Fix work, cleaning and remediation: the Work ledger with the same filter.
  q("/fix", "batch", "(?<batch>[^&]+)", "/work?batch=:batch"),
  q("/fix", "tab", "batches", "/work?filter=approvals"),
  q("/fix", "tab", "monitor", "/runs"),
  q("/fix", "tab", "cleaning", "/work?filter=proposed"),
  q("/fix", "check_id", "(?<check>[^&]+)", "/work?rule=:check"),
  q("/fix", "check", "(?<check>[^&]+)", "/work?rule=:check"),
  q("/fix", "mine", "1", "/work?assigned=me"),
  q("/fix", "sugg", "1", "/work?filter=proposed"),
  q("/fix", "action", "export", "/work?export=1"),
  r("/fix", "/work"),
  r("/fix/what-if", "/work"),
  r("/fix/proposals/:runId", "/work?filter=proposed"),
  r("/fix/:id", "/work?filter=proposed"),
  r("/cleaning", "/work?filter=proposed"),
  r("/remediation", "/work?filter=approvals"),

  // The inbox, approvals and exceptions: the inbox panel, or the ledger's chip for the same rows.
  q("/inbox", "kind", "approvals", "/work?filter=approvals"),
  q("/inbox", "kind", "exception", "/work?filter=exceptions"),
  q("/inbox", "kind", "issues", "/work?assigned=me"),
  q("/inbox", "due", "(?<due>[^&]+)", "/work?due=:due"),
  r("/inbox", "/work?open=inbox"),
  r("/inbox/notifications", "/work?open=inbox"),
  r("/notifications", "/work?open=inbox"),
  q("/workbench", "batch", "(?<batch>[^&]+)", "/work?batch=:batch"),
  q("/workbench", "tab", "batches", "/work?filter=approvals"),
  r("/workbench", "/work?open=inbox"),
  r("/workbench/triage", "/work?open=triage"),
  r("/workbench/progress", "/people"),
  r("/workbench/report", "/reports"),
  r("/workbench/record/:issueId", "/work"),
  r("/stewardship", "/people"),
  r("/stewardship/metrics", "/people"),
  r("/exceptions", "/work?filter=exceptions"),
  r("/exceptions/rules", "/work?filter=exceptions"),
  r("/exceptions/:id", "/work?filter=exceptions"),

  // Objects: the object canvas and its tabs.
  q("/objects/:object", "tab", "history", "/o/_/:object/trend"),
  q("/objects/:object", "tab", "(?:rules|records)", "/o/_/:object/rules"),
  q("/objects/:object", "check_id", "(?<check>[^&]+)", "/o/_/:object/rules?open=rule%3A:check"),
  q("/objects/:object", "rule", "(?<check>[^&]+)", "/o/_/:object/rules?open=rule%3A:check"),
  q("/objects/:object", "tab", "fix", "/o/_/:object/records"),
  r("/objects/:object", "/o/_/:object"),
  r("/objects/:object/records/:key", "/work?module=:object&open=record%3A:object%3A:key"),
  r("/objects/:object/rules/:ruleId", "/r/:ruleId"),
  r("/analyse", "/"),
  r("/analyse/coverage", "/"),
  r("/analyse/finding/:id", "/"),
  r("/analyse/object/:module", "/o/_/:module"),
  r("/analyse/material/:matnr", "/work?module=material_master"),
  r("/analyse/rule/:checkId", "/r/:checkId"),
  q("/findings", "version_id", "(?<run>[^&]+)", "/run/:run"),
  r("/findings", "/runs"),

  // Insights: each view is a tab of an object, the rules library, the runs or People.
  q("/insights/readiness", "module", "(?<module>[^&]+)", "/o/_/:module/readiness"),
  r("/insights/readiness", "/?view=waves"),
  q("/insights/process/designer", "module", "(?<module>[^&]+)", "/o/_/:module/processes/design"),
  r("/insights/process/designer", "/"),
  q("/insights/process", "module", "(?<module>[^&]+)", "/o/_/:module/processes"),
  r("/insights/process", "/"),
  q("/insights/lineage", "module", "(?<module>[^&]+)", "/o/_/:module/lineage"),
  r("/insights/lineage", "/"),
  q("/insights/impact", "module", "(?<module>[^&]+)", "/o/_/:module"),
  r("/insights/impact", "/"),
  q("/insights/rules", "module", "(?<module>[^&]+)", "/o/_/:module/rules"),
  r("/insights/rules", "/rules"),
  q("/insights/duplicates", "module", "(?<module>[^&]+)", "/o/_/:module/golden"),
  r("/insights/duplicates", "/"),
  r("/insights/mining", "/rules?view=drafts"),
  r("/insights/owners", "/people"),
  r("/insights/reports", "/reports"),
  r("/insights/trends", "/runs"),
  r("/insights/progress", "/runs"),
  r("/insights/operations", "/runs"),
  r("/executive-report", "/reports"),
  r("/analytics", "/runs"),
  r("/config-impact", "/"),
  r("/business-process", "/"),
  r("/lineage", "/"),
  r("/relationships", "/"),
  r("/dedup", "/"),

  // Processes: the Processes tab of an object, and its designer.
  r("/process", "/"),
  r("/process/designer", "/"),
  r("/process/runs", "/runs?view=jobs"),
  r("/process/runs/:runId", "/runs?view=jobs"),
  r("/process/:l1", "/"),

  // Master data: the Glossary and Golden records tabs of an object; one term or golden record opens in the inspector.
  r("/mdm/glossary/:id", "/?open=term%3A:id"),
  q("/mdm/golden/merge", "id", "(?<id>[^&]+)", "/?open=golden%3A:id"),
  r("/mdm/golden/merge", "/"),
  q("/mdm/golden", "object", "(?<object>[^&]+)", "/o/_/:object/golden"),
  r("/glossary", "/"),
  r("/glossary/:id", "/?open=term%3A:id"),
  r("/golden-records", "/"),
  r("/golden-records/:id", "/?open=golden%3A:id"),
  r("/golden-records/:id/merge", "/?open=golden%3A:id"),
  r("/match-rules", "/"),
  r("/match-rules/constraints", "/"),
  r("/match-rules/tuning", "/"),

  // Load: its tabs took the addresses of the pages that used to sit at the top level.
  r("/system-compare", "/load/compare"),
  r("/migration/load-plan", "/load/plan"),
  r("/s4", "/load/s4"),
  r("/go-live", "/load/go-live"),

  // Migration: the landscape's Waves view and the waves panel (gates, sign-off, certificate).
  r("/migration", "/load/runs"),
  r("/migration/dry-run", "/?view=waves&open=waves"),
  r("/migration/:waveId", "/?view=waves&open=waves"),

  // Rules: the rule canvas, the library and its drafts, contracts in People, scoring in Administration.
  r("/rules/contracts", "/people?open=contracts"),
  r("/rules/dictionary", "/rules"),
  r("/rules/drafts", "/rules?view=drafts"),
  r("/rules/learned", "/rules?view=drafts"),
  r("/rules/scoring", "/admin/settings"),
  r("/rules/:ruleId((?!dry-run$|promotion$)[\\w.-]+)", "/r/:ruleId"),
  r("/contracts", "/people?open=contracts"),
  r("/settings/scoring", "/admin/settings"),
  r("/settings/rules", "/rules"),
  r("/ai/rules", "/rules?view=drafts"),

  // Runs: one run, and two runs compared.
  r("/runs/:a/vs/:b", "/run/:a/vs/:b"),
  r("/runs/:versionId", "/run/:versionId"),
  r("/versions", "/runs"),
  r("/data/runs/:id", "/run/:id"),

  // Systems: each system's canvas; connecting a new one; extracting from the landscape's system inspector.
  q("/systems", "connect", undefined, "/s/new"),
  q("/systems", "extract", "(?<system>[^&]+)", "/?open=system%3A:system"),
  r("/systems", "/"),
  r("/systems/:id/extractions/:runId", "/s/:id?tab=extractions"),
  r("/systems/:id/versions/:versionId/profile", "/run/:versionId"),
  r("/systems/:id/pilot", "/s/:id"),
  r("/systems/:id", "/s/:id"),
  r("/connectivity", "/"),
  r("/run-sync", "/"),
  r("/data", "/"),
  r("/sync", "/"),

  // Data in: uploading a file is a block of Administration, Runs and jobs.
  r("/import", "/runs?view=jobs"),
  r("/upload", "/runs?view=jobs"),

// Cut-over: the /n and /next trees became the root, and the old top-level pages took a place in the new map.
  r("/n", "/"),
  r("/n/:path*", "/:path*"),
  r("/next/o/:system/:module/:tab*", "/o/:system/:module/:tab*"),
  r("/next", "/"),
  r("/next/:path*", "/:path*"),
  r("/portfolio", "/o?view=portfolio"),
  r("/attention", "/work"),
  r("/objects", "/o"),
  r("/more/:slug*", "/admin"),
  r("/cleansing", "/work?filter=proposed"),
  r("/aletheia/:path*", "/?aletheia=1"),
  r("/aletheia", "/?aletheia=1"),
  r("/aletheia-survivorship", "/mdm/survivorship"),
  r("/fix-drafts", "/rules?view=fix-drafts"),
  r("/anomaly-rules", "/monitor?view=shifts"),
  r("/atlas", "/s"),
  r("/config", "/s"),
  r("/entry-gate", "/monitor?view=gate"),
  r("/monitors", "/monitor?view=learned"),
  r("/issues", "/mdm/issues"),
  r("/links", "/mdm/links"),
  r("/catalogue", "/mdm/catalogue"),
  r("/mining", "/mdm/mining"),
  r("/reference-data", "/mdm/reference"),
  r("/processes", "/mdm/processes"),
  r("/materials", "/o"),
  r("/score", "/insights/score"),
  r("/forecast", "/insights/forecast"),
  r("/value", "/insights/value"),
  r("/rule-dry-run", "/rules/dry-run"),
  r("/rule-promotion", "/rules/promotion"),
  r("/data-requests", "/work/requests"),
  r("/work/monitor", "/monitor?view=after-clean"),
  r("/admin/matchrules", "/mdm/match-rules"),
  r("/admin/workflows", "/requests/workflows"),
  r("/admin/runschedules", "/admin/schedules"),
  r("/admin/step10", "/rules?view=packs"),
  r("/admin/thresholds", "/admin/scoring"),
  r("/admin/accuracy", "/rules?view=coverage"),
  r("/admin/kit", "/admin"),
  r("/admin/capabilities", "/admin/access"),
  r("/admin/tenant", "/admin/settings"),
  r("/admin/sandbox", "/admin/system"),
  r("/admin/maintenance", "/admin/enterprise"),
  r("/admin/runs", "/runs?view=jobs"),

  // Administration: the same sections at /admin/{section}; the few that moved or were renamed.
  q("/admin/roles", "tab", "keys", "/admin/apikeys"),
  r("/admin/jobs", "/admin/system"),
  r("/admin/sign-in", "/admin/signin"),
  r("/admin/triage", "/work?open=triage"),
  r("/admin/ai", "/admin/settings"),
  r("/settings/field-mapping", "/admin/mappings"),
  r("/settings/ai", "/admin/settings"),
  r("/settings/licence", "/admin/licence"),
  r("/settings/exception-billing", "/admin/billing"),
  r("/settings", "/admin/settings"),
];

const nextConfig: NextConfig = {
  output: "standalone",
  // Next would otherwise write AGENTS.md/CLAUDE.md into frontend/ on every dev start.
  agentRules: false,

  async redirects() {
    return REDIRECTS;
  },

  async rewrites() {
    // INTERNAL_API_URL is a server-side-only env var.
    // In Docker: resolves to http://api:8000 via Docker DNS.
    // On host dev (npm run dev): set INTERNAL_API_URL=http://localhost:8000.
    // Default to Docker service DNS so production image builds don't accidentally
    // bake localhost (which would point to the frontend container itself).
    const apiUrl = process.env.INTERNAL_API_URL || "http://api:8000";

    return [
      {
        // Proxy all /api/* requests to the FastAPI backend
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
      {
        // Proxy the health endpoint (useful for monitoring)
        source: "/health",
        destination: `${apiUrl}/health`,
      },
      {
        // LLM reachability probe used by the insight header
        source: "/health/llm",
        destination: `${apiUrl}/health/llm`,
      },
    ];
  },
};

export default nextConfig;
