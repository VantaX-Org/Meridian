/**
 * aurora-structure: the page-structure rules from DESIGN.md "Rules".
 * Rule numbers in the comments are the DESIGN.md numbers.
 */
import { DEPTH_ROUTES } from "../lib/depth.mjs";

const norm = (f) => f.replaceAll("\\", "/");
const jsxName = (n) => (n.type === "JSXIdentifier" ? n.name : null);
const hasAttr = (el, name) => el.attributes.some((a) => a.type === "JSXAttribute" && a.name.name === name);
const attr = (el, name) => el.attributes.find((a) => a.type === "JSXAttribute" && a.name.name === name);
const keyName = (p) => (p.type === "Property" && !p.computed ? (p.key.name ?? p.key.value) : null);
const spreads = (el) => el.attributes.some((a) => a.type === "JSXSpreadAttribute");
const mk = (messages, create) => ({ meta: { type: "problem", schema: [], messages }, create });

/** Route pattern for a `app/**\/page.tsx` file, route groups removed. */
function routeOf(file) {
  const m = norm(file).match(/\/app\/(.*)page\.tsx$/);
  if (!m) return null;
  const segs = m[1].split("/").filter((s) => s && !/^\(.*\)$/.test(s));
  return "/" + segs.join("/");
}

// Rule 1: every number opens its rows.
const tallyFigureHref = mk(
  { href: "TallyFigure needs an href: every number opens its rows.", legacy: "{{name}} is retired. Use Tally." },
  (context) => ({
    ImportSpecifier(node) {
      const n = node.imported.name;
      if (n === "Metric" || n === "KpiRail") context.report({ node, messageId: "legacy", data: { name: n } });
    },
    JSXOpeningElement(node) {
      if (jsxName(node.name) === "TallyFigure" && !hasAttr(node, "href") && !spreads(node)) context.report({ node, messageId: "href" });
    },
  }),
);

// Rule 2: one Tally per route file, at the route's depth level.
const oneTally = mk(
  {
    many: "One Tally per page. A second Tally makes a second loud element.",
    level: "This route is level {{want}} in lib/depth.mjs; the Tally says level {{got}}.",
  },
  (context) => {
    const route = routeOf(context.filename);
    const want = route ? DEPTH_ROUTES[route] : undefined;
    let seen = 0;
    return {
      JSXOpeningElement(node) {
        if (jsxName(node.name) !== "Tally") return;
        if (++seen > 1) context.report({ node, messageId: "many" });
        const lv = attr(node, "level")?.value;
        const got = lv?.type === "JSXExpressionContainer" && lv.expression.type === "Literal" ? lv.expression.value : null;
        if (want && got && got !== want) context.report({ node, messageId: "level", data: { want, got } });
      },
    };
  },
);

// Rule 4: say the verdict in a sentence.
const tallyVerdict = mk(
  { missing: "A figure needs a verdict that says what is true now.", stop: "A verdict is a sentence. End it with a full stop." },
  (context) => {
    const endsOk = (v) => {
      if (v.type === "Literal" && typeof v.value === "string") return v.value.trim().endsWith(".");
      if (v.type === "TemplateLiteral") return v.quasis.at(-1).value.cooked.trim().endsWith(".") || v.expressions.length > 0 && v.quasis.at(-1).value.cooked === "";
      return true; // expressions and fragments are checked by eye
    };
    const checkValue = (node, v) => { if (v && !endsOk(v)) context.report({ node, messageId: "stop" }); };
    return {
      JSXOpeningElement(node) {
        if (jsxName(node.name) !== "TallyFigure") return;
        const a = attr(node, "verdict");
        if (!a && spreads(node)) return;
        if (!a) return context.report({ node, messageId: "missing" });
        const v = a.value?.type === "JSXExpressionContainer" ? a.value.expression : a.value;
        checkValue(a, v);
      },
      ObjectExpression(node) {
        const keys = new Set(node.properties.map(keyName));
        if (!(keys.has("label") && keys.has("value") && keys.has("href")) || keys.has("id")) return; // context rows carry an id
        const p = node.properties.find((q) => keyName(q) === "verdict");
        if (!p) return context.report({ node, messageId: "missing" });
        checkValue(p, p.value);
      },
    };
  },
);

// Rule 5: charts answer one question each, and every chart is clickable.
const CLICK = { LineChart: "onPointClick", BarChart: "onBarClick", DonutChart: "onSegmentClick" };
const chartRules = mk(
  { recharts: "Import charts from components/aurora/data, not recharts.", click: "{{name}} needs {{prop}}: every mark opens its rows." },
  (context) => {
    const inData = norm(context.filename).includes("/components/aurora/data/");
    return {
      ImportDeclaration(node) {
        if (!inData && node.source.value === "recharts") context.report({ node, messageId: "recharts" });
      },
      JSXOpeningElement(node) {
        const name = jsxName(node.name);
        const prop = name && CLICK[name];
        if (prop && !hasAttr(node, prop) && !spreads(node)) {
          context.report({ node, messageId: "click", data: { name, prop } });
        }
      },
    };
  },
);

// Rule 6: StatusBadge is the only severity renderer.
const severityViaBadge = mk(
  { raw: "Render severity with StatusBadge, not data-severity on a raw element." },
  (context) => {
    const f = norm(context.filename);
    if (f.includes("/components/ui-core/") || f.includes("/components/aurora/")) return {};
    return {
      JSXOpeningElement(node) {
        const n = jsxName(node.name);
        if (n && /^[a-z]/.test(n) && hasAttr(node, "data-severity")) context.report({ node, messageId: "raw" });
      },
    };
  },
);

// Rule 8: name SAP things the way SAP does.
const sapName = {
  meta: { type: "suggestion", schema: [], messages: { chip: "{{value}} is a SAP field. Show it in FieldChip or Mono." } },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value !== "string" || !/^[A-Z]{3,5}\.[A-Z_]{2,}$/.test(node.value)) return;
        // Plain data (keys, imports, test ids) is not copy: only JSX content is judged.
        const p = node.parent;
        const inJsx = p.type === "JSXExpressionContainer" || p.type === "JSXAttribute";
        if (!inJsx) return;
        for (let a = node.parent; a; a = a.parent) {
          if (a.type === "JSXElement" && ["FieldChip", "Mono"].includes(jsxName(a.openingElement.name))) return;
        }
        context.report({ node, messageId: "chip", data: { value: node.value } });
      },
    };
  },
};

// Rule 9: empty states direct, with no illustration.
const emptyStateNoMedia = mk({ media: "EmptyState has one sentence and one link. No <{{tag}}>." }, (context) => ({
  JSXOpeningElement(node) {
    const tag = jsxName(node.name);
    if (tag !== "img" && tag !== "svg") return;
    for (let a = node.parent?.parent; a; a = a.parent) {
      if (a.type === "JSXElement" && jsxName(a.openingElement.name) === "EmptyState") return context.report({ node, messageId: "media", data: { tag } });
    }
  },
}));

// Rule 10: nothing is invented. A percent needs a known total.
const noInventedProgress = mk({ total: "JobCard percent needs rows_total. Progress needs a known total." }, (context) => ({
  JSXOpeningElement(node) {
    if (jsxName(node.name) === "JobCard" && hasAttr(node, "percent") && !hasAttr(node, "rows_total")) context.report({ node, messageId: "total" });
  },
}));

// Rule 12: the URL is the state.
const STATE_NAME = /^(?:severity|module|tab|view|assignee|status)$/i;
const urlIsState = {
  meta: { type: "suggestion", schema: [], messages: { url: "'{{name}}' is a filter. Read it from useSearchParams so the URL is the state." } },
  create(context) {
    const f = norm(context.filename);
    if (!/\/(app\/\(dashboard\)|components\/(command-centre|workbench|data|analyse|process|admin))\//.test(f)) return {};
    return {
      CallExpression(node) {
        if (node.callee.name !== "useState") return;
        const d = node.parent;
        const id = d.type === "VariableDeclarator" && d.id.type === "ArrayPattern" ? d.id.elements[0] : null;
        if (id?.type === "Identifier" && STATE_NAME.test(id.name)) context.report({ node, messageId: "url", data: { name: id.name } });
      },
    };
  },
};

// Rule 16: one h1 per route, and PageHeader (or AuthFrame) owns it.
const oneH1 = mk({ h1: "Only PageHeader renders the h1. Use PageHeader, or a lower heading level." }, (context) => {
  const f = norm(context.filename);
  if (f.endsWith("/components/ui-core/index.tsx") || f.endsWith("/components/auth/auth-frame.tsx")) return {};
  const lit = (a) => (a?.value?.type === "Literal" ? a.value.value : a?.value?.expression?.value);
  return {
    JSXOpeningElement(node) {
      const n = jsxName(node.name);
      const as = lit(attr(node, "as"));
      if (n === "h1" || as === "h1" || (n === "Text" && !as && lit(attr(node, "variant")) === "display-lg")) context.report({ node, messageId: "h1" });
    },
  };
});

// Rule 17: a figure is a number. Words go in `text`, absence is null with a verdict.
const tallyFigureNumeric = mk(
  { str: "A figure's value is a number or null. Put a word or formatted figure in `text`.", fallback: "No string fallback in a figure. Use null and say why in the verdict." },
  (context) => {
    const bad = (n, node) => {
      if (n?.type === "Literal" && typeof n.value === "string") context.report({ node, messageId: "str" });
      else if (n?.type === "TemplateLiteral" && n.expressions.length === 0) context.report({ node, messageId: "str" });
      else if (n?.type === "LogicalExpression" && n.right.type === "Literal" && typeof n.right.value === "string") context.report({ node, messageId: "fallback" });
      else if (n?.type === "ConditionalExpression") { bad(n.consequent, node); bad(n.alternate, node); }
    };
    return {
      JSXOpeningElement(node) {
        if (!["Tally", "TallyFigure"].includes(jsxName(node.name))) return;
        const v = attr(node, "value")?.value;
        if (v?.type === "JSXExpressionContainer") bad(v.expression, node);
        else if (v?.type === "Literal") context.report({ node, messageId: "str" });
      },
      ObjectExpression(node) {
        const keys = new Set(node.properties.map(keyName));
        if (!(keys.has("label") && keys.has("value") && keys.has("href")) || keys.has("id")) return;
        const p = node.properties.find((q) => keyName(q) === "value");
        bad(p.value, p);
      },
    };
  },
);

export default {
  meta: { name: "aurora-structure", version: "1.0.0" },
  rules: {
    "tally-figure-href": tallyFigureHref,
    "one-tally": oneTally,
    "tally-verdict": tallyVerdict,
    "chart-rules": chartRules,
    "severity-via-badge": severityViaBadge,
    "sap-name-in-chip": sapName,
    "empty-state-no-media": emptyStateNoMedia,
    "no-invented-progress": noInventedProgress,
    "url-is-state": urlIsState,
    "one-h1": oneH1,
    "tally-figure-numeric": tallyFigureNumeric,
  },
};
