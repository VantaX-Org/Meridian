import { describe, expect, it } from "vitest";
import { authCause, groupAuthErrors, type AuthSighting } from "../screens/BasisHome";
import { proveThree } from "../screens/Run";
import { noteProved, provedRules } from "@/lib/api/v2/object";
import type { RuleRow } from "@/lib/api/v2/types";

const sight = (o: Partial<AuthSighting>): AuthSighting => ({ systemId: "ecc", where: "ECC production", what: "x", at: null, cause: "authorisation", source: { label: "Connection test", href: "/s/ecc" }, ...o });

describe("Basis authorisation errors", () => {
  it("tells a refused sign-in from a missing authorisation", () => {
    expect(authCause("RFC_LOGON_FAILURE: password logon no longer possible")).toBe("credentials");
    expect(authCause("No authorization for table T001 (S_TABU_DIS)")).toBe("authorisation");
  });

  it("draws one row per system and cause, both sources named, the newest answer leading", () => {
    const rows = groupAuthErrors([
      sight({ what: "old", at: "2026-10-01T00:00:00Z" }),
      sight({ what: "new", at: "2026-10-02T00:00:00Z", source: { label: "Extraction job", href: "?open=job:1" } }),
      sight({ cause: "credentials" }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.what).toBe("new");
    expect(rows[0]!.sources.map((s) => s.label)).toEqual(["Connection test", "Extraction job"]);
  });
});

describe("prove three rules", () => {
  const rule = (check_id: string, check_class: string, affected_count: number): RuleRow => ({ check_id, name: check_id, field: null, severity: "high", affected_count, total_count: 100, pass_rate: null, value_at_risk: null, check_class });
  it("proposes the most failing completeness, value-list and join rule, skipping passing rules", () => {
    const picks = proveThree([rule("N1", "null_check", 5), rule("N2", "null_check", 9), rule("V1", "referential_check", 3), rule("J1", "exists_check", 0), rule("J2", "cross_field_check", 2)]);
    expect(picks.map((p) => p.rule.check_id)).toEqual(["N2", "V1", "J2"]);
  });

  it("remembers the rules opened under Prove in SAP per run, once each, in order", () => {
    noteProved("run-1", "MM014");
    noteProved("run-1", "MM142");
    noteProved("run-1", "MM014");
    expect(provedRules("run-1")).toEqual(["MM014", "MM142"]);
    expect(provedRules("run-2")).toEqual([]);
  });
});
