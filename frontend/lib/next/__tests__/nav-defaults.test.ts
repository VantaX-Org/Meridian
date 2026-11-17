import { describe, expect, it } from "vitest";
import { PATHS, TABS } from "../nav-defaults";

describe("nav defaults", () => {
  it("has five tabs", () => {
    expect(TABS.map((t) => PATHS[t])).toEqual(["/", "/work", "/load", "/runs", "/admin"]);
  });
});
