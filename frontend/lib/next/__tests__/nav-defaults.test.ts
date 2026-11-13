import { describe, expect, it } from "vitest";
import { PATHS, moreInFive, railOrder, redirectFor } from "../nav-defaults";

describe("nav defaults", () => {
  it("orders the rail by role", () => {
    expect(railOrder("owner", false)).toEqual(["portfolio", "objects", "work", "monitor"]);
    expect(railOrder("owner", true).at(-1)).toBe("load");
    expect(railOrder("steward", false)).toEqual(["portfolio", "work", "objects", "monitor", "load"]);
    expect(railOrder("lead", false)[1]).toBe("load");
    expect(railOrder("basis", false)).toEqual(["portfolio", "more", "objects", "monitor", "work"]);
    expect(moreInFive(railOrder("admin", false))).toBe(true);
    expect(moreInFive(railOrder("lead", false))).toBe(false);
  });
  it("redirects old addresses and leaves the rest", () => {
    expect(redirectFor("/work")).toBe(PATHS.work);
    expect(redirectFor("/monitors")).toBe("/monitor?tab=learned");
    expect(redirectFor("/admin/users")).toBe("/more/admin/users");
    expect(redirectFor("/cleansing/")).toBe("/next/work/approve");
    expect(redirectFor("/work/analytics")).toBeNull();
    expect(redirectFor("/o/a/b")).toBeNull();
    expect(redirectFor("/s/abc")).toBeNull();
  });
});
