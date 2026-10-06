/**
 * Aurora writing-system ESLint plugin — WS8 §11.4.
 *
 * Aurora copy teaches, directs, or confirms — nothing else (spec §11.1).
 * Placeholder strings ("Loading…", "Error", "OK"), glossary violations
 * ("dashboard" instead of "command centre"), and whiny voice ("Oops",
 * "Sorry", "Welcome to") all dilute the product voice.
 *
 * This plugin defines a single rule, `aurora-writing/no-forbidden-copy`,
 * that flags those patterns in:
 *   - JSX text nodes: `<p>Loading…</p>` and `<>Error</>`
 *   - String literals: `"Submit"`, `"Oops, something went wrong"`
 *   - JSX attributes: `label="OK"`, `title="Welcome to Meridian"`
 *
 * The rule ships warnings by default (not errors) so the team can ratchet
 * up after an initial clean-up sweep. Per-line disable via the normal
 * `// eslint-disable-next-line aurora-writing/no-forbidden-copy` requires
 * a justification comment per spec §11.4.
 */

const PLACEHOLDER_EXACT = new Set([
  "loading",
  "loading…",
  "loading...",
  "error",
  "ok",
  "submit",
  "cancel",
  "no data",
  "no data found",
  // "something went wrong" is intentionally handled by the glossary rule —
  // the replacement sentence is more actionable there.
]);

const FORBIDDEN_PREFIXES = [
  "oops",
  "sorry",
  "whoops",
  "welcome to",
  "uh oh",
  "uh-oh",
];

const GLOSSARY_VIOLATIONS = [
  {
    pattern: /\bdashboard(s)?\b/i,
    replacement: "command centre",
    rationale:
      "Aurora glossary term is 'command centre' (spec §11.3) — 'dashboard' " +
      "is the anti-pattern.",
  },
  {
    pattern: /\bthis page shows\b/i,
    replacement: "a sentence that states what is true now",
    rationale: "Every page's first paragraph states the verdict, not the page (DESIGN.md rule 4).",
  },
  {
    pattern: /\bclick here\b/i,
    replacement: "a link that names its destination",
    rationale: "Links name where they go (DESIGN.md rule 15).",
  },
  {
    pattern: /\bsomething went wrong\b/i,
    replacement: "a specific failure description",
    rationale:
      "Aurora voice is not apologetic for things Meridian didn't cause " +
      "(spec §11.2). Name the specific failure.",
  },
];

/**
 * Decide whether a raw user-facing string violates a writing-system rule.
 * Returns either `null` (clean) or a { messageId, data } shape ready for
 * context.report. A single rule for all violation types so the plugin
 * surface is small and the lint output is consistent.
 */
function classify(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  if (PLACEHOLDER_EXACT.has(lower)) {
    return {
      messageId: "placeholder",
      data: { value: trimmed },
    };
  }

  for (const prefix of FORBIDDEN_PREFIXES) {
    if (lower === prefix || lower.startsWith(prefix + " ") || lower.startsWith(prefix + ",")) {
      return {
        messageId: "voice",
        data: { value: trimmed, prefix },
      };
    }
  }

  for (const g of GLOSSARY_VIOLATIONS) {
    if (g.pattern.test(trimmed)) {
      return {
        messageId: "glossary",
        data: {
          value: trimmed,
          replacement: g.replacement,
          rationale: g.rationale,
        },
      };
    }
  }

  return null;
}

const rule = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Flag placeholder copy, glossary violations, and non-Aurora voice " +
        "(spec §11).",
    },
    messages: {
      placeholder:
        "Aurora copy must teach, direct, or confirm (spec §11.1). " +
        "{{value}} is a placeholder — replace with a specific empty-state " +
        "sentence, button label, or action phrase.",
      voice:
        "Aurora voice is confident, never apologetic (spec §11.2). '{{value}}' " +
        "starts with '{{prefix}}' — rewrite to name the specific issue.",
      glossary:
        "Aurora glossary violation (spec §11.3): '{{value}}' — prefer " +
        "'{{replacement}}'. {{rationale}}",
    },
    schema: [],
  },
  create(context) {
    const check = (node, raw) => {
      const result = classify(raw);
      if (result) {
        context.report({ node, ...result });
      }
    };

    // String literals in TS serve many purposes: type discriminants
    // ("ok" | "warn" | "fail"), object keys, URLs, test ids, etc. Flagging
    // every bare Literal produces a flood of false positives on enum-style
    // values that are never shown to users. This rule narrows to places
    // where user-facing copy actually lives:
    //   - JSXText nodes: `<p>Loading…</p>`
    //   - Literal/TemplateLiteral used as the value of a JSXAttribute:
    //     `label="OK"`, `title="Welcome to …"`
    // Default values in function signatures (`cancelLabel = "Cancel"`) are
    // deliberately excluded — they're caught in code review, not here, to
    // keep the rule signal-high.
    // Enum-valued props (`type="submit"`, `status="ok"`) are identifiers
    // for code, never shown to users, so they are not copy.
    const NON_COPY_ATTRS = new Set(["type", "status", "variant"]);
    const isJsxAttrValue = (node) => {
      let attr = null;
      if (node.parent?.type === "JSXAttribute") attr = node.parent;
      else if (node.parent?.type === "JSXExpressionContainer" && node.parent.parent?.type === "JSXAttribute") attr = node.parent.parent;
      return !!attr && !NON_COPY_ATTRS.has(attr.name?.name);
    };

    return {
      JSXText(node) {
        check(node, node.value);
      },
      Literal(node) {
        if (typeof node.value !== "string") return;
        if (!isJsxAttrValue(node)) return;
        check(node, node.value);
      },
      TemplateLiteral(node) {
        if (node.quasis.length !== 1) return;
        if (!isJsxAttrValue(node)) return;
        check(node, node.quasis[0].value.cooked);
      },
    };
  },
};

// DESIGN.md rule 15: no arrow glyphs, no middle-dot separators, no ampersand.
// "&" in a label is a glyph too: write "and". Spaced only, so URLs and entities pass.
const GLYPHS = /[→←↑↓]| · /;
const AMP = / & /;
const glyphRule = {
  meta: {
    type: "problem",
    schema: [],
    messages: { glyph: "No arrow glyphs or middle-dot separators in copy (DESIGN.md rule 15): '{{value}}'." },
  },
  create(context) {
    // lib/ and components/ hold label data (nav, workspaces), so "&" is checked in every string there.
    const anywhere = /\/(lib|components)\//.test(context.filename.replaceAll("\\", "/"));
    const check = (node, raw, inJsx) => {
      if (typeof raw !== "string") return;
      if ((inJsx && GLYPHS.test(raw)) || ((inJsx || anywhere) && AMP.test(raw))) context.report({ node, messageId: "glyph", data: { value: raw.trim().slice(0, 40) } });
    };
    const inJsx = (n) => n.parent?.type === "JSXAttribute" || n.parent?.type === "JSXExpressionContainer";
    return {
      JSXText(node) { check(node, node.value, true); },
      Literal(node) { check(node, node.value, inJsx(node)); },
      TemplateLiteral(node) { node.quasis.forEach((q) => check(node, q.value.cooked, inJsx(node))); },
    };
  },
};

// DESIGN.md rule 19: dates and times go through formatDate in lib/format.ts.
const formatDateOnly = {
  meta: { type: "problem", schema: [], messages: { date: "Format dates with formatDate from lib/format.ts, not {{name}}. toLocaleString is for numbers." } },
  create(context) {
    if (context.filename.replaceAll("\\", "/").endsWith("/lib/format.ts")) return {};
    const DATEISH = /^(date|time|d|ts|when)$|(Date|Time|At|_at|_date|_time)$|^(date|time)[A-Z_]/;
    const dateLike = (o) =>
      (o.type === "NewExpression" && o.callee.name === "Date") ||
      (o.type === "Identifier" && DATEISH.test(o.name)) ||
      (o.type === "MemberExpression" && !o.computed && DATEISH.test(o.property.name ?? ""));
    return {
      CallExpression(node) {
        const c = node.callee;
        if (c.type !== "MemberExpression" || c.computed) return;
        const name = c.property.name;
        if (name === "toLocaleDateString" || name === "toLocaleTimeString") context.report({ node, messageId: "date", data: { name } });
        else if (name === "toLocaleString" && (dateLike(c.object) || node.arguments.some((a) => a.type === "ObjectExpression" && a.properties.some((p) => /^(date|time|month|weekday|year|day|hour)/.test(p.key?.name ?? ""))))) {
          context.report({ node, messageId: "date", data: { name } });
        }
      },
    };
  },
};

// DESIGN.md rule 18: a backend id or enum never shows as copy. Wrap it in a label helper or Mono.
const RAW_PROP = /^(domain|module|status|item_type|severity|check_id|system_type|provider|tier)$/;
const WRAPPERS = new Set(["Mono", "FieldChip", "StatusBadge", "Badge", "Chip", "Link", "Text"]);
const noRawId = {
  meta: { type: "problem", schema: [], messages: { raw: "{{src}} is a backend value. Wrap it in labelOf, formatModuleName or Mono.", slice: "No sliced ids as copy. Show a name, or put the id in Mono." } },
  create(context) {
    const inWrapper = (n) => {
      for (let a = n.parent; a; a = a.parent) {
        if (a.type === "JSXElement" && WRAPPERS.has(a.openingElement.name.name)) return true;
        if (a.type === "JSXAttribute") return true; // props are judged by their component
      }
      return false;
    };
    return {
      JSXExpressionContainer(node) {
        const e = node.expression;
        if (node.parent.type !== "JSXElement" || inWrapper(node)) return;
        if (e.type === "MemberExpression" && !e.computed && RAW_PROP.test(e.property.name)) {
          context.report({ node, messageId: "raw", data: { src: context.sourceCode.getText(e) } });
        } else if (e.type === "CallExpression" && e.callee.type === "MemberExpression" && e.callee.property.name === "slice" && e.callee.object.type === "MemberExpression" && /^(id|[a-z]+_id)$/.test(e.callee.object.property.name ?? "")) {
          context.report({ node, messageId: "slice" });
        }
      },
    };
  },
};

const plugin = {
  meta: { name: "aurora-writing", version: "1.0.0" },
  rules: {
    "no-forbidden-copy": rule,
    "no-forbidden-glyphs": glyphRule,
    "format-date-only": formatDateOnly,
    "no-raw-id": noRawId,
  },
};

export default plugin;

// Named export so config files can also do:
//   import { plugin as auroraWriting } from "./eslint-rules/aurora-writing.mjs"
export { plugin, rule, classify };
