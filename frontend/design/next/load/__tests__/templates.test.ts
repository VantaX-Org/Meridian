import { describe, expect, it } from "vitest";
import { mappingKey, nextSheet, proposal, rowsOf } from "../templates";
import type { TemplateCoverage } from "@/lib/api/v2/migration";

const cov: TemplateCoverage = {
  columns: 6,
  matched: 4,
  sheets: [
    { name: "General", table: "T1", columns: 3, matched: 3, unmapped: [] },
    { name: "Plant", table: "T2", columns: 2, matched: 1, unmapped: [{ header: "Col B", id: "", label: "", mandatory: true }] },
    { name: "Sales", table: null, columns: 1, matched: 0, unmapped: [{ header: "Col C", id: "T3.F1", label: "Field one", mandatory: false }] },
  ],
};

describe("template rows", () => {
  it("classifies each sheet from the workbook columns", () => {
    expect(rowsOf(cov, false).map((r) => r.status)).toEqual(["ready", "decision", "not-started"]);
  });
  it("a sheet with nothing matched counts as started once a fill ran", () => {
    expect(rowsOf(cov, true)[2].status).toBe("decision");
  });
  it("picks the first sheet that is not ready", () => {
    expect(nextSheet(rowsOf(cov, false))?.name).toBe("Plant");
    expect(nextSheet(rowsOf({ ...cov, sheets: [cov.sheets[0]] }, false))).toBeNull();
  });
  it("never proposes a field the source did not resolve", () => {
    expect(proposal(cov.sheets[1].unmapped[0])).toBeNull();
    expect(proposal(cov.sheets[2].unmapped[0])).toBe("T3.F1");
  });
  it("keys a mapping by sheet and header", () => {
    expect(mappingKey("Plant", "Col B")).toBe("Plant::Col B");
  });
  it("handles a template with no coverage", () => {
    expect(rowsOf(null, false)).toEqual([]);
  });
});
