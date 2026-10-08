import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Next would otherwise write AGENTS.md/CLAUDE.md into frontend/ on every dev start.
  agentRules: false,

  async redirects() {
    // The steward inbox (Workbench → Steward inbox) replaced the team workload and metrics pages.
    return [
      { source: "/stewardship", destination: "/inbox", permanent: false },
      { source: "/stewardship/metrics", destination: "/inbox", permanent: false },
      { source: "/workbench", destination: "/inbox", permanent: false },
      { source: "/workbench/triage", destination: "/inbox", permanent: false },
      { source: "/workbench/progress", destination: "/inbox", permanent: false },
      { source: "/workbench/report", destination: "/inbox", permanent: false },
      { source: "/workbench/record/:issueId", destination: "/inbox", permanent: false },
      { source: "/exceptions", destination: "/inbox?kind=exception", permanent: false },
      { source: "/exceptions/rules", destination: "/inbox?kind=exception", permanent: false },
      { source: "/home", destination: "/home/lead", permanent: false },
      { source: "/findings", destination: "/objects", permanent: false },
      { source: "/versions", destination: "/runs", permanent: false },
      { source: "/analyse/object/:module", destination: "/objects/:module", permanent: false },
      {
        source: "/analyse/material/:matnr",
        destination: "/objects/material_master/records/:matnr",
        permanent: false,
      },
      { source: "/command-centre", destination: "/?tab=live", permanent: false },
      { source: "/executive-report", destination: "/insights/exec", permanent: false },
      { source: "/connectivity", destination: "/data", permanent: false },
      { source: "/run-sync", destination: "/data", permanent: false },
      { source: "/migration", destination: "/data?tab=migration", permanent: false },
      { source: "/analytics", destination: "/insights/forecast", permanent: false },
      { source: "/systems/:id/pilot", destination: "/systems/:id?tab=pilot", permanent: false },
      {
        source: "/systems/:id/versions/:versionId/profile",
        destination: "/data/runs/:versionId?tab=profile",
        permanent: false,
      },
      { source: "/glossary", destination: "/mdm/glossary", permanent: false },
      { source: "/glossary/:id", destination: "/mdm/glossary/:id", permanent: false },
      { source: "/golden-records", destination: "/mdm/golden", permanent: false },
      { source: "/golden-records/:id", destination: "/mdm/golden/:id", permanent: false },
      { source: "/golden-records/:id/merge", destination: "/mdm/golden/merge", permanent: false },
      { source: "/match-rules", destination: "/mdm/match-rules", permanent: false },
      { source: "/match-rules/constraints", destination: "/mdm/match-rules", permanent: false },
      { source: "/match-rules/tuning", destination: "/mdm/match-rules", permanent: false },
      { source: "/business-process", destination: "/insights/process", permanent: false },
      { source: "/process", destination: "/insights/process", permanent: false },
      { source: "/process/designer", destination: "/insights/process/designer", permanent: false },
      { source: "/lineage", destination: "/insights/lineage", permanent: false },
      { source: "/mining", destination: "/insights/mining", permanent: false },
      { source: "/relationships", destination: "/insights/mining", permanent: false },
    ];
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
    ];
  },
};

export default nextConfig;
