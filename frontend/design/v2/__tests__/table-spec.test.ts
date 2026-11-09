import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(join(__dirname, "..", "v2.css"), "utf8");

/** The declarations of the first rule whose selector is exactly `sel`. */
function rule(sel: string): string {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = styles.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`));
  expect(m, `${sel} is defined in v2.css`).not.toBeNull();
  return m![1];
}

describe("the one static table spec", () => {
  it("holds every table to the density tokens the Grid uses, not fixed pixels", () => {
    const tbl = rule(".m2-tbl");
    expect(tbl).toContain("font-size: var(--m2-row-fs)");
    expect(tbl).toContain("line-height: var(--m2-row-lh)");
    const td = rule(".m2-tbl td");
    expect(td).toContain("height: var(--m2-row-h)");
    expect(td).toMatch(/padding: var\(--m2-s1\) var\(--m2-cell-px\)/);
    const th = rule(".m2-tbl th");
    expect(th).toMatch(/padding: var\(--m2-s1\) var\(--m2-cell-px\)/);
    expect(th).toContain("font-weight: 500");
    // A row header in the body reads as a row, at the row's size and height.
    const bodyTh = rule(".m2-tbl tbody th");
    expect(bodyTh).toContain("font-size: var(--m2-row-fs)");
    expect(bodyTh).toContain("height: var(--m2-row-h)");
  });

  it("right-aligns numeric columns in tabular figures", () => {
    // .m2-num is the class most screens put on a numeric cell; it must align the same as .m2-r.
    expect(rule(".m2-tbl th.m2-r, .m2-tbl td.m2-r, .m2-tbl th.m2-num, .m2-tbl td.m2-num")).toMatch(/text-align: right;\s*font-variant-numeric: tabular-nums/);
  });

  it("aligns a plain head over a numeric column to the right", () => {
    // The shared Table builds heads from string labels, so the head follows the first body row's cell class.
    for (const n of [1, 2, 6, 12]) {
      expect(styles).toContain(`.m2-tbl:has(> tbody > tr:first-child > :nth-child(${n}):is(.m2-r, .m2-num)) > thead > tr:last-child > th:nth-child(${n})`);
    }
  });

  it("keeps a wide table scrolling inside itself on a phone, and numbers left in card rows", () => {
    const basis = readFileSync(join(__dirname, "..", "basis.css"), "utf8");
    const phone = basis.slice(basis.indexOf("@media (max-width: 760px)"));
    expect(phone).toMatch(/:is\(\.m2-tbl[^)]*\):not\(\.m2-cards\):not\(\.m2-frame \*\) \{ display: block; max-width: 100%; overflow-x: auto; \}/);
    expect(phone).toContain(".m2-cards td.m2-r, .m2-cards td.m2-num { text-align: left; }");
  });
});
