/**
 * What counts as a user-visible literal in the v2 interface, shared by the extraction script (scripts/i18n-extract.mjs)
 * and its test. A literal is user-visible when it reads as prose (words, not an identifier, a class, a path or an SAP
 * name) and sits where text reaches the screen: JSX text, a display attribute, a display property, an argument, a
 * return value. It is translated when it is the first argument of t() or tx() from lib/v2/i18n.
 */
import ts from "typescript";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** Where the v2 interface's words live. */
export const SCAN_ROOTS = ["design/v2", "app/(v2)", "app/(v2status)", "app/(auth)", "lib/v2"];

/**
 * Files that are not scanned: the catalogues themselves, tests and fixtures (data, not interface), and the files the
 * step 6b builder owns while it works on them (system configuration, the rules library and the object tabs). Those
 * are localised when 6b lands; the list shrinks then.
 */
export const EXCLUDE = [
  /^lib\/v2\/i18n\//,
  /__tests__\//,
  /\.test\.tsx?$/,
  /\/fixtures\//,
];

export function listFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (/\.tsx?$/.test(name)) out.push(abs);
    }
  };
  for (const r of SCAN_ROOTS) walk(join(root, r));
  return out.map((abs) => relative(root, abs).split("\\").join("/")).filter((f) => !EXCLUDE.some((re) => re.test(f))).sort();
}

/** Text that reads as words. Identifiers (material_master, MARA.MEINS, camelCase, kebab-case), classes, paths, URLs, CSS and media queries do not. */
export function isProse(raw) {
  const s = raw.trim();
  if (!s) return false;
  if (!/[A-Za-z]{2,}/.test(s)) return false;
  if (/m2-|^\/|^https?:|^\w+:\/\/|^#|^\.\w|^@\//.test(s)) return false;
  if (/[{}]/.test(s)) return false;
  if (/^[\w./-]*\+[\w./+-]*$/.test(s)) return false;
  if (/^[A-Z0-9_.\-=/:*#[\]]+$/.test(s)) return false;
  if (/^[\w.\-:/=]+$/.test(s) && !/^[A-Z][a-z]+(?:-[a-z]+)*$/.test(s) && !/^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/.test(s)) return false;
  if (/^[a-z-]+\(.*\)$/.test(s)) return false;
  if (/^\(?(?:prefers|min|max|hover|pointer)-/.test(s)) return false;
  if (/^(?:[a-z][\w-]*\s*,\s*)+[a-z][\w-]*$/.test(s)) return false;
  if (/^[a-z]+\[[^\]]*\]/.test(s)) return false;
  if (/^(?:\d+(?:\.\d+)?(?:px|%|em|rem|fr|vh|vw|ms|s)?\s*)+$/.test(s)) return false;
  return true;
}

/** Attributes whose string value is not text: classes, ids, hrefs, roles, types and the rest. */
export const NON_DISPLAY_ATTRS = new Set([
  "className", "class", "href", "id", "key", "role", "type", "name", "value", "defaultValue", "style", "htmlFor", "src", "lang", "dir", "pattern", "form", "autoComplete", "inputMode", "accept", "rel", "target", "method", "action", "encType", "kind", "tone", "variant", "align", "verdict", "severity", "icon", "mode", "size", "width", "height", "viewBox", "d", "fill", "stroke", "textAnchor", "transform", "points", "x", "y", "cx", "cy", "r", "rx", "ry", "x1", "x2", "y1", "y2", "strokeWidth", "strokeLinecap", "strokeLinejoin", "strokeDasharray", "preserveAspectRatio", "dominantBaseline", "fontFamily", "spellCheck", "enterKeyHint", "capture", "sizes", "srcSet", "loading", "decoding", "crossOrigin", "referrerPolicy", "download", "slot", "is", "scope", "headers", "wrap", "list", "step", "min", "max", "testId", "testid", "state", "slug", "module", "system", "field", "path", "queryKey", "format", "unit", "sort", "column", "permission", "route", "screen", "part", "section", "tab", "filter", "scheme", "persona", "focus", "anchor", "side",
]);
const isNonDisplayAttr = (name) => NON_DISPLAY_ATTRS.has(name) || /^(?:data-|aria-(?:controls|describedby|labelledby|haspopup|current|live|expanded|selected|checked|pressed|hidden|modal|owns|activedescendant|sort|invalid|busy|atomic|relevant|level|posinset|setsize|colcount|colindex|rowcount|rowindex|orientation|autocomplete|multiselectable|readonly|required|disabled|errormessage|details|flowto|keyshortcuts))/.test(name);

/** Object keys whose string value is not text. */
export const NON_DISPLAY_PROPS = new Set([
  "id", "key", "keys", "kind", "slug", "value", "href", "className", "path", "tone", "icon", "module", "field", "type", "testid", "testId", "method", "url", "format", "permission", "permissions", "needs", "role", "role_key", "status", "severity", "check_id", "accept", "queryKey", "variant", "align", "verdict", "state", "mode", "unit", "scope", "sort", "dir", "column", "route", "screen", "part", "section", "tab", "filter", "scheme", "persona", "focus", "anchor", "side", "style", "src", "target", "rel", "lang", "locale", "timeZone", "currency", "dimension", "family", "system", "system_id", "version_id", "record_key", "entity", "action_id", "event", "channel", "chapter", "video", "cron", "schedule_cron", "domain", "tables", "extraction_mode", "decision", "op", "fieldName", "dataKey", "stroke", "fill", "color", "gridTemplateColumns", "gridColumn", "display", "width", "height", "minWidth", "maxWidth", "margin", "padding", "fontSize", "whiteSpace", "alignItems", "justifyContent", "gap", "flexWrap", "position", "top", "left", "right", "bottom", "overflow", "textAlign", "verticalAlign", "fontWeight", "lineHeight", "marginTop", "marginBottom", "paddingLeft", "border", "background", "cursor", "content", "transform", "transition", "animation", "zIndex", "flex", "order", "maxHeight", "minHeight", "boxShadow", "outline", "opacity", "visibility", "pointerEvents", "userSelect", "textDecoration", "fontFamily", "fontVariantNumeric", "letterSpacing", "wordBreak", "overflowWrap", "textOverflow", "listStyle", "objectFit", "accentColor",
]);

/** Calls whose string arguments are not text (selectors, keys, events, formats, paths). */
export const NON_DISPLAY_CALLS = new Set([
  "require", "matchMedia", "querySelector", "querySelectorAll", "getElementById", "closest", "matches", "addEventListener", "removeEventListener", "dispatchEvent", "Event", "CustomEvent", "KeyboardEvent", "MouseEvent", "getItem", "setItem", "removeItem", "startsWith", "endsWith", "includes", "indexOf", "lastIndexOf", "split", "replace", "replaceAll", "test", "exec", "match", "matchAll", "RegExp", "getPropertyValue", "setProperty", "removeProperty", "toLocaleString", "toLocaleDateString", "toLocaleTimeString", "NumberFormat", "DateTimeFormat", "PluralRules", "RelativeTimeFormat", "ListFormat", "supportedLocalesOf", "v2Get", "v2Send", "v2Download", "useRead", "encodeURIComponent", "decodeURIComponent", "createElement", "setAttribute", "getAttribute", "hasAttribute", "removeAttribute", "toggleAttribute", "log", "warn", "error", "info", "debug", "describe", "it", "expect", "fetch", "localeCompare", "useOutcome", "keep", "cn", "clsx", "parse", "stringify", "Symbol", "invalidateQueries", "refreshAdmin", "refreshV2", "setUiCookie", "open", "getAll", "padStart", "padEnd", "join", "formatDate", "labelOf", "formatModuleName", "moduleSlug", "systemSlug", "sapField", "Blob", "File", "URL", "postMessage", "replaceState", "pushState", "prefetch", "mark", "measure", "getEntriesByName", "contains", "scrollIntoView", "focus", "useId", "useV2Href", "hrefFor", "withFixture", "fixtureParam", "fixtureAction", "createDispatcher", "isAxiosError", "describeField", "readKey", "writeKey",
]);

const COMPARISON = new Set([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken, ts.SyntaxKind.InKeyword, ts.SyntaxKind.InstanceOfKeyword]);
const PASS_THROUGH = new Set([
  ts.SyntaxKind.ParenthesizedExpression, ts.SyntaxKind.ConditionalExpression, ts.SyntaxKind.AsExpression, ts.SyntaxKind.SatisfiesExpression, ts.SyntaxKind.NonNullExpression, ts.SyntaxKind.TemplateSpan, ts.SyntaxKind.TemplateExpression, ts.SyntaxKind.ArrayLiteralExpression, ts.SyntaxKind.SpreadElement, ts.SyntaxKind.JsxExpression, ts.SyntaxKind.TypeAssertionExpression,
]);

/** Methods whose result still carries the text they were called on. */
const PASS_METHODS = new Set(["filter", "join", "concat", "trim", "trimStart", "trimEnd", "toLowerCase", "toUpperCase", "slice", "map", "flat", "flatMap", "reverse", "sort"]);

/**
 * An object whose every value is a string and which has no label or title of its own: a map from a key to the words
 * for it ({ value: "Value at risk", due: "Due" }), so even a key like `value` holds text there.
 */
function labelMap(obj) {
  if (!obj || !ts.isObjectLiteralExpression(obj)) return false;
  const props = obj.properties;
  if (props.length < 2) return false;
  let prose = 0;
  for (const p of props) {
    if (ts.isGetAccessorDeclaration(p)) {
      if (["label", "title", "name", "heading", "text"].includes(propName(p.name))) return false;
      prose++;
      continue;
    }
    if (!ts.isPropertyAssignment(p)) return false;
    const n = propName(p.name);
    if (["label", "title", "name", "heading", "text"].includes(n)) return false;
    const v = p.initializer;
    if (!(ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v) || ts.isTemplateExpression(v))) return false;
    if (ts.isTemplateExpression(v) || isProse(v.text)) prose++;
  }
  return prose * 2 >= props.length;
}

const calleeName = (call) => {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return "";
};
/** t() and tx(), and the names a file imports t under when it has a local `t` of its own. */
export const TRANSLATE_NAMES = new Set(["t", "tx", "tr", "tl", "tn"]);
export const isTranslateCall = (n) => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && TRANSLATE_NAMES.has(n.expression.text);
const propName = (n) => (n && (ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isPrivateIdentifier(n)) ? n.text : "");

/**
 * Whether a string literal or template at `node` is in a place whose text can reach the screen. Returns "translated"
 * when it is the key of t()/tx(), "excluded" when its place is not text, else "display".
 */
export function contextOf(node) {
  let cur = node;
  let parent = node.parent;
  for (;;) {
    if (!parent) return "display";
    if (isTranslateCall(parent) && parent.arguments[0] === cur) return "translated";
    if (ts.isBinaryExpression(parent)) {
      if (COMPARISON.has(parent.operatorToken.kind)) return "excluded";
      if (parent.operatorToken.kind === ts.SyntaxKind.EqualsToken && parent.left === cur) return "excluded";
      cur = parent;
      parent = parent.parent;
      continue;
    }
    if (ts.isConditionalExpression(parent) && parent.condition === cur) return "excluded";
    if (PASS_THROUGH.has(parent.kind)) {
      cur = parent;
      parent = parent.parent;
      continue;
    }
    if (ts.isJsxAttribute(parent)) return isNonDisplayAttr(parent.name.getText()) ? "excluded" : "display";
    if (ts.isPropertyAssignment(parent)) {
      if (parent.name === cur) return "excluded";
      const name = propName(parent.name);
      // The values handed to t() fill its placeholders: they are text whatever they are called.
      const host = parent.parent?.parent;
      const intoT = host && isTranslateCall(host) && host.arguments[1] === parent.parent;
      if (NON_DISPLAY_PROPS.has(name) && !labelMap(parent.parent) && !intoT) return "excluded";
      // A style object (style={{ ... }}) is never text.
      const obj = parent.parent;
      if (obj && ts.isObjectLiteralExpression(obj) && obj.parent && ts.isJsxExpression(obj.parent) && obj.parent.parent && ts.isJsxAttribute(obj.parent.parent) && obj.parent.parent.name.getText() === "style") return "excluded";
      return "display";
    }
    if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
      if (parent.expression === cur) return "excluded";
      const name = ts.isCallExpression(parent) ? calleeName(parent) : ts.isIdentifier(parent.expression) ? parent.expression.text : "";
      if (NON_DISPLAY_CALLS.has(name)) return "excluded";
      const callee = parent.expression;
      if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && ["console", "JSON", "Object", "Intl", "Reflect", "Number", "Math", "Date", "router", "document", "window", "localStorage", "sessionStorage", "navigator", "history", "location", "qc"].includes(callee.expression.text)) return "excluded";
      return "display";
    }
    if (ts.isElementAccessExpression(parent)) return "excluded";
    if (ts.isCaseClause(parent) || ts.isLiteralTypeNode(parent) || ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent) || ts.isImportTypeNode?.(parent) || ts.isComputedPropertyName(parent) || ts.isEnumMember(parent) || ts.isTaggedTemplateExpression(parent)) return "excluded";
    if (ts.isVariableDeclaration(parent)) {
      const n = parent.name.getText();
      if (/^(metadata|viewport)$/.test(n)) return "excluded";
      return "display";
    }
    if (ts.isPropertyDeclaration(parent) || ts.isParameter(parent) || ts.isReturnStatement(parent) || ts.isArrowFunction(parent) || ts.isThrowStatement(parent) || ts.isShorthandPropertyAssignment(parent) || ts.isExpressionStatement(parent) || ts.isBindingElement(parent)) {
      if (ts.isExpressionStatement(parent)) return "excluded"; // "use client" and other directives
      return "display";
    }
    // A method on the text itself ("...".trim(), [a, b].filter(Boolean).join(", ")) passes it on to whatever reads the result.
    if (ts.isPropertyAccessExpression(parent) && parent.expression === cur && PASS_METHODS.has(parent.name.text) && parent.parent && ts.isCallExpression(parent.parent)) {
      cur = parent.parent;
      parent = cur.parent;
      continue;
    }
    if (ts.isTypeOfExpression(parent) || ts.isPrefixUnaryExpression(parent) || ts.isPropertyAccessExpression(parent)) return "excluded";
    return "display";
  }
}

/** True when any ancestor is a metadata or viewport object (server-side, read before a language exists). */
export function inMetadata(node) {
  for (let p = node.parent; p; p = p.parent) if (ts.isVariableDeclaration(p) && /^(metadata|viewport)$/.test(p.name.getText())) return true;
  return false;
}

/** The text React renders for a JSX text node (Babel's whitespace rule), entities decoded. */
export function jsxTextValue(raw) {
  const lines = raw.split(/\r\n|\n|\r/);
  let lastNonEmpty = 0;
  lines.forEach((l, i) => {
    if (/[^ \t]/.test(l)) lastNonEmpty = i;
  });
  let str = "";
  lines.forEach((line, i) => {
    let tr = line.replace(/\t/g, " ");
    if (i !== 0) tr = tr.replace(/^[ ]+/, "");
    if (i !== lines.length - 1) tr = tr.replace(/[ ]+$/, "");
    if (tr) {
      if (i !== lastNonEmpty) tr += " ";
      str += tr;
    }
  });
  return str
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, "\u00a0")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&amp;/g, "&");
}

/** JSX text inside these elements is an identifier or a key cap, never translated. */
export const RAW_ELEMENTS = new Set(["kbd", "code", "pre", "Mono", "samp", "var"]);

export function jsxParentName(node) {
  const el = node.parent;
  if (el && ts.isJsxElement(el)) return el.openingElement.tagName.getText();
  return "";
}

/** A line carrying `i18n-ignore` (or the line above it) is skipped: a deliberate untranslated literal. */
export function ignored(sf, node) {
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  const lines = sf.text.split("\n");
  return /i18n-ignore/.test(lines[line] ?? "") || /i18n-ignore/.test(lines[line - 1] ?? "");
}

/** The cooked static text of a template literal with `{}` where each expression goes. */
export function templateStatic(node) {
  if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return node.head.text + node.templateSpans.map((s) => `{}${s.literal.text}`).join("");
}

/** A template reads as prose when its static words do (and it is not a path, a query string or a class list). */
export function isProseTemplate(node) {
  const st = templateStatic(node);
  const words = st.replace(/\{\}/g, " ");
  if (/^\s*\//.test(st) || /m2-/.test(st) || /[?&][\w-]+=/.test(st) || /^[\w-]*\{\}[\w-]*$/.test(st.trim())) return false;
  if (/^[\w.:\-/=]*(\{\}[\w.:\-/=]*)+$/.test(st.trim())) return false;
  if (isProse(words) && /[A-Za-z]{2,}/.test(words)) return true;
  // A lone word joined to a value by a space ("{} rows", " by {}") is text too.
  return /(?:^|\s|\{\})[a-z]{2,}(?=\s|$|\{\}|[.,:;)])/.test(st) && /\s/.test(st);
}

/** JSX text reads as words when it is prose or one plain word ("capped", "and"). */
export const isJsxWords = (s) => isProse(s) || /^[A-Za-z][a-z]+$/.test(s.trim());
