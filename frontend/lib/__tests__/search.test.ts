import { describe, expect, it } from "vitest";
import { rankResults, type SearchCandidate } from "../search";

const c = (over: Partial<SearchCandidate>): SearchCandidate => ({ kind: "object", id: "1", label: "", href: "", ...over });

describe("rankResults", () => {
  it("ranks an exact id match first", () => {
    const candidates = [c({ id: "material_master", label: "Material master" }), c({ id: "C001", label: "C001 material group check" })];
    const [first] = rankResults("material_master", candidates);
    expect(first.id).toBe("material_master");
  });
  it("ranks a label prefix match above a substring match", () => {
    const candidates = [c({ id: "a", label: "Business partner cleanup" }), c({ id: "b", label: "Business partner" })];
    const results = rankResults("business partner", candidates);
    expect(results[0].id).toBe("b");
  });
  it("is case-insensitive and ignores non-matches", () => {
    const candidates = [c({ id: "a", label: "Material Master" }), c({ id: "b", label: "Unrelated" })];
    const results = rankResults("MATERIAL", candidates);
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe("a");
  });
  it("returns everything in input order for an empty query", () => {
    const candidates = [c({ id: "a" }), c({ id: "b" })];
    expect(rankResults("", candidates).map((r) => r.id)).toEqual(["a", "b"]);
  });
});
