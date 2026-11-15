import { describe, expect, it } from "vitest";
import { redirectFor } from "../nav-defaults";
import { isNativePath } from "@/design/next/shell/LegacyFrame";

describe("one interface", () => {
  it("sends object pages to the new object screen and keeps deep pages", () => {
    expect(redirectFor("/o/sys/material_master")).toBe("/next/o/sys/material_master");
    expect(redirectFor("/o/sys/material_master/rules")).toBe("/next/o/sys/material_master/rules");
    expect(redirectFor("/o/sys/material_master/records/K1")).toBeNull();
    expect(redirectFor("/objects")).toBe("/");
  });
  it("mounts only rebuilt pages without the legacy frame", () => {
    expect(isNativePath("/")).toBe(true);
    expect(isNativePath("/run/abc")).toBe(true);
    expect(isNativePath("/catalogue")).toBe(false);
  });
});
