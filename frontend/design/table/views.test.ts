import { describe, expect, it } from "vitest";
import { deleteView, loadViews, saveView, toCsv } from "./views";

describe("views storage", () => {
  it("round-trips and replaces by name", () => {
    window.localStorage.clear();
    saveView("x", { name: "a", visibility: {}, dense: false, sorting: [] });
    saveView("x", { name: "a", visibility: {}, dense: true, sorting: [] });
    expect(loadViews("x")).toHaveLength(1);
    expect(loadViews("x")[0].dense).toBe(true);
    expect(deleteView("x", "a")).toEqual([]);
  });
  it("survives corrupt storage", () => {
    window.localStorage.setItem("m-table-views:bad", "{not json");
    expect(loadViews("bad")).toEqual([]);
  });
});

describe("toCsv", () => {
  it("quotes and guards formulas", () => {
    expect(toCsv(["a", "b"], [['=1+1', 'x,"y"']])).toBe('a,b\n\'=1+1,"x,""y"""');
  });
});
