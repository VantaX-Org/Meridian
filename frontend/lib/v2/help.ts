/**
 * The help panel's data: the chapters of the help centre and the user guide (lib/v2/help-data.json, built by
 * scripts/help-index.mjs), which canvas each one applies to, search over them, and the diagnostics block for support.
 */
export interface HelpSection { heading: string; text: string }
export interface HelpChapter {
  id: string;
  kind: "journey" | "guide";
  group: string;
  slug: string;
  title: string;
  summary: string;
  audiences: string[];
  /** Base name of the training recording, served at /api/v1/docs/help-videos/{video}.mp4. */
  video: string | null;
  sections: HelpSection[];
}
export interface HelpIndex { title: string; guideTitle: string; chapters: HelpChapter[] }

let cached: Promise<HelpIndex> | null = null;
/** The index, loaded on first use so it is not part of the shell's first download. */
export function loadHelp(): Promise<HelpIndex> {
  cached ??= import("./help-data.json").then((m) => (m.default ?? m) as unknown as HelpIndex);
  return cached;
}

export type Screen = "landscape" | "object" | "rule" | "work" | "runs" | "system" | "people" | "admin" | "reports";

export const SCREEN_LABEL: Record<Screen, string> = {
  landscape: "Landscape",
  object: "An object",
  rule: "A rule",
  work: "Work",
  runs: "Runs",
  system: "A system",
  people: "People",
  admin: "Administration",
  reports: "Reports",
};

/** Which canvas the viewer is on, from the address. */
export function screenOf(pathname: string): Screen | null {
  if (pathname === "/v2" || pathname === "/v2/") return "landscape";
  if (pathname.startsWith("/v2/o/")) return "object";
  if (pathname.startsWith("/v2/r/")) return "rule";
  if (pathname.startsWith("/v2/work")) return "work";
  if (pathname.startsWith("/v2/run")) return "runs";
  if (pathname.startsWith("/v2/s/")) return "system";
  if (pathname.startsWith("/v2/people")) return "people";
  if (pathname.startsWith("/v2/admin")) return "admin";
  if (pathname.startsWith("/v2/reports")) return "reports";
  return null;
}

const APPLIES: Record<string, Screen[]> = {
  "journey:first-login": ["landscape"],
  "journey:connect-a-system": ["system", "landscape"],
  "journey:first-analysis": ["runs", "system"],
  "journey:first-fix": ["work", "object"],
  "journey:steward-work": ["work"],
  "journey:approver-work": ["work", "people"],
  "journey:basis-operations": ["system", "runs", "admin"],
  "journey:analyst-insights": ["object", "rule", "landscape"],
  "journey:lead-reporting": ["landscape", "reports"],
  "journey:authoring-rules": ["rule"],
  "journey:golden-records": ["object"],
  "journey:ask-meridian": ["landscape"],
  "journey:admin-users": ["admin"],
  "journey:admin-rules": ["rule", "admin"],
  "journey:admin-runs": ["runs"],
  "journey:admin-assigning-work": ["work", "people"],
  "journey:admin-best-practices": ["admin"],
  "guide:welcome": ["landscape"],
  "guide:concepts": ["landscape", "object"],
  "guide:roles": ["admin"],
  "guide:todo": ["work"],
  "guide:fix": ["work"],
  "guide:approvals": ["work"],
  "guide:objects": ["object"],
  "guide:monitoring": ["runs"],
  "guide:progress": ["runs", "reports"],
  "guide:inbox": ["work"],
  "guide:analysis": ["runs"],
  "guide:mdm": ["object"],
  "guide:rules": ["rule"],
  "guide:data-in": ["system"],
  "guide:admin": ["admin"],
  "guide:shortcuts": ["landscape", "object", "work", "runs"],
  "guide:troubleshooting": ["system", "runs"],
  "guide:glossary": ["object"],
};

/** The canvases a chapter applies to. */
export const screensFor = (id: string): Screen[] => APPLIES[id] ?? [];

/** True when the chapter applies to the canvas the viewer is on. */
export const appliesTo = (id: string, screen: Screen | null): boolean => screen !== null && screensFor(id).includes(screen);

/**
 * The chapters in the order the panel lists them: the ones for this canvas first (a chapter written mainly for this
 * canvas before one that only touches it, each group in its own order), then the rest in their own order.
 */
export function orderFor(chapters: readonly HelpChapter[], screen: Screen | null): HelpChapter[] {
  const here = chapters
    .map((c, i) => ({ c, i, rank: screen ? screensFor(c.id).indexOf(screen) : -1 }))
    .filter((x) => x.rank >= 0)
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.c);
  return [...here, ...chapters.filter((c) => !appliesTo(c.id, screen))];
}

export interface HelpHit { chapter: HelpChapter; sections: HelpSection[] }

/** Chapters whose title, summary or text contain every word of the query, with the sections that matched. */
export function searchHelp(chapters: readonly HelpChapter[], query: string): HelpHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return chapters.map((chapter) => ({ chapter, sections: [] }));
  const hits: HelpHit[] = [];
  for (const chapter of chapters) {
    const head = `${chapter.title} ${chapter.summary}`.toLowerCase();
    const all = `${head} ${chapter.sections.map((s) => `${s.heading} ${s.text}`).join(" ")}`.toLowerCase();
    if (!words.every((w) => all.includes(w))) continue;
    const sections = chapter.sections.filter((s) => words.some((w) => `${s.heading} ${s.text}`.toLowerCase().includes(w))).slice(0, 3);
    hits.push({ chapter, sections });
  }
  // Title matches first, then the rest in the given order.
  return hits.sort((a, b) => Number(words.every((w) => b.chapter.title.toLowerCase().includes(w))) - Number(words.every((w) => a.chapter.title.toLowerCase().includes(w))));
}

/** A short passage around the first match, for a result line. */
export function snippet(text: string, query: string, max = 140): string {
  const flat = text.replace(/[#*`>|]/g, "").replace(/\s+/g, " ").trim();
  const word = query.toLowerCase().split(/\s+/).find((w) => w && flat.toLowerCase().includes(w));
  if (!word) return flat.slice(0, max);
  const at = Math.max(0, flat.toLowerCase().indexOf(word) - 40);
  return `${at > 0 ? "…" : ""}${flat.slice(at, at + max)}${at + max < flat.length ? "…" : ""}`;
}

export interface Diagnostics {
  version: string;
  tenant: string | null;
  tenantId: string | null;
  licence: string | null;
  user: string | null;
  screen: string;
  time: string;
  browser: string;
}

/** The block a person pastes into a support request: no record values, no secrets. */
export function diagnosticsText(d: Diagnostics): string {
  return [
    `Meridian ${d.version}`,
    `Tenant: ${d.tenant ?? "unknown"}${d.tenantId ? ` (${d.tenantId})` : ""}`,
    `Licence: ${d.licence ?? "unknown"}`,
    `User: ${d.user ?? "unknown"}`,
    `Screen: ${d.screen}`,
    `Time: ${d.time}`,
    `Browser: ${d.browser}`,
  ].join("\n");
}

/** A reference for the request, stable for the same moment and screen: "MN-4F2A-1029". */
export function diagnosticsRef(d: Diagnostics): string {
  let h = 0;
  for (const ch of `${d.tenantId ?? ""}${d.user ?? ""}${d.screen}${d.time}`) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const day = d.time.slice(5, 10).replace("-", "");
  return `MN-${h.toString(16).toUpperCase().padStart(8, "0").slice(0, 4)}-${day}`;
}
