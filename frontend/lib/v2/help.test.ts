import { describe, expect, it } from "vitest";
import data from "./help-data.json";
import { buildHelpIndex, sectionsOf } from "../../scripts/help-index.mjs";
import { appliesTo, diagnosticsRef, diagnosticsText, orderFor, screenOf, screensFor, searchHelp, snippet, type HelpChapter } from "./help";

const chapters = data.chapters as unknown as HelpChapter[];
const diag = { version: "0.1.1", tenant: "Demo Corp", tenantId: "t-demo", licence: "enterprise, active", user: "a@demo.example", screen: "/v2/admin/users", time: "2026-10-29T09:30:00.000Z", browser: "Test" };

describe("the help index", () => {
  it("is the one the build script writes from docs/help-centre and docs/user-guide", () => {
    expect(JSON.parse(JSON.stringify(buildHelpIndex()))).toEqual(data);
  });

  it("holds every help-centre chapter with its recording, and every user-guide page", () => {
    expect(chapters.filter((c) => c.kind === "journey")).toHaveLength(17);
    expect(chapters.filter((c) => c.kind === "guide")).toHaveLength(18);
    expect(chapters.filter((c) => c.kind === "journey").every((c) => c.video?.startsWith("help-"))).toBe(true);
    expect(chapters.every((c) => c.sections.length > 0 && c.title && c.summary)).toBe(true);
  });

  it("splits a chapter at its second-level headings and keeps the lead", () => {
    expect(sectionsOf("# T\n\nLead text.\n\n## One\n\nA.\n\n## Two\n\nB.\n")).toEqual([
      { heading: "", text: "Lead text." },
      { heading: "One", text: "A." },
      { heading: "Two", text: "B." },
    ]);
  });
});

describe("which chapters apply to which canvas", () => {
  it("reads the canvas from the address", () => {
    expect(screenOf("/v2")).toBe("landscape");
    expect(screenOf("/v2/o/ecc-production/material-master/rules")).toBe("object");
    expect(screenOf("/v2/r/MM031")).toBe("rule");
    expect(screenOf("/v2/work")).toBe("work");
    expect(screenOf("/v2/runs")).toBe("runs");
    expect(screenOf("/v2/run/abc/vs/def")).toBe("runs");
    expect(screenOf("/v2/s/a1")).toBe("system");
    expect(screenOf("/v2/admin/users")).toBe("admin");
    expect(screenOf("/v2/reports")).toBe("reports");
    expect(screenOf("/inbox")).toBeNull();
  });

  it("every chapter names at least one canvas it applies to", () => {
    for (const c of chapters) expect(screensFor(c.id).length, c.id).toBeGreaterThan(0);
  });

  it("puts the chapters for the canvas first, the one written for it before one that only touches it", () => {
    const admin = orderFor(chapters, "admin");
    const here = admin.filter((c) => appliesTo(c.id, "admin"));
    expect(admin.slice(0, here.length)).toEqual(here);
    expect(admin[0].id).toBe("journey:admin-users");
    expect(admin.indexOf(chapters.find((c) => c.id === "journey:basis-operations") as HelpChapter)).toBeGreaterThan(admin.indexOf(chapters.find((c) => c.id === "guide:admin") as HelpChapter));
    expect(orderFor(chapters, "work")[0].id).toBe("journey:first-fix");
    expect(orderFor(chapters, "work").slice(0, 3).map((c) => c.id)).toContain("journey:steward-work");
    expect(orderFor(chapters, null)).toEqual(chapters);
    expect(orderFor(chapters, "reports").slice(0, 2).map((c) => c.id)).toContain("journey:lead-reporting");
  });
});

describe("searching help", () => {
  it("needs every word, finds them in the text and puts a title match first", () => {
    const hits = searchHelp(chapters, "golden record");
    expect(hits[0].chapter.id).toBe("journey:golden-records");
    expect(hits.map((h) => h.chapter.id)).toContain("guide:mdm");
    expect(hits.every((h) => h.sections.length > 0)).toBe(true);
    expect(searchHelp(chapters, "zzzqq")).toEqual([]);
    expect(searchHelp(chapters, "  ")).toHaveLength(chapters.length);
  });

  it("quotes a passage around the match", () => {
    const text = `${"filler words ".repeat(20)}the board pack goes to the committee${" more words".repeat(20)}`;
    const out = snippet(text, "board pack");
    expect(out).toContain("board pack");
    expect(out.startsWith("…")).toBe(true);
    expect(out.length).toBeLessThan(160);
  });
});

describe("the support block", () => {
  it("holds the version, tenant, licence, user, screen and time, and no record values", () => {
    const text = diagnosticsText(diag);
    expect(text).toContain("Meridian 0.1.1");
    expect(text).toContain("Tenant: Demo Corp (t-demo)");
    expect(text).toContain("Screen: /v2/admin/users");
    expect(text.split("\n")).toHaveLength(7);
  });

  it("has a reference that is the same for the same moment and different for another screen", () => {
    expect(diagnosticsRef(diag)).toMatch(/^MN-[0-9A-F]{4}-1029$/);
    expect(diagnosticsRef(diag)).toBe(diagnosticsRef({ ...diag }));
    expect(diagnosticsRef({ ...diag, screen: "/v2/work" })).not.toBe(diagnosticsRef(diag));
  });
});
