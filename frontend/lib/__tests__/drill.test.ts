import { describe, expect, it } from "vitest";
import { drillLabel, fixHref } from "../drill";

describe("fixHref", () => {
  it("is the bare fix list without filters", () => {
    expect(fixHref()).toBe("/fix");
    expect(fixHref({ module: "", check: undefined })).toBe("/fix");
  });

  it("writes the contract's params in a stable order", () => {
    expect(fixHref({ check: "MM_001", module: "material_master", sev: "Critical" })).toBe("/fix?module=material_master&check=MM_001&sev=critical");
  });

  it("leaves the default status off and keeps the others", () => {
    expect(fixHref({ st: "open" })).toBe("/fix");
    expect(fixHref({ st: "fixed" })).toBe("/fix?st=fixed");
  });

  it("encodes a key field part", () => {
    expect(fixHref({ part: "BUKRS=1000" })).toBe("/fix?part=BUKRS%3D1000");
    expect(fixHref({ module: "fi_gl", part: { field: "WERKS", value: "30 00" } })).toBe("/fix?module=fi_gl&part=WERKS%3D30+00");
  });

  it("carries blocking severity, every status and a source system", () => {
    expect(fixHref({ sev: "blocking", st: "all", system: "S1" })).toBe("/fix?sev=blocking&st=all&system=S1");
  });

  it("carries flags, assignee, record and run", () => {
    expect(fixHref({ run: "v1", mine: true, sugg: true, due: "overdue", assignee: "u-1" })).toBe("/fix?run=v1&mine=1&assignee=u-1&sugg=1&due=overdue");
    expect(fixHref({ record: { module: "material_master", key: "MATNR=1|WERKS=2" } })).toBe("/fix?record=material_master%7CMATNR%3D1%7CWERKS%3D2");
  });
});

describe("drillLabel", () => {
  it("says what opens", () => {
    expect(drillLabel({ count: 1204, sev: "critical", module: "material_master" })).toBe("Open the 1,204 critical records of material master");
    expect(drillLabel({ count: 1, check: "MM_001" })).toBe("Open the 1 record of rule MM_001");
    expect(drillLabel({ count: 3, module: "fi_gl" })).toBe("Open the 3 records of FI general ledger");
    expect(drillLabel({ what: "fixed records" })).toBe("Open the fixed records");
  });
});
