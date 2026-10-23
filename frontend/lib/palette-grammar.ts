// Deterministic command-palette grammar (screens.md 1.8). No NLP, no network: tokens in, URL out.
//
// Every chip the grammar returns is carried by a query parameter its target page reads:
//   /objects                         run (incl. "latest"), dimension, owner
//   /objects/<object>                tab, severity + dimension (Rules tab), check (Records tab); no ?run= is that
//                                    object's newest finished run
//   /objects/<object>/records/<key>  the record; no ?run= is the object's newest finished run
//   /rules/<id>, /search?q=          the path or q only
// A recognised word the chosen page cannot honour is dropped from the chips rather than sent as a dead parameter.

export interface GrammarContext {
  objects: { module: string; label: string }[];
}

export type ChipKind = "object" | "severity" | "dimension" | "check" | "key" | "run" | "owner";

export interface GrammarChip {
  kind: ChipKind;
  label: string;
  value: string;
}

export interface GrammarResult {
  chips: GrammarChip[];
  /** Null for empty input. Input with nothing the target page can honour falls back to /search?q=. */
  href: string | null;
}

const SEVERITIES = ["critical", "high", "medium", "low"];
const DIMENSIONS = ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"];
// Rule IDs as the YAML rules name them: a letter prefix (digits only between letters, as in S4HC or XP2P), an optional
// `_SUFFIX`, three to five digits and an optional letter (MM003, PUR012, S4HC042, EWMS_TO019, MM018B), or the
// hyphenated S/4 readiness form whose first part carries a digit (S4R-WM-QUANT-NEG, S4-CE-PRIMARY-GL).
const CHECK_ID = /^(?:[A-Z](?:\d?[A-Z]){1,5}(?:_[A-Z]+)?\d{3,5}[A-Z]?|[A-Z]+\d[A-Z0-9]*(?:-[A-Z0-9]+){2,})$/i;
const NUMERIC_KEY = /^\d{6,18}$/;
const ALNUM_KEY = /^[A-Z0-9]{10}$/;

const words = (s: string) => s.toLowerCase().replace(/[_-]+/g, " ").split(/\s+/).filter(Boolean);

export function parsePalette(input: string, ctx: GrammarContext): GrammarResult {
  const text = input.trim();
  if (!text) return { chips: [], href: null };
  const search = { chips: [], href: `/search?q=${encodeURIComponent(text)}` };

  const tokens = text.split(/\s+/);
  const lower = tokens.map((t) => t.toLowerCase());
  const used = new Array<boolean>(tokens.length).fill(false);
  const chips: GrammarChip[] = [];
  const take = (from: number, n: number) => { for (let i = from; i < from + n; i++) used[i] = true; };

  // Phrases first: "last run", "owner <name>".
  for (let i = 0; i < tokens.length - 1; i++) {
    if (used[i]) continue;
    if (lower[i] === "last" && lower[i + 1] === "run") { chips.push({ kind: "run", label: "Last run", value: "latest" }); take(i, 2); }
    else if (lower[i] === "owner") { chips.push({ kind: "owner", label: `Owner ${tokens[i + 1]}`, value: tokens[i + 1] }); take(i, 2); }
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

  tokens.forEach((tok, i) => {
    if (used[i]) return;
    const l = lower[i];
    const bare = tok.replace(/[,.;]+$/, "");
    if (SEVERITIES.includes(l)) chips.push({ kind: "severity", label: l, value: l });
    else if (DIMENSIONS.includes(l)) chips.push({ kind: "dimension", label: l, value: l });
    else if (CHECK_ID.test(bare)) chips.push({ kind: "check", label: bare.toUpperCase(), value: bare.toUpperCase() });
    else if (NUMERIC_KEY.test(bare) || (ALNUM_KEY.test(bare) && /\d/.test(bare))) chips.push({ kind: "key", label: bare, value: bare });
    else return;
    used[i] = true;
  });

  const pick = (k: ChipKind) => chips.find((c) => c.kind === k)?.value;
  const object = pick("object");
  const check = pick("check");
  const key = pick("key");
  const severity = pick("severity");
  const dimension = pick("dimension");
  const enc = encodeURIComponent;

  // Each target, with the chip kinds it honours. Without ?run= an object page already shows its newest run.
  let href: string;
  let honoured: ChipKind[];
  if (key) {
    href = object ? `/objects/${enc(object)}/records/${enc(key)}` : `/search?q=${enc(key)}`;
    honoured = object ? ["object", "key", "run"] : ["key"];
  } else if (check) {
    href = object ? `/objects/${enc(object)}?tab=records&check=${enc(check)}` : `/rules/${enc(check)}`;
    honoured = object ? ["object", "check", "run"] : ["check"];
  } else if (object) {
    const q = new URLSearchParams();
    if (severity || dimension) q.set("tab", "rules");
    if (severity) q.set("severity", severity);
    if (dimension) q.set("dimension", dimension);
    const qs = q.toString();
    href = qs ? `/objects/${enc(object)}?${qs}` : `/objects/${enc(object)}`;
    honoured = ["object", "severity", "dimension", "run"];
  } else {
    const q = new URLSearchParams();
    if (dimension) q.set("dimension", dimension);
    const owner = pick("owner");
    if (owner) q.set("owner", owner);
    if (pick("run")) q.set("run", "latest");
    const qs = q.toString();
    href = qs ? `/objects?${qs}` : "/objects";
    honoured = ["dimension", "owner", "run"];
  }

  const shown = chips.filter((c) => honoured.includes(c.kind));
  return shown.length ? { chips: shown, href } : search;
}
