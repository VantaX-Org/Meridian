// frontend/lib/__tests__/format-copy.test.ts
// Copy helpers behind the Insights fixes: agreed plurals, money with its code, system and module display names,
// run-axis ticks that never show a user-supplied label, and the delta and trend sentences.
import { describe, expect, it } from "vitest";
import {
  capRuleIds, deltaSentence, formatModuleName, formatMoney, formatMoneyCompact, MODULE_LABELS, passRatePct, plural, runAxisLabels, runOptionLabels, shortCapReason, shortList,
  systemTypeLabel, trendSentence, zoneName,
} from "../format";

describe("plural", () => {
  it("agrees the noun with the count and formats thousands", () => {
    expect(plural(1, "record")).toBe("1 record");
    expect(plural(2310, "record")).toBe("2,310 records");
    expect(plural(0, "wave")).toBe("0 waves");
  });
  it("takes an irregular or phrasal plural", () => {
    expect(plural(1, "blocking field fails", "blocking fields fail")).toBe("1 blocking field fails");
    expect(plural(3, "stage is", "stages are")).toBe("3 stages are");
  });
});

describe("shortList", () => {
  it("names the first two and counts the rest", () => {
    expect(shortList(["GL024", "GL003", "GL001", "GL002", "GL005"])).toBe("GL024, GL003 and 3 more");
    expect(shortList(["GL024", "GL003"])).toBe("GL024, GL003");
    expect(shortList([])).toBe("");
  });
});

describe("formatMoney", () => {
  it("writes the currency code, never a symbol, with no decimals", () => {
    const out = formatMoney(5672930, "ZAR");
    expect(out).toContain("ZAR");
    expect(out).toMatch(/5[,.  ]672[,.  ]930/);
    expect(out).not.toContain("R5");
    expect(out).not.toMatch(/\.\d\d$/);
  });
  it("falls back to plain digits without a currency", () => {
    expect(formatMoney(1200)).toMatch(/^1[,.  ]200$/);
  });
  it("does not throw on an unknown code", () => {
    expect(formatMoney(5, "NOTACODE")).toContain("5");
  });
});

describe("display names", () => {
  it("formatModuleName uses the module display map for acronyms", () => {
    expect(formatModuleName("fi_gl")).toBe("FI general ledger");
    expect(formatModuleName("pii")).toBe("PII");
    expect(formatModuleName("mm_purchasing")).toBe("MM purchasing");
    expect(MODULE_LABELS.fi_gl).toBe("FI general ledger");
  });
  it("formatModuleName sentence-cases anything not in the map", () => {
    expect(formatModuleName("new_custom_module")).toBe("New custom module");
    expect(formatModuleName("completeness")).toBe("Completeness");
  });

  // The 33 module ids of the repo CLAUDE.md "SAP module coverage" table (ECC, SuccessFactors, Warehouse).
  const COVERAGE_IDS = [
    "business_partner", "material_master", "fi_gl", "accounts_payable", "accounts_receivable", "asset_accounting",
    "controlling", "hcm", "mm_purchasing", "plant_maintenance", "production_planning", "project_system",
    "quality_management", "sd_customer_master", "sd_sales_orders",
    "employee_central", "compensation", "benefits", "payroll_integration", "performance_goals", "succession_planning",
    "recruiting_onboarding", "learning_management", "time_attendance",
    "ewms_stock", "ewms_transfer_orders", "batch_management", "mdg_master_data", "grc_compliance", "fleet_management",
    "transport_management", "wm_interface", "cross_system_integration",
  ];
  // Every other module with a rule file under checks/rules/ (ecc, concur, ariba).
  const OTHER_RULE_IDS = [
    "banking_tax", "interface_health", "s4_readiness", "s4hc_master_data",
    "concur_expense", "concur_travel", "concur_users", "ariba_supplier", "ariba_contracts", "ariba_procurement", "ariba_spend",
  ];
  // Words that keep their capitals after the first word: SAP acronyms and product names.
  const KEEP_CASE = new Set(["FI", "MM", "SD", "HCM", "MDG", "GRC", "WM", "BP", "CVI", "PII", "(IDoc)", "S/4HANA", "eWMS", "Concur", "Ariba", "SuccessFactors"]);

  it("names every module of the coverage table and every rule file from the map", () => {
    for (const id of [...COVERAGE_IDS, ...OTHER_RULE_IDS]) expect(Object.hasOwn(MODULE_LABELS, id), id).toBe(true);
  });

  it("writes every module name in sentence case with SAP acronyms upper case", () => {
    for (const [id, label] of Object.entries(MODULE_LABELS)) {
      const [first, ...rest] = label.split(" ");
      expect(KEEP_CASE.has(first) || /^[A-Z][a-z-]*,?$/.test(first), `${id}: ${label}`).toBe(true);
      for (const w of rest) expect(KEEP_CASE.has(w.replace(/,$/, "")) || w === w.toLowerCase(), `${id}: ${label}`).toBe(true);
    }
    expect(formatModuleName("hcm")).toBe("HCM personnel administration");
    expect(formatModuleName("ewms_stock")).toBe("eWMS stock");
    expect(formatModuleName("sd_customer_master")).toBe("SD customer master");
    expect(formatModuleName("business_partner")).toBe("Business partner");
    expect(formatModuleName("performance_goals")).toBe("Performance and goals");
  });
  it("systemTypeLabel maps system types to their product names", () => {
    expect(systemTypeLabel("ecc")).toBe("ECC");
    expect(systemTypeLabel("s4hana_cloud")).toBe("S/4HANA Cloud");
    expect(systemTypeLabel("successfactors")).toBe("SuccessFactors");
    expect(systemTypeLabel(null)).toBe("—");
    expect(systemTypeLabel("some_other")).toBe("Some other");
  });
});

describe("runAxisLabels", () => {
  it("ticks are dates, and date with time only where two runs share a day", () => {
    const labels = runAxisLabels([
      { id: "a", run_at: "2026-10-02T09:00:00Z" },
      { id: "b", run_at: "2026-10-16T05:00:00Z" },
      { id: "c", run_at: "2026-10-16T17:30:00Z" },
    ]);
    expect(labels.get("a")).toBe("2 Oct 2026");
    expect(labels.get("b")).toBe("16 Oct 2026, 05:00");
    expect(labels.get("c")).toBe("16 Oct 2026, 17:30");
  });
  it("never carries the run's upload label", () => {
    const labels = runAxisLabels([{ id: "business_partner_100k", run_at: "2026-10-02T09:00:00Z" }]);
    expect([...labels.values()]).toEqual(["2 Oct 2026"]);
  });
  it("gives a dash for a missing date", () => {
    expect(runAxisLabels([{ id: "x", run_at: null }]).get("x")).toBe("—");
  });
  it("adds seconds when two runs share a minute, and an ordinal in run order when they share a second", () => {
    const labels = runAxisLabels([
      { id: "d", run_at: "2026-10-16T05:17:03.900Z" },
      { id: "a", run_at: "2026-10-16T05:17:01Z" },
      { id: "b", run_at: "2026-10-16T05:17:02Z" },
      { id: "c", run_at: "2026-10-16T05:17:03.100Z" },
      { id: "e", run_at: "2026-10-16T09:00:00Z" },
    ]);
    expect(labels.get("a")).toBe("16 Oct 2026, 05:17:01");
    expect(labels.get("b")).toBe("16 Oct 2026, 05:17:02");
    expect(labels.get("c")).toBe("16 Oct 2026, 05:17:03 #1");
    expect(labels.get("d")).toBe("16 Oct 2026, 05:17:03 #2");
    expect(labels.get("e")).toBe("16 Oct 2026, 09:00");
    // Ten runs inside one minute never share a tick.
    expect(new Set(labels.values()).size).toBe(5);
  });
});

describe("runOptionLabels", () => {
  it("keeps a unique label, and tells runs that share a label apart by date and time", () => {
    const labels = runOptionLabels([
      { id: "a", label: "controlling_1k", run_at: "2026-10-16T05:17:01Z" },
      { id: "b", label: "controlling_1k", run_at: "2026-10-16T05:17:02Z" },
      { id: "c", label: "controlling_1k", run_at: "2026-10-15T08:00:00Z" },
      { id: "d", label: "fi_gl_1k", run_at: "2026-10-16T05:17:01Z" },
      { id: "e", label: null, run_at: "2026-10-14T10:00:00Z" },
    ]);
    expect(labels.get("a")).toBe("controlling_1k, 16 Oct 2026, 05:17:01");
    expect(labels.get("b")).toBe("controlling_1k, 16 Oct 2026, 05:17:02");
    expect(labels.get("c")).toBe("controlling_1k, 15 Oct 2026");
    expect(labels.get("d")).toBe("fi_gl_1k");
    expect(labels.get("e")).toBe("14 Oct 2026, 10:00");
  });
});

describe("cap reasons", () => {
  const reason = "6 critical failures over tolerance (CO003: 6.3% of CSKS rows; CO020: 6.1% of CSKB rows; CO021: 5.1% of CSKB rows; CO028: 5.5% of CEPC rows; CO043: 6.4% of CSKS rows; CO126: 5.0% of CSKS rows) — score capped at 70";
  it("reads the rule ids out of the scoring engine's cap reason", () => {
    expect(capRuleIds(reason)).toEqual(["CO003", "CO020", "CO021", "CO028", "CO043", "CO126"]);
    expect(capRuleIds("MM140: 3.2% of MARA rows — score capped at 85")).toEqual(["MM140"]);
    expect(capRuleIds(null)).toEqual([]);
  });
  it("shortens a long reason to two named rules and a count that adds up", () => {
    expect(shortCapReason(reason)).toBe("6 critical rules over tolerance: CO003, CO020 and 4 more");
    expect(shortCapReason("2 critical failures over tolerance (A1: 1% of T rows; B2: 2% of T rows) — score capped at 70")).toBe("2 critical rules over tolerance: A1, B2");
    expect(shortCapReason("MM140: 3.2% of MARA rows — score capped at 85")).toBe("MM140: 3.2% of MARA rows");
  });
});

describe("deltaSentence", () => {
  it("writes up, down, unchanged or first run", () => {
    expect(deltaSentence(2.14)).toBe("Up 2.1 since the last run");
    expect(deltaSentence(-0.8)).toBe("Down 0.8 since the last run");
    expect(deltaSentence(0)).toBe("Unchanged since the last run");
    expect(deltaSentence(0.04)).toBe("Unchanged since the last run");
    expect(deltaSentence(null)).toBe("First scored run");
    expect(deltaSentence(undefined)).toBe("First scored run");
  });
});

describe("trendSentence", () => {
  it("says held at when the first and last values are equal", () => {
    expect(trendSentence(70, 70, 2)).toBe("Composite score held at 70 over 2 runs.");
    expect(trendSentence(70.04, 70, 3)).toBe("Composite score held at 70 over 3 runs.");
  });
  it("says rose or fell otherwise, with the run count agreed", () => {
    expect(trendSentence(60, 70, 2)).toBe("Composite score rose from 60 to 70 over 2 runs.");
    expect(trendSentence(82.5, 70, 4, "Completeness")).toBe("Completeness fell from 82.5 to 70 over 4 runs.");
  });
});

describe("formatMoneyCompact", () => {
  it("shortens headline money to three significant figures from a million up", () => {
    expect(formatMoneyCompact(4_840_487_383, "ZAR")).toBe("ZAR 4.84 bn");
    expect(formatMoneyCompact(4_793_500, "ZAR")).toBe("ZAR 4.79 m");
    expect(formatMoneyCompact(1_250_000_000_000, "ZAR")).toBe("ZAR 1.25 tn");
  });
  it("keeps smaller amounts whole, and says nothing for a missing figure", () => {
    expect(formatMoneyCompact(840_000, "ZAR")).toBe("ZAR 840 k");
    expect(formatMoneyCompact(950, "ZAR")).toBe(formatMoney(950, "ZAR"));
    expect(formatMoneyCompact(12_300_000)).toBe("12.3 m");
    expect(formatMoneyCompact(null, "ZAR")).toBe("—");
  });
  it("rounds before picking the unit, stepping up when the rounded figure reaches a thousand", () => {
    expect(formatMoneyCompact(999_999, "ZAR")).toBe("ZAR 1 m");
    expect(formatMoneyCompact(999_499, "ZAR")).toBe("ZAR 999 k");
    expect(formatMoneyCompact(999_499_999, "ZAR")).toBe("ZAR 999 m");
    expect(formatMoneyCompact(999_500_000, "ZAR")).toBe("ZAR 1 bn");
    expect(formatMoneyCompact(999_999_999_999, "ZAR")).toBe("ZAR 1 tn");
    expect(formatMoneyCompact(-999_999, "ZAR")).toBe("ZAR -1 m");
  });
});

describe("passRatePct", () => {
  it("passes the stored 0..100 rate through, so a nearly failing rule is not read as a 0..1 share", () => {
    expect(passRatePct(0.5)).toBe(0.5);
    expect(passRatePct(1)).toBe(1);
    expect(passRatePct(0)).toBe(0);
    expect(passRatePct(98.46)).toBe(98.46);
    expect(passRatePct(null)).toBeNull();
    expect(passRatePct(undefined)).toBeNull();
    expect(passRatePct(Number.NaN)).toBeNull();
  });
});

describe("zoneName", () => {
  it("names a zone once for a column header", () => {
    expect(zoneName("UTC")).toBe("UTC");
    expect(zoneName("Africa/Johannesburg", new Date("2026-01-03T00:00:00Z"))).toBe("GMT+2");
  });
});
