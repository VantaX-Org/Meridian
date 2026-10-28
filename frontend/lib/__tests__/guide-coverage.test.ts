// Every page the To do, monitoring, sign-in and alerts work added is described in a user guide chapter that links
// to it, and every nav page keeps a one-line description for All features (FEATURE_DESC).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FEATURE_DESC, INDEX_ONLY_GROUPS, NAV_GROUPS, flattenNav } from "../nav";

const DIR = path.resolve(__dirname, "../../docs/user-guide");
const guide = readdirSync(DIR).filter((f) => f.endsWith(".md")).map((f) => ({ f, text: readFileSync(path.join(DIR, f), "utf8") }));

describe("user guide coverage", () => {
  it.each(["/attention", "/admin/alerts", "/admin/sign-in", "/rules/scoring", "/objects?view=monitoring"])("links to %s from a chapter", (href) => {
    expect(guide.some((g) => g.text.includes(`](${href})`)), href).toBe(true);
  });

  it("has a chapter for monitoring and one for the To do list", () => {
    expect(guide.map((g) => g.f)).toEqual(expect.arrayContaining(["monitoring.md", "todo.md"]));
  });

  it("describes every nav page, and only object monitoring uses the word monitor", () => {
    const hrefs = [...NAV_GROUPS, ...INDEX_ONLY_GROUPS].flatMap((g) => flattenNav(g.items).map((i) => i.href));
    for (const h of hrefs) expect(FEATURE_DESC[h], h).toBeTruthy();
    for (const [h, d] of Object.entries(FEATURE_DESC)) if (/monitor/i.test(d)) expect(h, d).toBe("/objects");
  });
});
