import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import data from "./help-data.json";
import tours from "../../docs/guide/tours.json";
import { buildHelpIndex, orderWhatsNew, sectionsOf, stepRank } from "../../scripts/help-index.mjs";
import { toVtt, vttTime } from "../../scripts/help-videos.mjs";
import {
  appliesTo, chapterFor, diagnosticsRef, diagnosticsText, FROM_RECORDING, isHere, orderFor, ROUTE_CHAPTERS, routeOf, screenOf, screensFor, searchHelp, snippet, videoUrl, walkthroughFor,
  type HelpChapter, type WhatsNewEntry,
} from "./help";

const chapters = data.chapters as unknown as HelpChapter[];
const v2 = chapters.filter((c) => c.interface === "v2");
const whatsNew = data.whatsNew as WhatsNewEntry[];
const byId = (id: string) => chapters.find((c) => c.id === id) as HelpChapter;
const diag = { version: "0.1.1", tenant: "Demo Corp", tenantId: "t-demo", licence: "enterprise, active", user: "a@demo.example", screen: "/admin/users", time: "2026-10-29T09:30:00.000Z", browser: "Test" };

const ROOT = path.join(__dirname, "..", "..");
const APP = path.join(ROOT, "app", "(v2)");
const MANIFEST = path.join(ROOT, "docs", "help-videos", "manifest.json");

/** Every page.tsx under app/(v2) as its route pattern: "/o/[system]/[module]/golden". */
function v2Routes(dir = APP, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) v2Routes(p, out);
    else if (name === "page.tsx") out.push(`/${path.relative(APP, path.dirname(p)).split(path.sep).join("/")}`);
  }
  return out.sort();
}
/** An address for a route pattern, with sample values in its brackets. */
const sample = (route: string) => route.replace("[system]", "ecc-production").replace("[module]", "material-master").replace("[section]", "users").replace("[token]", "fx-token").replace("[b]", "r2").replace("[id]", "r1");

describe("the help index", () => {
  it("is the one the build script writes from docs/guide", () => {
    expect(JSON.parse(JSON.stringify(buildHelpIndex()))).toEqual(data);
  });

  it("lists the guide's chapters and nothing of the retired interface", () => {
    expect(v2).toHaveLength(26);
    expect(chapters).toHaveLength(26);
    expect(chapters.every((c) => c.kind === "v2" && c.interface === "v2")).toBe(true);
    expect(chapters.every((c) => c.sections.length > 0 && c.title && c.summary)).toBe(true);
  });

  it("has a chapter per canvas and a walkthrough per role", () => {
    for (const slug of ["landscape", "object", "rules", "work", "approvals", "people", "runs", "run-compare", "systems", "golden-records", "glossary", "lineage", "processes", "schedules", "waves", "administration", "preferences", "keyboard"]) {
      expect(byId(`v2:${slug}`), slug).toBeDefined();
    }
    const walks = v2.filter((c) => c.walkthrough);
    expect(walks.map((c) => c.persona).sort()).toEqual(["admin", "auditor", "basis", "lead", "owner", "process", "steward"]);
  });

  it("every chapter says what the screen is for, its numbers, the verbs by role, the keys and what to do when something is wrong", () => {
    for (const c of v2.filter((x) => !x.walkthrough && x.slug !== "overview")) {
      const headings = c.sections.map((s) => s.heading);
      expect(headings, c.id).toContain("When something is wrong");
      if (c.slug !== "keyboard") expect(headings, c.id).toContain("Keyboard");
      expect(headings.some((h) => /by role/.test(h)), c.id).toBe(true);
      expect(headings.some((h) => /numbers|receipt|come from/i.test(h)), c.id).toBe(true);
    }
  });

  it("splits a chapter at its second-level headings and keeps the lead", () => {
    expect(sectionsOf("# T\n\nLead text.\n\n## One\n\nA.\n\n## Two\n\nB.\n")).toEqual([
      { heading: "", text: "Lead text." },
      { heading: "One", text: "A." },
      { heading: "Two", text: "B." },
    ]);
  });
});

describe("every v2 route has a chapter", () => {
  const routes = v2Routes();

  it("finds the pages of app/(v2)", () => {
    expect(routes.length).toBeGreaterThanOrEqual(25);
    expect(routes).toContain("/o/[system]/[module]/golden");
  });

  it.each(v2Routes())("%s maps to a Meridian 2 chapter that exists", (route) => {
    const id = ROUTE_CHAPTERS[route];
    expect(id, `${route} has no chapter in ROUTE_CHAPTERS`).toBeDefined();
    expect(byId(id)?.interface).toBe("v2");
    expect(routeOf(sample(route))).toBe(route);
    expect(chapterFor(sample(route))).toBe(id);
  });

  it("an open panel or a ledger filter names its own chapter", () => {
    expect(chapterFor("/", "?open=preferences")).toBe("v2:preferences");
    expect(chapterFor("/", "open=waves")).toBe("v2:waves");
    expect(chapterFor("/", "view=waves")).toBe("v2:waves");
    expect(chapterFor("/work", "filter=approvals")).toBe("v2:approvals");
    expect(chapterFor("/work", "open=batch:B-241")).toBe("v2:approvals");
    expect(chapterFor("/o/ecc-production/material-master/golden", "open=survivorship:material_master")).toBe("v2:golden-records");
    expect(chapterFor("/work", "open=help")).toBe("v2:work");
    expect(chapterFor("/inbox")).toBeNull();
  });
});

describe("every chapter has a recording", () => {
  const list = (tours as { tours: { video: string; chapter: string; steps: { caption: string }[] }[] }).tours;

  it("each Meridian 2 chapter names a recording with a tour of its own, and its captions are in the index", () => {
    for (const c of v2) {
      expect(c.video, c.id).toMatch(/^guide2-[a-z0-9-]+$/);
      const tour = list.find((t) => t.video === c.video);
      expect(tour, `${c.id} has no tour`).toBeDefined();
      expect(tour?.chapter).toBe(c.slug);
      expect(tour?.steps.length ?? 0).toBeGreaterThanOrEqual(5);
      expect(c.captions).toEqual(tour?.steps.map((s) => s.caption));
    }
    expect(new Set(list.map((t) => t.video)).size).toBe(list.length);
  });

  it("each recording that has been made is in the manifest with its length, and the overview runs about three minutes", () => {
    if (!existsSync(MANIFEST)) return;
    const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")).videos as Record<string, { seconds: number; bytes: number }>;
    for (const c of v2) {
      const m = manifest[c.video as string];
      expect(m, `${c.video} is not recorded`).toBeDefined();
      expect(c.seconds).toBe(m.seconds);
      expect(m.seconds, c.id).toBeGreaterThan(c.slug === "overview" ? 150 : 40);
      expect(m.seconds, c.id).toBeLessThan(c.slug === "overview" ? 240 : 150);
    }
  });

  it("serves the recording, its poster and its captions from one place", () => {
    expect(videoUrl("guide2-work", "mp4")).toBe("/api/v1/docs/help-videos/guide2-work.mp4");
    expect(videoUrl("guide2-work", "jpg")).toBe("/api/v1/docs/help-videos/guide2-work.jpg");
    expect(videoUrl("guide2-work", "vtt")).toBe("/api/v1/docs/help-videos/guide2-work.vtt");
  });

  it("writes the captions as WebVTT, one cue per step, never overlapping", () => {
    expect(vttTime(75.5)).toBe("00:01:15.500");
    const vtt = toVtt([{ start: 0.2, end: 5.1, text: "One." }, { start: 5, end: 9, text: "Two." }]);
    expect(vtt.startsWith("WEBVTT\n")).toBe(true);
    expect(vtt).toContain("00:00:00.200 --> 00:00:05.000\nOne.");
    expect(vtt).toContain("00:00:05.000 --> 00:00:09.000\nTwo.");
  });
});

describe("which chapters come first", () => {
  it("reads the canvas from the address", () => {
    expect(screenOf("/")).toBe("landscape");
    expect(screenOf("/o/ecc-production/material-master/rules")).toBe("object");
    expect(screenOf("/r/MM031")).toBe("rule");
    expect(screenOf("/work")).toBe("work");
    expect(screenOf("/run/abc/vs/def")).toBe("runs");
    expect(screenOf("/s/a1")).toBe("system");
    expect(screenOf("/admin/users")).toBe("admin");
    expect(screenOf("/inbox")).toBeNull();
  });

  it("every chapter names at least one canvas it applies to", () => {
    for (const c of chapters) expect(screensFor(c.id).length, c.id).toBeGreaterThan(0);
  });

  it("on the start screen the role's walkthrough comes first, then the landscape chapter", () => {
    const ctx = { pathname: "/", search: "", walkthrough: walkthroughFor("steward", null) };
    const order = orderFor(chapters, "landscape", ctx);
    expect(order.slice(0, 2).map((c) => c.id)).toEqual(["v2:persona-steward", "v2:landscape"]);
    expect(isHere(order[0], "landscape", ctx)).toBe(true);
    expect(walkthroughFor("lead", "auditor")).toBe("v2:persona-auditor");
    expect(walkthroughFor("lead", "viewer")).toBe("v2:persona-auditor");
    expect(walkthroughFor("lead", "platform_admin")).toBe("v2:persona-admin");
    expect(walkthroughFor("basis", "sap_basis")).toBe("v2:persona-basis");
  });

  it("elsewhere the route's chapter comes first, then the chapters for this canvas", () => {
    const golden = orderFor(chapters, "object", { pathname: "/o/ecc-production/material-master/golden", walkthrough: "v2:persona-lead" });
    expect(golden[0].id).toBe("v2:golden-records");
    expect(golden).toHaveLength(v2.length);
    expect(orderFor(chapters, "admin", { pathname: "/admin/users" })[0].id).toBe("v2:administration");
    expect(orderFor(chapters, "work", { pathname: "/work", search: "filter=approvals" })[0].id).toBe("v2:approvals");
    const plain = orderFor(chapters, "work");
    expect(plain.filter((c) => appliesTo(c.id, "work"))).toEqual(plain.slice(0, plain.filter((c) => appliesTo(c.id, "work")).length));
  });
});

describe("searching help", () => {
  it("needs every word, finds them in the text and puts a title match first", () => {
    const hits = searchHelp(chapters, "golden records");
    expect(hits[0].chapter.id).toBe("v2:golden-records");
    expect(hits.map((h) => h.chapter.id)).toContain("v2:persona-owner");
    expect(hits.every((h) => h.sections.length > 0)).toBe(true);
    expect(searchHelp(chapters, "zzzqq")).toEqual([]);
    expect(searchHelp(chapters, "  ")).toHaveLength(chapters.length);
  });

  it("finds words said only in a recording's captions, and says so", () => {
    const word = "slash";
    const inText = chapters.filter((c) => `${c.title} ${c.summary} ${c.sections.map((s) => s.text).join(" ")}`.toLowerCase().includes(word));
    expect(inText.map((c) => c.id)).not.toContain("v2:overview");
    const hit = searchHelp(chapters, word).find((h) => h.chapter.id === "v2:overview");
    expect(hit?.sections[0]).toEqual({ heading: FROM_RECORDING, text: expect.stringContaining("slash") });
  });

  it("quotes a passage around the match", () => {
    const text = `${"filler words ".repeat(20)}the board pack goes to the committee${" more words".repeat(20)}`;
    const out = snippet(text, "board pack");
    expect(out).toContain("board pack");
    expect(out.startsWith("…")).toBe(true);
    expect(out.length).toBeLessThan(160);
  });
});

describe("what's new", () => {
  it("has one dated line for each step from 0 to the cut-over (7), newest first", () => {
    expect(whatsNew.map((w) => w.step)).toEqual(["7", "6c", "6b", "6", "5", "4", "3", "2", "1", "0"]);
    for (const w of whatsNew) {
      expect(w.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(w.text).not.toContain("\n");
      expect(w.text.length).toBeLessThan(260);
    }
    for (let i = 1; i < whatsNew.length; i++) expect(whatsNew[i - 1].date >= whatsNew[i].date).toBe(true);
  });

  it("orders by date, then by step", () => {
    expect(stepRank("6c")).toBeGreaterThan(stepRank("6b"));
    expect(stepRank("6b")).toBeGreaterThan(stepRank("6"));
    expect(stepRank("10")).toBeGreaterThan(stepRank("9"));
    const out = orderWhatsNew([{ step: "1", date: "2026-10-01" }, { step: "2", date: "2026-10-01" }, { step: "0", date: "2026-10-02" }]);
    expect(out.map((w: { step: string }) => w.step)).toEqual(["0", "2", "1"]);
  });
});

describe("the support block", () => {
  it("holds the version, tenant, licence, user, screen and time, and no record values", () => {
    const text = diagnosticsText(diag);
    expect(text).toContain("Meridian 0.1.1");
    expect(text).toContain("Tenant: Demo Corp (t-demo)");
    expect(text).toContain("Screen: /admin/users");
    expect(text.split("\n")).toHaveLength(7);
  });

  it("has a reference that is the same for the same moment and different for another screen", () => {
    expect(diagnosticsRef(diag)).toMatch(/^MN-[0-9A-F]{4}-1029$/);
    expect(diagnosticsRef(diag)).toBe(diagnosticsRef({ ...diag }));
    expect(diagnosticsRef({ ...diag, screen: "/work" })).not.toBe(diagnosticsRef(diag));
  });
});
