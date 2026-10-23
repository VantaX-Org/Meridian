import { describe, expect, it } from "vitest";
import { parsePalette, type GrammarContext } from "./palette-grammar";

const ctx: GrammarContext = {
  objects: [
    { module: "material_master", label: "Material master" },
    { module: "business_partner", label: "Business partner" },
  ],
};
const href = (s: string) => parsePalette(s, ctx).href;
const kinds = (s: string) => parsePalette(s, ctx).chips.map((c) => c.kind);

// The query parameters each target page reads (objects/page.tsx, objects/[object]/page.tsx and _workbench.tsx).
const HONOURED: Record<string, string[]> = {
  "/objects": ["run", "dimension", "owner", "readiness"],
  "/objects/*": ["tab", "severity", "dimension", "check", "run", "blocking", "rule"],
};

describe("palette grammar", () => {
  it("1. severity + object opens the object's Rules tab filtered; last run is the object page's default", () => {
    expect(href("critical material master findings last run")).toBe("/objects/material_master?tab=rules&severity=critical");
    expect(kinds("critical material master last run")).toEqual(["run", "object", "severity"]);
  });
  it("2. dimension on an object filters its Rules tab", () => {
    expect(href("business partner completeness")).toBe("/objects/business_partner?tab=rules&dimension=completeness");
  });
  it("3. real rule IDs route to the rule", () => {
    expect(href("MM003")).toBe("/rules/MM003");
    expect(href("mm018b")).toBe("/rules/MM018B");
    expect(href("S4HC042")).toBe("/rules/S4HC042");
    expect(href("EWMS_TO019")).toBe("/rules/EWMS_TO019");
    expect(href("EWMSTO152")).toBe("/rules/EWMSTO152");
    expect(href("S4R-WM-QUANT-NEG")).toBe("/rules/S4R-WM-QUANT-NEG");
    expect(href("S4-CE-PRIMARY-GL")).toBe("/rules/S4-CE-PRIMARY-GL");
  });
  it("3b. a rule ID with an object opens that object's Records tab for the rule", () => {
    expect(href("material master MM003")).toBe("/objects/material_master?tab=records&check=MM003");
  });
  it("3c. the made-up hyphenated shape and hyphenated words are not rule IDs", () => {
    expect(kinds("MM-001")).toEqual([]);
    expect(href("up-to-date")).toBe("/search?q=up-to-date");
  });
  it("4. SAP numeric key with an object routes to the record", () => {
    expect(href("material master 000000000012345678")).toBe("/objects/material_master/records/000000000012345678");
  });
  it("5. SAP key without an object falls to search", () => {
    expect(href("4711000123")).toBe("/search?q=4711000123");
    expect(kinds("MAT1234567")).toEqual(["key"]);
  });
  it("6. owner, dimension and last run filter the objects list", () => {
    expect(href("owner anna accuracy last run")).toBe("/objects?dimension=accuracy&owner=anna&run=latest");
  });
  it("7. words that lead nowhere are not chips: vs previous, failing, blocked, system codes", () => {
    for (const s of ["vs previous", "failing", "blocked", "in PRD"]) {
      expect(parsePalette(s, ctx)).toEqual({ chips: [], href: `/search?q=${encodeURIComponent(s)}` });
    }
    expect(href("failing material master in PRD vs previous")).toBe("/objects/material_master");
  });
  it("7b. severity without an object has no list filter, so it falls back to search", () => {
    expect(href("blocked medium findings")).toBe("/search?q=blocked%20medium%20findings");
  });
  it("8. plain words fall back to full-text search; empty gives no target", () => {
    expect(href("supplier bank details")).toBe("/search?q=supplier%20bank%20details");
    expect(parsePalette("  ", ctx).href).toBeNull();
    expect(kinds("critical material master")).toEqual(["object", "severity"]);
  });
  it("9. every link carries only parameters its target page reads", () => {
    const inputs = [
      "critical material master accuracy last run", "owner anna accuracy last run", "material master MM003",
      "high business partner owner anna", "last run", "consistency", "material master",
    ];
    for (const s of inputs) {
      const h = href(s) ?? "";
      const [path, qs = ""] = h.split("?");
      const page = path === "/objects" ? "/objects" : path.startsWith("/objects/") && !path.includes("/records/") ? "/objects/*" : null;
      if (!page) continue;
      for (const k of new URLSearchParams(qs).keys()) expect(HONOURED[page], `${s} -> ${h}`).toContain(k);
    }
  });
});
