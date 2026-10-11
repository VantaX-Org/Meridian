import { describe, expect, it } from "vitest";
import { parsePalette, type GrammarContext } from "./palette-grammar";

const ctx: GrammarContext = {
  objects: [
    { module: "material_master", label: "Material master" },
    { module: "business_partner", label: "Business partner" },
  ],
  systems: ["PRD", "QAS"],
};
const href = (s: string) => parsePalette(s, ctx).href;
const kinds = (s: string) => parsePalette(s, ctx).chips.map((c) => c.kind);

describe("palette grammar", () => {
  it("1. spec example: severity + object + system + last run", () => {
    expect(href("critical material master findings in PRD last run")).toBe(
      "/objects/material_master?severity=critical&system=PRD&run=latest",
    );
  });
  it("2. failing objects by dimension", () => {
    expect(href("failing business partner completeness")).toBe(
      "/objects/business_partner?dimension=completeness&status=failing",
    );
  });
  it("3. check id routes to the rule", () => {
    expect(href("MM-001")).toBe("/rules/MM-001");
  });
  it("4. SAP numeric key with an object routes to the record", () => {
    expect(href("material master 000000000012345678")).toBe("/objects/material_master/records/000000000012345678");
  });
  it("5. SAP key without an object falls to search", () => {
    expect(href("4711000123")).toBe("/search?q=4711000123");
  });
  it("6. vs previous and owner", () => {
    expect(href("high material master vs previous owner anna")).toBe(
      "/objects/material_master?severity=high&compare=previous&owner=anna",
    );
  });
  it("7. blocked with no object lists objects", () => {
    expect(href("blocked medium findings")).toBe("/objects?severity=medium&status=blocked");
  });
  it("8. plain words fall back to full-text search; empty gives no target", () => {
    expect(href("supplier bank details")).toBe("/search?q=supplier%20bank%20details");
    expect(parsePalette("  ", ctx).href).toBeNull();
    expect(kinds("critical material master")).toEqual(["object", "severity"]);
  });
});
