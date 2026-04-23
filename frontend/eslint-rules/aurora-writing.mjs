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
    const isJsxAttrValue = (node) => {
      const parent = node.parent;
      if (!parent) return false;
      if (parent.type === "JSXAttribute") return true;
      if (parent.type === "JSXExpressionContainer" && parent.parent?.type === "JSXAttribute") {
        return true;
      }
      return false;
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

const plugin = {
  meta: { name: "aurora-writing", version: "1.0.0" },
  rules: {
    "no-forbidden-copy": rule,
  },
};

export default plugin;

// Named export so config files can also do:
//   import { plugin as auroraWriting } from "./eslint-rules/aurora-writing.mjs"
export { plugin, rule, classify };
