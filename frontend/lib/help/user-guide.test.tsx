import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GLOSSARY } from "./glossary";
import { Markdown, parseMarkdown } from "./markdown";
import { GUIDE_PAGES, GUIDE_SECTIONS, guideNeighbours, guidePageFor } from "./user-guide";

const DIR = path.resolve(__dirname, "..", "..", "docs", "user-guide");

describe("user guide", () => {
  const manifest = JSON.parse(readFileSync(path.join(DIR, "index.json"), "utf8")) as { sections: { title: string; pages: { slug: string; title: string }[] }[] };

  it("reads its sections and chapters from index.json, with a file for each and no others", () => {
    expect(GUIDE_SECTIONS.map((s) => s.title)).toEqual(["Getting started", "Daily work", "More", "Reference"]);
    expect(GUIDE_PAGES).toEqual(manifest.sections.flatMap((s) => s.pages));
    expect(readdirSync(DIR).filter((f) => f.endsWith(".md")).sort()).toEqual(GUIDE_PAGES.map((p) => `${p.slug}.md`).sort());
  });

  it.each(GUIDE_PAGES.map((p) => [p.slug, p.title]))("%s opens with its title and is a full chapter of plain prose", (slug, title) => {
    const text = readFileSync(path.join(DIR, `${slug}.md`), "utf8");
    expect(text.split("\n")[0]).toBe(`# ${title}`);
    const words = text.replace(/[#*`>\-[\]()]/g, " ").split(/\s+/).filter(Boolean).length;
    expect(words).toBeGreaterThanOrEqual(400);
    // literal values such as `/objects/<object>` or `https://` may appear inside inline code; prose may not hold them
    const prose = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
    expect(prose).not.toMatch(/https?:\/\//);
    // the renderer supports no tables, images, blockquotes or HTML
    expect(prose).not.toMatch(/^\s*\|.*\|\s*$/m);
    expect(prose).not.toMatch(/!\[|^>\s|<[a-z]+[\s>]/im);
  });

  it("keeps identifiers in inline code, so no snake_case word reaches the page as prose", () => {
    for (const p of GUIDE_PAGES) {
      const prose = readFileSync(path.join(DIR, `${p.slug}.md`), "utf8").replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "").replace(/\]\([^)]*\)/g, "]");
      expect(prose.match(/\b[a-z]+_[a-z]+\b/g) ?? [], p.slug).toEqual([]);
    }
  });

  it("links only to guide pages and routes inside the app", () => {
    for (const p of GUIDE_PAGES) {
      const text = readFileSync(path.join(DIR, `${p.slug}.md`), "utf8");
      for (const m of text.matchAll(/\]\(([^)]+)\)/g)) {
        expect(m[1].startsWith("/"), m[1]).toBe(true);
        const page = /^\/docs\?page=([\w-]+)$/.exec(m[1])?.[1];
        if (page) expect(GUIDE_PAGES.some((g) => g.slug === page), m[1]).toBe(true);
      }
    }
  });

  it("is reachable from every glossary entry's learn more link", () => {
    for (const e of Object.values(GLOSSARY)) {
      const page = /^\/docs\?page=([\w-]+)$/.exec(e.href ?? "")?.[1];
      if (page) expect(GUIDE_PAGES.some((g) => g.slug === page), e.href).toBe(true);
    }
  });

  it("falls back to the first chapter for an unknown or missing slug, and knows each chapter's neighbours", () => {
    expect(guidePageFor("rules").slug).toBe("rules");
    expect(guidePageFor("nope").slug).toBe("welcome");
    expect(guidePageFor(undefined).slug).toBe("welcome");
    expect(guideNeighbours("welcome")).toEqual({ prev: undefined, next: GUIDE_PAGES[1] });
    expect(guideNeighbours("glossary").next).toBeUndefined();
  });
});

describe("markdown renderer", () => {
  it("parses headings, paragraphs, lists and code", () => {
    const blocks = parseMarkdown("# Title\n\nSome\ntext.\n\n- a\n- b\n\n1. one\n2. two\n\n```\ncode\n```\n");
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "list", "list", "code"]);
    expect(blocks[1]).toEqual({ kind: "paragraph", text: "Some text." });
    expect(blocks[3]).toEqual({ kind: "list", ordered: true, items: ["one", "two"] });
  });

  it("renders headings one level down because the shell owns h1 and the page header h2", () => {
    render(<Markdown source={"# Home\n\n## Section\n\nBody"} />);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 4, name: "Section" })).toBeInTheDocument();
  });

  it("renders inline code, bold and relative links, and drops external link targets", () => {
    render(<Markdown source={"Press `?` for **help**, see [rules](/docs?page=rules) or [outside](https://example.com)."} />);
    expect(screen.getByText("?").tagName).toBe("CODE");
    expect(screen.getByText("help").tagName).toBe("STRONG");
    expect(screen.getByRole("link", { name: "rules" })).toHaveAttribute("href", "/docs?page=rules");
    expect(screen.getByRole("link", { name: "rules" })).toHaveStyle({ color: "var(--m-accent)", textDecoration: "underline" });
    expect(screen.queryByRole("link", { name: "outside" })).toBeNull();
    expect(screen.getByText(/outside/)).toBeInTheDocument();
  });

  it("renders bullet and numbered lists", () => {
    render(<Markdown source={"- one\n- two\n\n1. first\n2. second"} />);
    expect(screen.getAllByRole("list")).toHaveLength(2);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });
});
