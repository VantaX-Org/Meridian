import { describe, expect, it } from "vitest";
import type { Rule } from "@/lib/api/rules";
import { buildScope, dateError, EMPTY_SCOPE, parseList, scopeSentence } from "./extract-scope";
import { cronError, describeCron, isPreset, presetLabel } from "./cron";
import { activeFilterCount, filterRows, NO_FILTERS, rankRows, splitName, toRows } from "./rules-library";
import { moveBy, needsSources, toInput, validateRules, type DraftRule } from "./survivorship";
import { addField, deleteActivity, fieldError, moveActivity, removeField } from "./designer-doc";
import { areaFound, objectSource, objectText } from "./config-text";
import type { ProcessModelDocument } from "@/types/process-model";

describe("extract scope", () => {
  it("parses lists in upper case without blanks or repeats", () => {
    expect(parseList("1000, 1100;1000  a1")).toEqual(["1000", "1100", "A1"]);
  });
  it("builds only what the chosen objects accept and what was typed", () => {
    const draft = { ...EMPTY_SCOPE, lists: { plants: "1000", company_codes: "2000" }, date_from: "2026-01-01", exclude_deleted: true };
    expect(buildScope(draft, ["plants"], false)).toEqual({ plants: ["1000"], exclude_deleted: true });
    expect(buildScope(draft, ["plants", "company_codes"], true)).toEqual({ plants: ["1000"], company_codes: ["2000"], date_from: "2026-01-01", exclude_deleted: true });
  });
  it("says it in a sentence", () => {
    expect(scopeSentence({})).toBe("Scope: everything, no organisational filter.");
    expect(scopeSentence({ plants: ["1000"], date_to: "2026-02-01" })).toBe("Scope: plants 1000; documents the start to 2026-02-01.");
  });
  it("checks the order of the dates", () => {
    expect(dateError("2026-03-01", "2026-01-01")).toBeDefined();
    expect(dateError("2026-01-01", "2026-03-01")).toBeUndefined();
    expect(dateError("", "2026-03-01")).toBeUndefined();
  });
});

describe("cron", () => {
  it("accepts the shapes the scheduler runs and names the field that is wrong", () => {
    expect(cronError("0 2 * * 1")).toBeUndefined();
    expect(cronError("*/15 1-5 * * 1,3")).toBeUndefined();
    expect(cronError("99 2 * * *")).toBe("Minute is out of range");
    expect(cronError("0 25 * * *")).toBe("Hour is out of range");
    expect(cronError("0 2 * *")).toMatch(/five fields/);
  });
  it("words and presets", () => {
    expect(describeCron("0 2 * * 1")).toBe("Mondays at 02:00 UTC");
    expect(presetLabel("0 2 * * 1")).toBe("Weekly, Monday 02:00");
    expect(presetLabel(null)).toBe("Manual only");
    expect(isPreset("0 * * * *")).toBe(true);
    expect(isPreset("5 5 * * *")).toBe(false);
  });
});

const rule = (name: string, over: Partial<Rule> = {}): Rule => ({
  id: `r-${name}`, name, description: null, module: "material_master", category: "ecc", severity: "high", enabled: true, conditions: null, thresholds: null, tags: null, source_yaml: null, source: "yaml",
  created_at: "", updated_at: "", last_pass_rate: 90, last_run_at: null, last_affected_count: 10, ...over,
});

describe("rules library", () => {
  it("splits the code from the message", () => {
    expect(splitName("MM142: Base unit: not valid")).toEqual({ checkId: "MM142", message: "Base unit: not valid" });
    expect(splitName("Free text")).toEqual({ checkId: "Free text", message: "Free text" });
  });
  const rows = toRows([rule("MM142: A", { severity: "low", last_affected_count: 1 }), rule("MM003: B", { severity: "critical" }), rule("BP001: C", { module: "business_partner", enabled: false, source: "custom" })], new Set(["MM003"]), new Map());
  it("ranks worst severity first, then most failing", () => {
    expect(rankRows(rows).map((r) => r.checkId)).toEqual(["MM003", "BP001", "MM142"]);
  });
  it("filters by object, state, search and counts the filters", () => {
    expect(filterRows(rows, { ...NO_FILTERS, module: "business_partner" }).map((r) => r.checkId)).toEqual(["BP001"]);
    expect(filterRows(rows, { ...NO_FILTERS, state: "disabled" })).toHaveLength(1);
    expect(filterRows(rows, { ...NO_FILTERS, state: "suppressed" }).map((r) => r.checkId)).toEqual(["MM003"]);
    expect(filterRows(rows, { ...NO_FILTERS, state: "custom" }).map((r) => r.checkId)).toEqual(["BP001"]);
    expect(filterRows(rows, { ...NO_FILTERS, search: "mm" })).toHaveLength(2);
    expect(activeFilterCount({ ...NO_FILTERS, search: "x", severity: "low" })).toBe(2);
  });
  it("dimension and class come from the object's coverage when it is known", () => {
    const cov = new Map([["material_master", { module: "material_master", has_view_map: false, object: { module: "material_master", by_dimension: {}, total: 1, never_run: 0 }, views: [{ view: "all", label: "All", total: 1, tables: [], rules: [{ check_id: "MM142", message: "A", check_class: "null_check", severity: "low", dimension: "completeness", field: null, last_pass_rate: null }] }], dimension_by_view: {}, totals: { rules: 1, never_run: 0, views: 1, views_total: 1, tables: 0 } }]]);
    const withMeta = toRows([rule("MM142: A"), rule("MM003: B")], new Set(), cov);
    expect(filterRows(withMeta, { ...NO_FILTERS, dimension: "completeness" }).map((r) => r.checkId)).toEqual(["MM142"]);
    expect(filterRows(withMeta, { ...NO_FILTERS, checkClass: "null_check" })).toHaveLength(1);
  });
});

describe("survivorship helpers", () => {
  const base: DraftRule = { key: "a", field: "MARA-MEINS", rule_type: "most_recent", trusted_sources: [], weight: "50", active: true };
  it("validates field, systems and weight", () => {
    expect(validateRules([base])).toEqual({});
    expect(validateRules([{ ...base, field: " " }]).a.field).toBe("Enter the field");
    expect(validateRules([{ ...base, rule_type: "chain" }]).a.sources).toBe("Choose at least one system");
    expect(validateRules([{ ...base, weight: "101" }]).a.weight).toBeDefined();
    expect(validateRules([base, { ...base, key: "b" }]).b.field).toMatch(/already covers/);
  });
  it("sends systems only for the types that read them", () => {
    expect(needsSources("chain")).toBe(true);
    expect(toInput([{ ...base, trusted_sources: ["X"] }])[0].trusted_sources).toBeNull();
    expect(toInput([{ ...base, rule_type: "trusted_source", trusted_sources: ["X"] }])[0]).toMatchObject({ trusted_sources: ["X"], weight: 50 });
  });
  it("moves by one and stops at the ends", () => {
    expect(moveBy(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"]);
    expect(moveBy(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });
});

describe("designer document helpers", () => {
  const doc: ProcessModelDocument = {
    schema_version: 1,
    l1: [{ id: "P", name: "P", description: "", order: 1, modules: [], l2: [{ id: "P-A", name: "A", description: "", order: 1, l3: [{ id: "P-A-1", name: "S", description: "", order: 1, l4: [{
      id: "S1", name: "Step", description: "", order: 1, tcode: null, config_dependency: null, variants: [], diagram: { nodes: [{ id: "S1-N", type: "task", activity_id: "S1-A", label: null, x: 0, y: 0 }], flows: [] },
      activities: [
        { id: "S1-A", name: "One", description: "", order: 1, tcode: null, fields: [], check_ids: [], sap_tables: [] },
        { id: "S1-B", name: "Two", description: "", order: 2, tcode: null, fields: [], check_ids: [], sap_tables: [] },
      ],
    }] }] }] }],
  };
  const acts = (d: ProcessModelDocument) => d.l1[0].l2[0].l3[0].l4[0].activities;
  it("checks TABLE.FIELD", () => {
    expect(fieldError("mara.matnr", [])).toBeUndefined();
    expect(fieldError("matnr", [])).toMatch(/TABLE.FIELD/);
    expect(fieldError("", [])).toBeDefined();
    expect(fieldError("MARA.MATNR", ["MARA.MATNR"])).toMatch(/already mapped/);
  });
  it("maps and unmaps a field and keeps the tables of the activity", () => {
    const mapped = addField(doc, "S1-A", "mara.matnr");
    expect(acts(mapped)[0].fields.map((f) => f.field)).toEqual(["MARA.MATNR"]);
    expect(acts(mapped)[0].sap_tables).toEqual(["MARA"]);
    expect(acts(removeField(mapped, "S1-A", "MARA.MATNR"))[0].fields).toEqual([]);
  });
  it("reorders and deletes activities, numbering them again", () => {
    const moved = moveActivity(doc, "S1-B", -1);
    expect(acts(moved).map((a) => [a.id, a.order])).toEqual([["S1-B", 1], ["S1-A", 2]]);
    expect(acts(deleteActivity(doc, "S1-A")).map((a) => [a.id, a.order])).toEqual([["S1-B", 1]]);
    expect(acts(moveActivity(doc, "S1-A", -1)).map((a) => a.id)).toEqual(["S1-A", "S1-B"]);
  });
});

describe("configuration words", () => {
  const o = (over: object) => ({ object: "T001", label: "Company codes", state: "loaded", rows: 4, detail: "", cause: null, ...over }) as Parameters<typeof objectText>[0];
  it("says why an object did not load", () => {
    expect(objectText(o({ state: "failed", cause: "auth" }))).toMatch(/No authorisation/);
    expect(objectText(o({ state: "not_available", cause: "not_in_release" }))).toMatch(/does not exist in this release/);
    expect(objectText(o({}))).toBe("4 found.");
  });
  it("names the source of an object", () => {
    expect(objectSource("loaded")).toBe("live");
    expect(objectSource("empty")).toBe("live");
    expect(objectSource("failed")).toBe("baseline");
  });
  it("sums up an area", () => {
    expect(areaFound({ area: "x", label: "Enterprise structure", status: "loaded", tables_total: 2, tables_done: 2, objects: [o({}), o({ object: "T001W", label: "Plants", rows: 11 })] })).toBe("4 company codes, 11 plants");
    expect(areaFound({ area: "x", label: "Controlling", status: "loaded", tables_total: 0, tables_done: 0, objects: [] })).toBe("No controlling configuration found.");
  });
});

describe("grid CSV export", () => {
  it("writes the headers, the cells as text, numbers as numbers, and keeps formulas as text", async () => {
    const { gridCsv } = await import("./grid-export");
    const cols = [
      { id: "id", header: "Rule", cell: (r: { id: string; n: number }) => r.id },
      { id: "n", header: "Failing, rows", numeric: true, cell: (r: { id: string; n: number }) => r.n.toLocaleString("en-US") },
    ];
    expect(gridCsv([{ id: "MM142", n: 3640 }, { id: "=HYPERLINK()", n: 0 }], cols)).toBe('Rule,"Failing, rows"\nMM142,3640\n\'=HYPERLINK(),0');
  });
});

describe("SAP keys as SAP shows them", () => {
  it("drops the leading zeros of a numeric key and keeps any other key", async () => {
    const { alphaOut } = await import("./format");
    expect(alphaOut("000000000000000232")).toBe("232");
    expect(alphaOut("0000")).toBe("0");
    expect(alphaOut("00A-17")).toBe("00A-17");
    expect(alphaOut("1000")).toBe("1000");
  });
});
