// Process discovery wiring: who to ask for discovery, and no dead client for the removed mining runs endpoint.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import * as mining from "../api/mining";
import { GRANTED_BY, askToRun, grantingRolesLabel, whoGrants } from "../who-grants";
import { primaryTooltip } from "../../components/gated-primary";

const FRONTEND = join(__dirname, "..", "..");

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, out);
    else if (/\.tsx?$/.test(name) && !p.includes("__tests__")) out.push(p);
  }
  return out;
}

describe("who grants run_process_discovery", () => {
  it("names the programme lead, data steward and SAP Basis, in one sentence", () => {
    expect(GRANTED_BY.run_process_discovery).toEqual(["programme_lead", "data_steward", "sap_basis"]);
    expect(whoGrants("run_process_discovery")).toBe("programme lead, data steward or SAP Basis");
    expect(askToRun("run_process_discovery", "run discovery")).toBe("Ask a programme lead, data steward or SAP Basis to run discovery.");
    expect(grantingRolesLabel("run_process_discovery")).toBe("Programme lead, data steward or SAP Basis");
  });

  it("is what the discovery primary's tooltip names", () => {
    expect(primaryTooltip("discover", "KSA PRD")).toBe("Needs Programme lead, data steward or SAP Basis on KSA PRD — Request access");
  });

  it("is written in one place: no page spells the role list or the old process-analyst sentence", () => {
    const offenders = sources(join(FRONTEND, "app")).concat(sources(join(FRONTEND, "components")))
      .filter((p) => /programme lead, data steward or SAP Basis|Ask a process analyst/.test(readFileSync(p, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("mining client", () => {
  it("has no wrapper for the non-existent /api/v1/mining/runs, and nothing imports one", () => {
    expect("getMiningRuns" in mining).toBe(false);
    const all = ["app", "components", "lib", "hooks", "design"].flatMap((d) => sources(join(FRONTEND, d)));
    expect(all.filter((p) => /getMiningRuns|MiningRunsResponse|\/api\/v1\/mining\/runs/.test(readFileSync(p, "utf8")))).toEqual([]);
  });
});
