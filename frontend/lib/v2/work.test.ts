import { describe, expect, it, vi } from "vitest";
import * as workApi from "@/lib/api/v2/work";
import { allWorkRows } from "./work-queries";
import type { WorkRow } from "@/lib/api/v2/types";
import type { SavedView, WorkSummary } from "@/lib/api/v2/work";
import { CHIPS, DEFAULT_STATE, compareRows, daysOpen, filtersOf, initials, keyHeaders, possibleValues, readState, sentence, splitKey, toParams, viewFilters, withState } from "./work";

const summary = (over: Partial<WorkSummary["objects"][number]> = {}, extra: Partial<WorkSummary["objects"][number]>[] = []): WorkSummary => ({
  version_id: null,
  scope: null,
  built: true,
  objects: [{ module: "material_master", records: 100, open: 90, issues: 90, critical: 10, proposed: 40, overdue: 5, statuses: { to_fix: 70, proposed: 20, approved: 6, sent: 4, fixed: 3, not_an_issue: 10 }, ...over }, ...extra.map((e) => ({ module: "accounts_payable", records: 0, open: 0, issues: 0, critical: 0, proposed: 0, overdue: 0, statuses: {}, ...e }))],
  totals: { records: 100, open: 90, issues: 90, critical: 10, proposed: 40, overdue: 5 },
});

const row = (over: Partial<WorkRow>): WorkRow => ({ module: "material_master", record_key: "MATNR=1", name: "x", issues: 1, severity: "high", checks: ["MM142"], proposed: 0, status: "to_fix", top_message: null, top_field: null, ...over });

describe("chips", () => {
  it("count from the summary: to fix, fix proposed, waiting for approval, exceptions", () => {
    const s = summary();
    expect(CHIPS.map((c) => [c.id, c.count(s)])).toEqual([["tofix", 70], ["proposed", 40], ["approvals", 20], ["approved", 6], ["sent", 4], ["fixed", 3], ["exceptions", 10]]);
    expect(CHIPS.map((c) => c.count(undefined))).toEqual([null, null, null, null, null, null, null]);
  });

  it("count one object when the ledger is scoped to it", () => {
    const s = summary({}, [{ module: "accounts_payable", statuses: { to_fix: 5 }, proposed: 2 }]);
    expect(CHIPS[0].count(s, "accounts_payable")).toBe(5);
    expect(CHIPS[0].count(s)).toBe(75);
    expect(CHIPS[1].count(s, "accounts_payable")).toBe(2);
  });

  it("ask the API for the right rows", () => {
    expect(filtersOf({ ...DEFAULT_STATE })).toMatchObject({ status: "to_fix", proposed: undefined });
    expect(filtersOf({ ...DEFAULT_STATE, chip: "proposed" })).toMatchObject({ status: "to_fix", proposed: true });
    expect(filtersOf({ ...DEFAULT_STATE, chip: "approvals" })).toMatchObject({ status: "proposed" });
    expect(filtersOf({ ...DEFAULT_STATE, chip: "exceptions" })).toMatchObject({ status: "not_an_issue" });
    expect(filtersOf({ ...DEFAULT_STATE, chip: "sent", wave: "W1", verdict: "go" })).toMatchObject({ status: "sent", wave: "W1", verdict: "go" });
    expect(filtersOf({ ...DEFAULT_STATE, chip: null, module: "m", rule: "MM142", severity: "critical", assigned: "me", due: "overdue" })).toEqual({ module: "m", check_id: "MM142", severity: "critical", assigned: "me", due: "overdue", status: "open", proposed: undefined });
  });
});

describe("the address", () => {
  it("round-trips the state and leaves defaults out", () => {
    expect(toParams(DEFAULT_STATE)).toEqual({});
    const s = { ...DEFAULT_STATE, chip: "approvals" as const, module: "material_master", rule: "MM142", group: true, sort: "age" as const, density: "compact" as const };
    const params = toParams(s);
    expect(params).toEqual({ filter: "approvals", module: "material_master", rule: "MM142", group: "rule", sort: "age", density: "compact" });
    expect(readState(new URLSearchParams(params))).toEqual(s);    const w = { ...DEFAULT_STATE, wave: "W1", verdict: "no-go" };
    expect(toParams(w)).toEqual({ wave: "W1", verdict: "no-go" });
    expect(readState(new URLSearchParams(toParams(w)))).toEqual(w);
  });

  it("filter=open and the API's status names both mean the chip they say", () => {
    expect(readState(new URLSearchParams("filter=open")).chip).toBeNull();
    expect(readState(new URLSearchParams("status=open")).chip).toBeNull();
    expect(readState(new URLSearchParams("status=to_fix&proposed=true")).chip).toBe("proposed");
    expect(readState(new URLSearchParams("status=proposed")).chip).toBe("approvals");
    expect(readState(new URLSearchParams("status=not_an_issue")).chip).toBe("exceptions");
    expect(readState(new URLSearchParams("status=approved")).chip).toBe("approved");
    expect(readState(new URLSearchParams("status=sent")).chip).toBe("sent");
    expect(readState(new URLSearchParams("status=fixed")).chip).toBe("fixed");
    expect(readState(new URLSearchParams("")).chip).toBe("tofix");
  });

  it("a saved view fills what the address leaves out, and the address wins", () => {
    const view: SavedView = { id: "v", route: "work", name: "Overdue", filters: { due: "overdue", status: "open", severity: "critical" }, columns: null, density: "compact", builtin: true, created_at: null };
    const s = readState(new URLSearchParams("view=v"), view);
    expect(s).toMatchObject({ chip: null, due: "overdue", severity: "critical", density: "compact" });
    expect(readState(new URLSearchParams("view=v&severity=high"), view).severity).toBe("high");
  });

  it("a saved view keeps the API's own filter names", () => {
    expect(viewFilters({ ...DEFAULT_STATE, chip: "proposed", module: "material_master", group: true, sort: "due" })).toEqual({ status: "to_fix", proposed: "true", module: "material_master", group: "rule", sort: "due" });
    expect(viewFilters({ ...DEFAULT_STATE, chip: null, assigned: "me" })).toEqual({ status: "open", assigned: "me" });
  });

  it("withState replaces the ledger's keys and keeps the others (fixture, persona, open)", () => {
    const qs = withState("fixture=1&persona=steward&open=record%3Am%3Ak&filter=exceptions&view=x", { ...DEFAULT_STATE, chip: "approvals" }, { view: null });
    const p = new URLSearchParams(qs);
    expect(p.get("filter")).toBe("approvals");
    expect(p.get("fixture")).toBe("1");
    expect(p.get("persona")).toBe("steward");
    expect(p.get("open")).toBe("record:m:k");
    expect(p.has("view")).toBe(false);
  });
});

describe("rows", () => {
  it("sort by value at risk, due, age and owner, nulls last", () => {
    const rows = [row({ record_key: "a", value_at_risk: 5, due_at: "2026-10-12", first_seen_at: "2026-09-01", assignee_email: "z@x" }), row({ record_key: "b", value_at_risk: 9, due_at: null, first_seen_at: "2026-08-01", assignee_email: "a@x" }), row({ record_key: "c", value_at_risk: null, due_at: "2026-10-01", first_seen_at: null, assignee_email: null })];
    const keys = (s: Parameters<typeof compareRows>[0]) => [...rows].sort(compareRows(s)).map((r) => r.record_key);
    expect(keys("value")).toEqual(["b", "a", "c"]);
    expect(keys("due")).toEqual(["c", "a", "b"]);
    expect(keys("age")).toEqual(["b", "a", "c"]);
    expect(keys("owner")).toEqual(["b", "a", "c"]);
  });

  it("splits a key into its parts and keeps the zeros", () => {
    expect(splitKey("MATNR=000000000000000101|WERKS=3000")).toEqual([{ field: "MATNR", value: "000000000000000101" }, { field: "WERKS", value: "3000" }]);
    expect(splitKey("ABC")).toEqual([{ field: "", value: "ABC" }]);
  });

  it("names the key columns from the key fields, else Record and Plant", () => {
    expect(keyHeaders([row({ record_key: "MATNR=1|WERKS=3000" })])).toEqual({ first: "Material number", second: "Plant" });
    expect(keyHeaders([row({ record_key: "LIFNR=1|BUKRS=1000" })])).toEqual({ first: "Vendor number", second: "Company code" });
    expect(keyHeaders([row({ record_key: "ZZFIELD=1" })])).toEqual({ first: "ZZFIELD", second: "Plant" });
    expect(keyHeaders([])).toEqual({ first: "Record", second: "Plant" });
  });

  it("possible values: three, then '+N more' with the whole list for the title", () => {
    const list = ["EA", "PC", "KG", "M", "L"].map((value) => ({ value, label: value === "EA" ? "Each" : null }));
    expect(possibleValues({ possible_values: list, possible_values_total: 38 })).toEqual({ text: "EA, PC, KG", more: 35, full: "EA (Each), PC, KG, M, L, and 33 more" });
    expect(possibleValues({ possible_values: list.slice(0, 2), possible_values_total: null })).toMatchObject({ text: "EA, PC", more: 0 });
    expect(possibleValues({ possible_values: null })).toBeNull();
  });

  it("initials and days open", () => {
    expect(initials("a.naidoo@example.com")).toBe("AN");
    expect(initials("Demo user")).toBe("DU");
    expect(initials("thandi")).toBe("TH");
    expect(initials(null)).toBeNull();
    const now = Date.parse("2026-10-16T00:00:00Z");
    expect(daysOpen("2026-10-06T05:00:00Z", now)).toBe(9);
    expect(daysOpen(null, now)).toBeNull();
    expect(daysOpen("2026-10-20T00:00:00Z", now)).toBe(0);
  });
});

describe("the sentence", () => {
  const s = summary();
  it("a steward hears how many have a suggested value; a lead hears the ranking", () => {
    expect(sentence({ persona: "steward", chip: "tofix", summary: s, objectLabel: null })).toBe("70 records to fix, 40 with a suggested value.");
    expect(sentence({ persona: "lead", chip: "tofix", summary: s, objectLabel: "Material master" })).toBe("70 records to fix in Material master, ranked by value at risk.");
  });
  it("says what the other chips list", () => {
    expect(sentence({ persona: "lead", chip: "approvals", summary: s, objectLabel: null })).toContain("20 records wait for approval");
    expect(sentence({ persona: "lead", chip: "exceptions", summary: s, objectLabel: null })).toContain("10 records are signed off");
    expect(sentence({ persona: "lead", chip: "approvals", summary: summary({ statuses: {} }), objectLabel: null })).toBe("Nothing is waiting for approval.");
    expect(sentence({ persona: "lead", chip: "tofix", summary: summary({ statuses: {} }), objectLabel: null })).toBe("Nothing is waiting to be fixed.");
  });
  it("names the wave and the verdict the ledger is narrowed to", () => {
    const w = (name: string | null, verdict: string | null): WorkSummary => ({ ...summary(), wave: { id: "W1", name, verdict, objects: [] } });
    expect(sentence({ persona: "lead", chip: "tofix", summary: w("Wave 1", null), objectLabel: null })).toBe("70 records to fix in Wave 1, ranked by value at risk.");
    expect(sentence({ persona: "lead", chip: "tofix", summary: w("Wave 1", "no-go"), objectLabel: null })).toContain("in the no-go objects of Wave 1");
    expect(sentence({ persona: "lead", chip: "tofix", summary: w(null, "at-risk"), objectLabel: null })).toContain("in the at-risk objects");
  });

  it("is empty until the summary is read", () => {
    expect(sentence({ persona: "lead", chip: "tofix", summary: undefined, objectLabel: null })).toBe("");
  });
});

describe("allWorkRows", () => {
  it("pages through every row of the filter, 500 at a time, up to the cap", async () => {
    const spy = vi.spyOn(workApi, "getWork").mockImplementation(async (q) => {
      const at = Number(q.after ?? 0);
      const items = Array.from({ length: Math.min(500, 1200 - at) }, (_, i) => row({ record_key: `MATNR=${at + i}` }));
      return { version_id: null, total: 1200, total_capped: false, next: at + 500 < 1200 ? String(at + 500) : null, items };
    });
    expect(await allWorkRows({ wave: "w-1" }, "value")).toHaveLength(1200);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[0][0]).toMatchObject({ wave: "w-1", limit: 500 });
    expect(await allWorkRows({}, "value", 600)).toHaveLength(600);
    spy.mockRestore();
  });
});
