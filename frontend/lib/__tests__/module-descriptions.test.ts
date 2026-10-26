import { describe, expect, it } from "vitest";
import { MODULE_DESCRIPTIONS, MODULE_LABELS, moduleDescription } from "@/lib/format";

describe("MODULE_DESCRIPTIONS", () => {
  it("describes only named objects, in full sentences", () => {
    for (const [id, text] of Object.entries(MODULE_DESCRIPTIONS)) {
      expect(MODULE_LABELS[id], id).toBeTruthy();
      expect(text, id).toMatch(/^[A-Z].*\.$/);
    }
  });

  it("returns undefined for an object with no description", () => {
    expect(moduleDescription("fi_gl")).toContain("chart of accounts");
    expect(moduleDescription("no_such_module")).toBeUndefined();
  });
});
