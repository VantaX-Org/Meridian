/**
 * The help-centre registry and its chapters: every chapter in index.json has a markdown file that
 * obeys the renderer's subset and the house voice, every audience is a real role key, every video
 * name is kebab-case and unique, and every link is internal to the app. The markdown renderer
 * (lib/help/markdown.tsx) silently drops anything it does not understand — a typo in a chapter is
 * invisible at runtime, so it is checked here instead.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { chapterFor, chapterIsFor, chapterNeighbours, HELP_CHAPTERS, HELP_SECTIONS } from "./journeys";
import { ROLES } from "@/hooks/use-role";

const DIR = path.join(__dirname, "../../docs/help-centre");

/** The hrefs a help chapter may link to (routes that exist for a signed-in user). */
const LINK_ALLOWLIST = new Set([
  "/home", "/fix", "/fix/what-if", "/inbox", "/inbox/notifications", "/objects", "/runs", "/systems", "/process",
  "/rules", "/rules/drafts", "/rules/learned", "/rules/scoring", "/rules/dictionary",
  "/insights/rules", "/insights/progress", "/insights/trends", "/insights/forecast", "/insights/duplicates",
  "/insights/exec", "/insights/owners", "/insights/reports",
  "/mdm", "/mdm/golden", "/mdm/golden/merge", "/mdm/survivorship", "/mdm/match-rules", "/mdm/glossary",
  "/admin/users", "/admin/roles", "/admin/settings", "/admin/licence", "/admin/audit", "/admin/triage",
  "/admin/jobs", "/admin/notifications", "/admin/reference", "/admin/billing", "/admin/mappings",
  "/me/preferences", "/search", "/docs", "/help", "/features",
]);

const FORBIDDEN = ["welcome to", "oops", "sorry", "whoops", "uh oh", "click here", "dashboard", "this page shows", "something went wrong"];

const source = (slug: string) => readFileSync(path.join(DIR, `${slug}.md`), "utf8");

describe("help centre registry", () => {
  it("has sections and chapters, and every chapter resolves", () => {
    expect(HELP_SECTIONS.length).toBeGreaterThanOrEqual(3);
    expect(HELP_CHAPTERS.length).toBeGreaterThanOrEqual(10);
    for (const c of HELP_CHAPTERS) {
      expect(chapterFor(c.slug)).toBe(c);
    }
    expect(chapterFor("does-not-exist")).toBe(HELP_CHAPTERS[0]);
  });

  it("uses only real role keys as audiences, and chapterIsFor follows them", () => {
    for (const c of HELP_CHAPTERS) {
      for (const a of c.audiences) {
        expect(ROLES).toContain(a);
      }
      expect(chapterIsFor(c, null)).toBe(c.audiences.length === 0);
    }
  });

  it("names every recording uniquely in kebab case", () => {
    const names = HELP_CHAPTERS.map((c) => c.video);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^help-[a-z0-9-]+$/);
  });

  it("reads prev/next in registry order", () => {
    const first = HELP_CHAPTERS[0];
    const second = HELP_CHAPTERS[1];
    expect(chapterNeighbours(first.slug).prev).toBeUndefined();
    expect(chapterNeighbours(first.slug).next).toBe(second);
    expect(chapterNeighbours(second.slug).prev).toBe(first);
    expect(chapterNeighbours(HELP_CHAPTERS[HELP_CHAPTERS.length - 1].slug).next).toBeUndefined();
  });
});

describe("help centre chapters", () => {
  it("has exactly one markdown file per chapter and no extras", () => {
    const onDisk = readdirSync(DIR).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort();
    expect(onDisk).toEqual([...HELP_CHAPTERS.map((c) => c.slug)].sort());
  });

  it.each(HELP_CHAPTERS.map((c) => [c.slug, c.title] as const))("%s obeys the renderer subset", (slug, title) => {
    const md = source(slug);
    const lines = md.split("\n");
    expect(lines[0]).toBe(`# ${title}`);
    expect(md.length).toBeGreaterThan(0);
    // length: enough to teach, short enough to read
    const words = md.split(/\s+/).length;
    expect(words, `${slug} is ${words} words`).toBeGreaterThanOrEqual(450);
    // the renderer understands: headings, paragraphs, lists, fenced code, inline code/bold, links
    expect(md, "tables").not.toMatch(/^\|/m);
    expect(md, "blockquote").not.toMatch(/^>/m);
    expect(md, "images").not.toMatch(/!\[/);
    expect(md, "raw html").not.toMatch(/<\w/);
    expect(md, "middle dot").not.toContain("\u00B7");
    const lower = md.toLowerCase();
    for (const bad of FORBIDDEN) expect(lower, bad).not.toContain(bad);
    // links: internal only, and within the routes that exist
    for (const m of md.matchAll(/\]\(([^)]+)\)/g)) {
      const href = m[1];
      expect(href.startsWith("/"), `external link ${href}`).toBe(true);
      const base = href.split("?")[0];
      expect(LINK_ALLOWLIST.has(base), `unknown route ${href}`).toBe(true);
    }
  });
});
