import { currentLang, hasMessage, tx } from "@/lib/v2/i18n";
import { t } from "@/lib/v2/i18n";
/**
 * The help panel's data: the Meridian guide (lib/v2/help-data.json, built by scripts/help-index.mjs from docs/guide),
 * which canvas and which route each chapter applies to, the
 * walkthrough for each role's start screen, search over chapter text and recording captions, and the diagnostics
 * block for support.
 */
export interface HelpSection { heading: string; text: string }
export interface WalkStep { screen: string; href: string; text: string }
export interface HelpChapter {
  id: string;
  kind: "v2";
  /** Every chapter is about the one interface (the help centre of the retired one went with it). */
  interface: "v2";
  group: string;
  slug: string;
  title: string;
  summary: string;
  audiences: string[];
  /** Base name of the training recording, served at /api/v1/docs/help-videos/{video}.mp4 (.jpg poster, .vtt captions). */
  video: string | null;
  /** Length of the recording, from docs/help-videos/manifest.json, or null when not recorded yet. */
  seconds: number | null;
  /** The recording's caption lines, searched with the text. */
  captions: string[];
  /** The role whose start screen this walkthrough belongs to. */
  persona: string | null;
  walkthrough: WalkStep[] | null;
  sections: HelpSection[];
}
export interface WhatsNewEntry { step: string; date: string; ref: string; text: string }
export interface HelpIndex { title: string; v2Title: string; whatsNew: WhatsNewEntry[]; chapters: HelpChapter[] }

/** Where a chapter's recording, poster and captions are served. */
export const videoUrl = (video: string, ext: "mp4" | "jpg" | "vtt"): string => `/api/v1/docs/help-videos/${video}.${ext}`;

let cached: Promise<HelpIndex> | null = null;
/** The index, loaded on first use so it is not part of the shell's first download. */
export function loadHelp(): Promise<HelpIndex> {
  cached ??= import("./help-data.json").then((m) => (m.default ?? m) as unknown as HelpIndex);
  return cached;
}

export type Screen = "landscape" | "object" | "rule" | "work" | "runs" | "system" | "people" | "admin" | "reports";

export const SCREEN_LABEL: Record<Screen, string> = {
  get landscape() { return t("Landscape"); },
  get object() { return t("An object"); },
  get rule() { return t("A rule"); },
  get work() { return t("Work"); },
  get runs() { return t("Runs"); },
  get system() { return t("A system"); },
  get people() { return t("People"); },
  get admin() { return t("Administration"); },
  get reports() { return t("Reports"); },
};

/** Which canvas the viewer is on, from the address. */
export function screenOf(pathname: string): Screen | null {
  if (pathname === "/" || pathname === "") return "landscape";
  if (pathname.startsWith("/o/")) return "object";
  if (pathname.startsWith("/r/")) return "rule";
  if (pathname.startsWith("/work")) return "work";
  if (pathname.startsWith("/run")) return "runs";
  if (pathname.startsWith("/s/")) return "system";
  if (pathname.startsWith("/people")) return "people";
  if (pathname.startsWith("/requests")) return "work";
  if (pathname.startsWith("/admin")) return "admin";
  if (pathname.startsWith("/reports")) return "reports";
  return null;
}

const APPLIES: Record<string, Screen[]> = {
  "v2:overview": ["landscape"],
  "v2:landscape": ["landscape"],
  "v2:object": ["object"],
  "v2:rules": ["rule", "object"],
  "v2:work": ["work", "object"],
  "v2:approvals": ["work", "people"],
  "v2:people": ["people", "work"],
  "v2:runs": ["runs", "system"],
  "v2:run-compare": ["runs", "object"],
  "v2:systems": ["system", "admin"],
  "v2:golden-records": ["object"],
  "v2:glossary": ["object"],
  "v2:lineage": ["object"],
  "v2:processes": ["object"],
  "v2:schedules": ["reports"],
  "v2:waves": ["landscape"],
  "v2:administration": ["admin"],
  "v2:preferences": ["landscape", "admin"],
  "v2:keyboard": ["landscape", "work"],
  "v2:persona-lead": ["landscape"],
  "v2:persona-steward": ["work"],
  "v2:persona-owner": ["work", "people"],
  "v2:persona-basis": ["system", "runs"],
  "v2:persona-process": ["object"],
  "v2:persona-auditor": ["admin"],
  "v2:persona-admin": ["admin"],
};

/** The canvases a chapter applies to. */
export const screensFor = (id: string): Screen[] => APPLIES[id] ?? [];

/** True when the chapter applies to the canvas the viewer is on. */
export const appliesTo = (id: string, screen: Screen | null): boolean => screen !== null && screensFor(id).includes(screen);

/**
 * Every page of app/(v2), as its route pattern, and the chapter that explains it. help.test.ts reads the page files and
 * fails when a route has no row here, so a new canvas cannot ship without its chapter.
 */
export const ROUTE_CHAPTERS: Readonly<Record<string, string>> = {
  "/": "v2:landscape",
  "/o/[system]/[module]": "v2:object",
  "/o/[system]/[module]/rules": "v2:object",
  "/o/[system]/[module]/records": "v2:work",
  "/o/[system]/[module]/fixes": "v2:approvals",
  "/o/[system]/[module]/runs": "v2:run-compare",
  "/o/[system]/[module]/readiness": "v2:waves",
  "/o/[system]/[module]/golden": "v2:golden-records",
  "/o/[system]/[module]/glossary": "v2:glossary",
  "/o/[system]/[module]/lineage": "v2:lineage",
  "/o/[system]/[module]/processes": "v2:processes",
  "/o/[system]/[module]/processes/design": "v2:processes",
  "/r/[id]": "v2:rules",
  "/rules": "v2:rules",
  "/work": "v2:work",
  "/people": "v2:people",
  "/requests": "v2:approvals",
  "/runs": "v2:runs",
  "/run/[id]": "v2:run-compare",
  "/run/[id]/vs/[b]": "v2:run-compare",
  "/s/[id]": "v2:systems",
  "/s/new": "v2:systems",
  "/share/[token]": "v2:persona-auditor",
  "/reports": "v2:schedules",
  "/admin": "v2:administration",
  "/admin/[section]": "v2:administration",
};

/** The panels a `?open=` value opens, by its kind, and the chapter that explains each. They win over the route. */
const OPEN_CHAPTERS: Readonly<Record<string, string>> = {
  preferences: "v2:preferences",
  waves: "v2:waves",
  batch: "v2:approvals",
  request: "v2:approvals",
  triage: "v2:people",
  inbox: "v2:people",
  balance: "v2:people",
  contracts: "v2:people",
  contract: "v2:people",
  away: "v2:people",
  person: "v2:people",
  golden: "v2:golden-records",
  survivorship: "v2:golden-records",
  term: "v2:glossary",
  step: "v2:processes",
  schedule: "v2:schedules",
  report: "v2:schedules",
  connection: "v2:systems",
  config: "v2:systems",
  syncschedule: "v2:systems",
  zobject: "v2:systems",
  system: "v2:systems",
  job: "v2:runs",
  run: "v2:run-compare",
  rule: "v2:rules",
  record: "v2:work",
};

/** The route pattern of an address: "/o/ecc-production/material-master/golden" is "/o/[system]/[module]/golden". */
export function routeOf(pathname: string): string | null {
  const seg = (pathname.replace(/\/+$/, "") || "/").split("/").slice(1);
  const [a, b, c, d, e] = seg;
  if (!a) return "/";
  if (a === "o" && b && c) return `/o/[system]/[module]${d ? `/${d}` : ""}${e ? `/${e}` : ""}`;
  if (a === "r" && b) return "/r/[id]";
  if (a === "run" && b) return c === "vs" && d ? "/run/[id]/vs/[b]" : "/run/[id]";
  if (a === "s" && b) return b === "new" ? "/s/new" : "/s/[id]";
  if (a === "share" && b) return "/share/[token]";
  if (a === "admin") return b ? "/admin/[section]" : "/admin";
  return `/${a}`;
}

/** The chapter for what the viewer looks at: an open panel's chapter first, then the ledger filter or view, then the route. */
export function chapterFor(pathname: string, search = ""): string | null {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const open = q.get("open");
  if (open && open !== "help") {
    const kind = open.split(":")[0];
    if (OPEN_CHAPTERS[kind]) return OPEN_CHAPTERS[kind];
  }
  const route = routeOf(pathname);
  if (route === "/work" && (q.get("filter") === "approvals" || q.get("filter") === "exceptions")) return "v2:approvals";
  if (route === "/" && q.get("view") === "waves") return "v2:waves";
  return route ? (ROUTE_CHAPTERS[route] ?? null) : null;
}

/** The walkthrough for a role's start screen: by the role for those without a persona of their own, else the persona. */
export function walkthroughFor(persona: string, role: string | null): string {
  if (role === "auditor" || role === "viewer") return "v2:persona-auditor";
  if (role === "platform_admin" || role === "admin") return "v2:persona-admin";
  return `v2:persona-${persona}`;
}

export interface OrderContext {
  pathname?: string;
  search?: string;
  /** The walkthrough to put first on the viewer's start screen. */
  walkthrough?: string | null;
}

const onStart = (ctx: OrderContext): boolean => ctx.pathname !== undefined && routeOf(ctx.pathname) === "/" && !new URLSearchParams(ctx.search ?? "").get("view");

/**
 * The chapters in the order the panel lists them. On the start screen the viewer's walkthrough comes first; then the
 * chapter for the route or the open panel; then the other Meridian 2 chapters for this canvas (a chapter written mainly
 * for it before one that only touches it); then every other chapter.
 */
export function orderFor(chapters: readonly HelpChapter[], screen: Screen | null, ctx: OrderContext = {}): HelpChapter[] {
  const pin: string[] = [];
  if (onStart(ctx) && ctx.walkthrough) pin.push(ctx.walkthrough);
  const here = ctx.pathname !== undefined ? chapterFor(ctx.pathname, ctx.search) : null;
  if (here && !pin.includes(here)) pin.push(here);
  const pinned = pin.map((id) => chapters.find((c) => c.id === id)).filter((c): c is HelpChapter => Boolean(c));
  const rest = chapters.filter((c) => !pin.includes(c.id));
  const byScreen = (list: HelpChapter[]) => {
    const on = list
      .map((c, i) => ({ c, i, rank: screen ? screensFor(c.id).indexOf(screen) : -1 }))
      .filter((x) => x.rank >= 0)
      .sort((a, b) => a.rank - b.rank || a.i - b.i)
      .map((x) => x.c);
    return [...on, ...list.filter((c) => !appliesTo(c.id, screen))];
  };
  return [...pinned, ...byScreen(rest)];
}

/** True when the chapter belongs under "On this screen": a chapter for this canvas, route, panel or start screen. */
export function isHere(chapter: HelpChapter, screen: Screen | null, ctx: OrderContext = {}): boolean {
  if (onStart(ctx) && ctx.walkthrough === chapter.id) return true;
  if (ctx.pathname !== undefined && chapterFor(ctx.pathname, ctx.search) === chapter.id) return true;
  return appliesTo(chapter.id, screen);
}

export interface HelpHit { chapter: HelpChapter; sections: HelpSection[] }

/** Heading of the passage a caption match is shown under (an internal token; the panel translates it). */
export const FROM_RECORDING = "From the recording"; // i18n-ignore

/** Chapters whose title, summary, text or recording captions contain every word of the query, with what matched. */
export function searchHelp(chapters: readonly HelpChapter[], query: string): HelpHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return chapters.map((chapter) => ({ chapter, sections: [] }));
  const hits: HelpHit[] = [];
  for (const chapter of chapters) {
    const head = `${chapter.title} ${chapter.summary}`.toLowerCase();
    const captions = chapter.captions ?? [];
    const all = `${head} ${chapter.sections.map((s) => `${s.heading} ${s.text}`).join(" ")} ${captions.join(" ")}`.toLowerCase();
    if (!words.every((w) => all.includes(w))) continue;
    const sections = chapter.sections.filter((s) => words.some((w) => `${s.heading} ${s.text}`.toLowerCase().includes(w))).slice(0, 3);
    const said = captions.filter((c) => words.some((w) => c.toLowerCase().includes(w))).slice(0, 2).map((text) => ({ heading: FROM_RECORDING, text }));
    hits.push({ chapter, sections: sections.length ? [...sections, ...said].slice(0, 3) : said });
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
    t("Meridian {version}", { version: d.version }),
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

/**
 * A chapter's title, summary or group in the interface's language: the catalogue translates every one of them. The
 * chapters themselves are written in English; `helpInEnglish` says when the panel must say so.
 */
export function helpText(s: string): string {
  return hasMessage(s) ? tx(s) : s;
}
export const helpInEnglish = (): boolean => currentLang() !== "en";
