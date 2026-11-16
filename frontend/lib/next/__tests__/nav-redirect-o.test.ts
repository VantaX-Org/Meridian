import { describe, expect, it } from "vitest";
import { redirectFor } from "../nav-defaults";

describe("one interface", () => {
  it("sends object pages to the new object screen including deep pages", () => {
    expect(redirectFor("/o/sys/material_master")).toBe("/next/o/sys/material_master");
    expect(redirectFor("/o/sys/material_master/rules")).toBe("/next/o/sys/material_master/rules");
    expect(redirectFor("/o/sys/material-master/records/MATNR%3D1")).toBe("/next/o/sys/material-master/records?open=record:material_master:MATNR%3D1");
    expect(redirectFor("/o/sys/material_master/processes/design")).toBe("/next/o/sys/material_master/processes/design");
    expect(redirectFor("/objects")).toBe("/");
  });
});
