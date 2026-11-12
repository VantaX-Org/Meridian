import { beforeEach, describe, expect, it } from "vitest";
import { draftStore } from "../screens/work-parts";

describe("draftStore", () => {
  beforeEach(() => sessionStorage.clear());

  it("keeps unsaved values across a reload, per run", () => {
    const a = draftStore("run-a");
    a.set("material_master|MATNR=1", "KG");
    expect(draftStore("run-a").get("material_master|MATNR=1")).toBe("KG");
    expect(draftStore("run-b").size).toBe(0);
  });

  it("forgets a value once it is saved or dropped", () => {
    const a = draftStore("run-a");
    a.set("k", "v");
    a.delete("k");
    expect(draftStore("run-a").size).toBe(0);
    expect(sessionStorage.getItem("mn_work_drafts:run-a")).toBeNull();
  });
});
