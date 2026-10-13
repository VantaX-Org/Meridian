import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GLOSSARY } from "./glossary";
import { Markdown, parseMarkdown } from "./markdown";
import { GUIDE_PAGES, guidePageFor } from "./user-guide";

const DIR = path.resolve(__dirname, "..", "..", "docs", "user-guide");

describe("user guide", () => {
  it("has one page per workspace, and a file for each", () => {
    expect(GUIDE_PAGES.map((p) => p.title)).toEqual(["Home", "Systems", "Objects", "Runs", "Rules", "Insights", "Master data", "Migration", "Inbox", "Fix", "Admin"]);
    expect(readdirSync(DIR).sort()).toEqual(GUIDE_PAGES.map((p) => `${p.slug}.md`).sort());
  });

  it.each(GUIDE_PAGES.map((p) => p.slug))("%s is 150 to 300 words of plain prose", (slug) => {
    const text = readFileSync(path.join(DIR, `${slug}.md`), "utf8");
    const words = text.replace(/[#*`>\-[\]()]/g, " ").split(/\s+/).filter(Boolean).length;
    expect(words).toBeGreaterThanOrEqual(150);
    expect(words).toBeLessThanOrEqual(300);
    expect(text).not.toMatch(/https?:\/\//);
  });

  it("links only to guide pages and routes inside the app", () => {
    for (const p of GUIDE_PAGES) {
      const text = readFileSync(path.join(DIR, `${p.slug}.md`), "utf8");
      for (const m of text.matchAll(/\]\(([^)]+)\)/g)) {
        expect(m[1].startsWith("/"), m[1]).toBe(true);
        const page = /^\/docs\?page=(\w+)$/.exec(m[1])?.[1];
        if (page) expect(GUIDE_PAGES.some((g) => g.slug === page), m[1]).toBe(true);
      }
    }
  });

  it("is reachable from every glossary entry's learn more link", () => {
    for (const e of Object.values(GLOSSARY)) {
      const page = /^\/docs\?page=(\w+)$/.exec(e.href ?? "")?.[1];
      if (page) expect(GUIDE_PAGES.some((g) => g.slug === page), e.href).toBe(true);
    }
  });

  it("falls back to the first page for an unknown or missing slug", () => {
    expect(guidePageFor("rules").slug).toBe("rules");
    expect(guidePageFor("nope").slug).toBe("home");
    expect(guidePageFor(undefined).slug).toBe("home");
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
    expect(screen.queryByRole("link", { name: "outside" })).toBeNull();
    expect(screen.getByText(/outside/)).toBeInTheDocument();
  });

  it("renders bullet and numbered lists", () => {
    render(<Markdown source={"- one\n- two\n\n1. first\n2. second"} />);
    expect(screen.getAllByRole("list")).toHaveLength(2);
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });
});
