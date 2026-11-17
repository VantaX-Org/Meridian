import { describe, expect, it } from "vitest";
import { ADMIN_SECTIONS, canAdminister, isAdminSlug, visibleSections } from "./admin-sections";

describe("ADMIN_SECTIONS", () => {
  it("has unique slugs and every section reads a label, a group and a lead", () => {
    const slugs = ADMIN_SECTIONS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of ADMIN_SECTIONS) {
      expect(s.label.trim(), s.slug).not.toBe("");
      expect(s.group.trim(), s.slug).not.toBe("");
      expect(s.lead.trim(), s.slug).not.toBe("");
      expect(s.needs.length, s.slug).toBeGreaterThan(0);
    }
  });

  it("knows its own slugs only", () => {
    expect(isAdminSlug("users")).toBe(true);
    expect(isAdminSlug("aletheia")).toBe(true);
    expect(isAdminSlug("nope")).toBe(false);
  });

  it("shows a viewer only the sections one of their permissions opens", () => {
    const can = (a: string) => a === "manage_rules";
    const slugs = visibleSections(can).map((s) => s.slug);
    expect(slugs).toContain("matchrules");
    expect(slugs).toContain("rulesio");
    expect(slugs).not.toContain("users");
    expect(visibleSections(() => false)).toEqual([]);
  });

  it("does not count read-only view as administering", () => {
    expect(canAdminister((a) => a === "view")).toBe(false);
    expect(canAdminister((a) => a === "manage_users")).toBe(true);
    expect(canAdminister(() => false)).toBe(false);
  });
});
