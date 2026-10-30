/**
 * A small ICU MessageFormat subset, enough for the v2 catalogues:
 *
 *   {name}                                         the value, as text
 *   {count, plural, =0 {none} one {# rule} other {# rules}}   CLDR plural categories of the locale, `#` is the count
 *   {kind, select, rule {a rule} other {a thing}}  a choice by value
 *
 * Braces nest. A value that is missing renders as its own placeholder, so a gap is visible rather than silent.
 * Apostrophes are plain text (no ICU quoting): the catalogues hold no literal braces.
 */

export type MessageVars = Record<string, string | number | null | undefined>;

type Node = string | { name: string; kind: "arg" } | { name: string; kind: "plural" | "select"; offset: number; options: Record<string, Node[]> };

const parsed = new Map<string, Node[]>();

function parse(src: string): Node[] {
  let i = 0;
  const readUntilBrace = (inPlural: boolean): Node[] => {
    const out: Node[] = [];
    let text = "";
    while (i < src.length) {
      const c = src[i];
      if (c === "{") {
        if (text) out.push(text);
        text = "";
        i++;
        out.push(readArg());
      } else if (c === "}") {
        break;
      } else if (c === "#" && inPlural) {
        if (text) out.push(text);
        text = "";
        out.push({ name: "#", kind: "arg" });
        i++;
      } else {
        text += c;
        i++;
      }
    }
    if (text) out.push(text);
    return out;
  };
  const readArg = (): Node => {
    const start = i;
    while (i < src.length && src[i] !== "}" && src[i] !== ",") i++;
    const name = src.slice(start, i).trim();
    if (src[i] === "}") {
      i++;
      return { name, kind: "arg" };
    }
    i++; // the comma
    const tStart = i;
    while (i < src.length && src[i] !== "," && src[i] !== "}") i++;
    const type = src.slice(tStart, i).trim();
    if (src[i] === "}") {
      i++;
      return { name, kind: "arg" };
    }
    i++; // the comma
    const options: Record<string, Node[]> = {};
    let offset = 0;
    for (;;) {
      while (i < src.length && /\s/.test(src[i])) i++;
      if (i >= src.length) break;
      if (src[i] === "}") {
        i++;
        break;
      }
      const kStart = i;
      while (i < src.length && !/[\s{]/.test(src[i])) i++;
      const key = src.slice(kStart, i);
      if (key.startsWith("offset:")) {
        offset = Number(key.slice(7)) || 0;
        continue;
      }
      while (i < src.length && /\s/.test(src[i])) i++;
      if (src[i] !== "{") break;
      i++;
      options[key] = readUntilBrace(type === "plural");
      i++; // the closing brace of the option
    }
    return { name, kind: type === "plural" ? "plural" : "select", offset, options };
  };
  return readUntilBrace(false);
}

const rulesCache = new Map<string, Intl.PluralRules>();
const numCache = new Map<string, Intl.NumberFormat>();

function pluralRules(locale: string): Intl.PluralRules {
  let r = rulesCache.get(locale);
  if (!r) {
    try {
      r = new Intl.PluralRules(locale);
    } catch {
      r = new Intl.PluralRules("en");
    }
    rulesCache.set(locale, r);
  }
  return r;
}

function numberText(n: number, locale: string): string {
  let f = numCache.get(locale);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    } catch {
      f = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
    }
    numCache.set(locale, f);
  }
  return f.format(n);
}

function render(nodes: Node[], vars: MessageVars, locale: string, count: number | null): string {
  let out = "";
  for (const n of nodes) {
    if (typeof n === "string") {
      out += n;
    } else if (n.kind === "arg") {
      if (n.name === "#") out += count == null ? "#" : numberText(count, locale);
      else {
        const v = vars[n.name];
        out += v === undefined || v === null ? `{${n.name}}` : String(v);
      }
    } else if (n.kind === "plural") {
      const raw = Number(vars[n.name]);
      const value = Number.isFinite(raw) ? raw : 0;
      const exact = n.options[`=${value}`];
      const category = pluralRules(locale).select(value - n.offset);
      const branch = exact ?? n.options[category] ?? n.options.other ?? [];
      out += render(branch, vars, locale, value - n.offset);
    } else {
      const v = vars[n.name];
      const branch = n.options[String(v)] ?? n.options.other ?? [];
      out += render(branch, vars, locale, count);
    }
  }
  return out;
}

/** Formats one message. `locale` is a BCP 47 tag; it picks the plural rules and the digits of `#`. */
export function formatMessage(message: string, vars: MessageVars | undefined, locale: string): string {
  if (!vars && !message.includes("{")) return message;
  let nodes = parsed.get(message);
  if (!nodes) {
    nodes = parse(message);
    parsed.set(message, nodes);
  }
  return render(nodes, vars ?? {}, locale, null);
}
