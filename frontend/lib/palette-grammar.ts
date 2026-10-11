// Deterministic command-palette grammar (screens.md 1.8). No NLP, no network: tokens in, URL out.

export interface GrammarContext {
  objects: { module: string; label: string }[];
  systems?: string[];
}

export type ChipKind = "object" | "severity" | "dimension" | "check" | "key" | "system" | "run" | "compare" | "status" | "owner";

export interface GrammarChip {
  kind: ChipKind;
  label: string;
  value: string;
}

export interface GrammarResult {
  chips: GrammarChip[];
  /** Null for empty input. Unparsed words fall back to /search?q=. */
  href: string | null;
}

const SEVERITIES = ["critical", "high", "medium", "low"];
const DIMENSIONS = ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"];
const CHECK_ID = /^[A-Z]{2,4}-\d{3}$/i;
const NUMERIC_KEY = /^\d{6,18}$/;
const ALNUM_KEY = /^[A-Z0-9]{10}$/;
const STOP = new Set(["in", "the", "of", "for", "all", "findings", "finding", "records", "record", "on", "with", "show", "me"]);

const words = (s: string) => s.toLowerCase().replace(/[_-]+/g, " ").split(/\s+/).filter(Boolean);

export function parsePalette(input: string, ctx: GrammarContext): GrammarResult {
  const text = input.trim();
  if (!text) return { chips: [], href: null };

  const tokens = text.split(/\s+/);
  const lower = tokens.map((t) => t.toLowerCase());
  const used = new Array<boolean>(tokens.length).fill(false);
  const chips: GrammarChip[] = [];
  const take = (from: number, n: number) => { for (let i = from; i < from + n; i++) used[i] = true; };

  // Phrases first: "last run", "vs previous".
  for (let i = 0; i < tokens.length - 1; i++) {
    if (lower[i] === "last" && lower[i + 1] === "run") { chips.push({ kind: "run", label: "Last run", value: "latest" }); take(i, 2); }
    else if (lower[i] === "vs" && lower[i + 1] === "previous") { chips.push({ kind: "compare", label: "vs previous", value: "previous" }); take(i, 2); }
    else if (lower[i] === "owner" && i + 1 < tokens.length) { chips.push({ kind: "owner", label: `Owner ${tokens[i + 1]}`, value: tokens[i + 1] }); take(i, 2); }
  }

  // Objects: longest label/module match wins ("material master" before "material").
  const objectForms = ctx.objects
    .flatMap((o) => [words(o.label), words(o.module)].map((w) => ({ o, w })))
    .filter((f) => f.w.length > 0)
    .sort((a, b) => b.w.length - a.w.length);
  for (const { o, w } of objectForms) {
    if (chips.some((c) => c.kind === "object")) break;
    for (let i = 0; i + w.length <= tokens.length; i++) {
      if (used.slice(i, i + w.length).some(Boolean)) continue;
      if (w.every((word, j) => words(tokens[i + j]).join(" ") === word)) {
        chips.push({ kind: "object", label: o.label, value: o.module });
        take(i, w.length);
        break;
      }
    }
  }

  const systems = ctx.systems ?? [];
  tokens.forEach((tok, i) => {
    if (used[i]) return;
    const l = lower[i];
    const bare = tok.replace(/[,.;]+$/, "");
    if (SEVERITIES.includes(l)) chips.push({ kind: "severity", label: l, value: l });
    else if (DIMENSIONS.includes(l)) chips.push({ kind: "dimension", label: l, value: l });
    else if (l === "failing") chips.push({ kind: "status", label: "Failing", value: "failing" });
    else if (l === "blocked") chips.push({ kind: "status", label: "Blocked", value: "blocked" });
    else if (CHECK_ID.test(bare)) chips.push({ kind: "check", label: bare.toUpperCase(), value: bare.toUpperCase() });
    else if (NUMERIC_KEY.test(bare) || (ALNUM_KEY.test(bare) && /\d/.test(bare))) chips.push({ kind: "key", label: bare, value: bare });
    else if (systems.some((s) => s.toLowerCase() === l) || (i > 0 && lower[i - 1] === "in" && /^[A-Z][A-Z0-9]{2}$/.test(bare))) {
      const sys = systems.find((s) => s.toLowerCase() === l) ?? bare;
      chips.push({ kind: "system", label: sys, value: sys });
    } else return;
    used[i] = true;
  });

  // Filler words are consumed silently; anything left over is free text.
  const leftover = tokens.filter((_, i) => !used[i] && !STOP.has(lower[i]));
  if (chips.length === 0) return { chips, href: `/search?q=${encodeURIComponent(text)}` };

  const pick = (k: ChipKind) => chips.find((c) => c.kind === k)?.value;
  const object = pick("object");
  const check = pick("check");
  const key = pick("key");
  if (key && !object) return { chips, href: `/search?q=${encodeURIComponent(key)}` };
  if (object && key) return { chips, href: `/objects/${encodeURIComponent(object)}/records/${encodeURIComponent(key)}` };
  if (check && !object) return { chips, href: `/rules/${encodeURIComponent(check)}` };

  const q = new URLSearchParams();
  for (const [k, name] of [["severity", "severity"], ["dimension", "dimension"], ["system", "system"], ["run", "run"], ["compare", "compare"], ["status", "status"], ["owner", "owner"]] as const) {
    const v = pick(k);
    if (v) q.set(name, v);
  }
  if (check) q.set("check", check);
  if (leftover.length) q.set("q", leftover.join(" "));
  const qs = q.toString();
  const path = object ? `/objects/${encodeURIComponent(object)}` : "/objects";
  return { chips, href: qs ? `${path}?${qs}` : path };
}
