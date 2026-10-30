// @vitest-environment node
import { describe, expect, it } from "vitest";
// The extraction script is the CI gate for v2 strings: every visible literal goes through t(), every key is in the
// English catalogue, and German and Japanese translate all of them.
import { extract } from "../../../../scripts/i18n-extract.mjs";
import { isProse } from "../../../../scripts/i18n-rules.mjs";

describe("v2 message extraction", () => {
  const r = extract();

  it("finds no user-visible literal outside t() in design/v2, app/(v2) and lib/v2", () => {
    const list = r.untranslated.map((u: { at: string; kind: string; text: string }) => `${u.at} ${u.kind}: ${u.text}`);
    expect(list, "Wrap these in t() and run node scripts/i18n-extract.mjs --write").toEqual([]);
  });

  it("finds every t() key in the English catalogue", () => {
    expect(r.missing).toEqual([]);
    expect(r.keys.size).toBeGreaterThan(2000);
  });

  it("finds a German and a Japanese translation for every key", () => {
    expect(r.gaps).toEqual([]);
  });

  it("tells prose from identifiers, paths, classes and SAP names", () => {
    for (const s of ["Save the mapping", "Users", "Sign-in", "No run yet"]) expect(isProse(s), s).toBe(true);
    for (const s of ["MARA.MEINS", "material_master", "m2-btn m2-sm", "/work", "MM014", "data-testid", "mod+k", "repeat(3, minmax(0, 1fr))", "image/svg+xml"]) expect(isProse(s), s).toBe(false);
  });
});
