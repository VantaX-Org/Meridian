#!/usr/bin/env node
/**
 * The v2 message extraction. It reads every file of the v2 interface (scripts/i18n-rules.mjs SCAN_ROOTS) and lists:
 *
 *   untranslated  a user-visible literal that does not go through t() or tx(): JSX text, a display attribute or
 *                 property, an argument, a return value or a template that reads as prose
 *   missing       a t() or tx() key the English catalogue (lib/v2/i18n/en.ts) does not have
 *   gaps          a key the German or Japanese catalogue leaves empty
 *
 * A deliberate literal carries `i18n-ignore` on its line or the line above. The CI test
 * (lib/v2/i18n/__tests__/extract.test.ts) fails on any untranslated literal, missing key or gap.
 *
 *   node scripts/i18n-extract.mjs            the report; exit 1 when anything is listed
 *   node scripts/i18n-extract.mjs --json     the same as JSON
 *   node scripts/i18n-extract.mjs --keys     every key with the first place it is used (for translators)
 *   node scripts/i18n-extract.mjs --write    adds each new key to en.ts (as itself) and to de.ts and ja.ts (empty,
 *                                            so the test fails until it is translated); keys are never removed
 */
import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { contextOf, ignored, inMetadata, isJsxWords, isProse, isProseTemplate, isTranslateCall, jsxParentName, jsxTextValue, listFiles, RAW_ELEMENTS } from "./i18n-rules.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The keys of one catalogue file (an object literal of string keys), with their values. */
export function readCatalogue(file) {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const out = new Map();
  const visit = (n) => {
    if (ts.isPropertyAssignment(n) && (ts.isStringLiteral(n.name) || ts.isIdentifier(n.name) || ts.isNoSubstitutionTemplateLiteral(n.name))) {
      const v = n.initializer;
      out.set(n.name.text, ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v) ? v.text : null);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** Scans the v2 files under `root`. */
export function extract(root = ROOT) {
  const keys = new Map();
  const untranslated = [];
  for (const file of listFiles(root)) {
    const src = readFileSync(join(root, file), "utf8");
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const at = (n) => `${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
    const visit = (n) => {
      if (isTranslateCall(n)) {
        const k = n.arguments[0];
        if (k && (ts.isStringLiteral(k) || ts.isNoSubstitutionTemplateLiteral(k))) {
          if (!keys.has(k.text)) keys.set(k.text, []);
          keys.get(k.text).push(at(k));
        }
        n.arguments.slice(1).forEach(visit);
        return;
      }
      if (ts.isJsxText(n)) {
        const v = jsxTextValue(src.slice(n.pos, n.end)).trim();
        if (isJsxWords(v) && !RAW_ELEMENTS.has(jsxParentName(n)) && !ignored(sf, n)) untranslated.push({ at: at(n), kind: "jsx text", text: v });
      } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
        if (isProse(n.text) && !ignored(sf, n) && !inMetadata(n) && contextOf(n) === "display") untranslated.push({ at: at(n), kind: "literal", text: n.text });
      } else if (ts.isTemplateExpression(n)) {
        if (isProseTemplate(n) && !ignored(sf, n) && !inMetadata(n) && contextOf(n) === "display") untranslated.push({ at: at(n), kind: "template", text: src.slice(n.getStart(sf), n.end) });
      }
      if (ts.isImportDeclaration(n) || ts.isTypeNode(n) || ts.isInterfaceDeclaration(n) || ts.isTypeAliasDeclaration(n)) return;
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  const en = readCatalogue(join(root, "lib/v2/i18n/en.ts"));
  const missing = [...keys.keys()].filter((k) => !en.has(k)).map((k) => ({ key: k, at: keys.get(k)[0] }));
  const gaps = [];
  for (const lang of ["de", "ja"]) {
    const cat = readCatalogue(join(root, `lib/v2/i18n/${lang}.ts`));
    for (const k of en.keys()) if (!cat.get(k)) gaps.push({ lang, key: k });
  }
  return { keys, untranslated, missing, gaps, catalogue: en };
}

const HEAD = {
  en: "/**\n * The English catalogue of the v2 interface: every message key, which is its English text. Keys are written in\n * the code as t(\"...\"); `node scripts/i18n-extract.mjs --write` adds new ones here and, empty, to de.ts and ja.ts.\n * A value may differ from its key only to reword English without touching the code.\n */\n",
  de: "/**\n * Deutsch. SAP-Begriffe wie in der deutschen SAP-Oberfläche (Materialstamm, Geschäftspartner, Buchungskreis, Werk,\n * Basismengeneinheit); Prüf-IDs, TABELLE.FELD und Lauf-IDs bleiben unübersetzt, sie stehen in Platzhaltern.\n */\n",
  ja: "/**\n * 日本語。SAP の用語は日本語版 SAP の画面に合わせます（品目マスタ、ビジネスパートナー、会社コード、プラント、基本数量単位）。\n * チェック ID、TABLE.FIELD、実行 ID は訳さず、プレースホルダーに入ります。\n */\n",
};

/** Writes the three catalogues from rows of [key, english, german, japanese], in the order given. */
export function writeCatalogues(rows, root = ROOT) {
  const body = (i) => rows.map((r) => `  ${JSON.stringify(r[0])}: ${JSON.stringify(r[i])},`).join("\n");
  writeFileSync(join(root, "lib/v2/i18n/en.ts"), `${HEAD.en}export const en = {\n${body(1)}\n} as const satisfies Record<string, string>;\n\nexport type MessageKey = keyof typeof en;\n`);
  for (const [lang, i] of [["de", 2], ["ja", 3]]) {
    writeFileSync(join(root, `lib/v2/i18n/${lang}.ts`), `${HEAD[lang]}import type { MessageKey } from "./en";\n\nexport const ${lang}: Readonly<Record<MessageKey, string>> = {\n${body(i)}\n};\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = extract();
  if (process.argv.includes("--write")) {
    const de = readCatalogue(join(ROOT, "lib/v2/i18n/de.ts"));
    const ja = readCatalogue(join(ROOT, "lib/v2/i18n/ja.ts"));
    const rows = [...r.catalogue.entries()].map(([k, v]) => [k, v ?? k, de.get(k) ?? "", ja.get(k) ?? ""]);
    const added = [...r.keys.keys()].filter((k) => !r.catalogue.has(k));
    for (const k of added) rows.push([k, k, "", ""]);
    writeCatalogues(rows);
    console.log(`${added.length} keys added; translate them in de.ts and ja.ts`);
    process.exit(0);
  }
  if (process.argv.includes("--keys")) {
    for (const [k, where] of r.keys) console.log(`${JSON.stringify(k)}\t${where[0]}`);
  } else if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ untranslated: r.untranslated, missing: r.missing, gaps: r.gaps, keys: r.keys.size }, null, 2));
  } else {
    for (const u of r.untranslated) console.log(`untranslated ${u.at}  ${u.kind}: ${u.text}`);
    for (const m of r.missing) console.log(`missing      ${m.at}  ${JSON.stringify(m.key)}`);
    for (const g of r.gaps) console.log(`gap          ${g.lang}  ${JSON.stringify(g.key)}`);
    console.log(`${r.keys.size} keys used, ${r.catalogue.size} in the catalogue, ${r.untranslated.length} untranslated, ${r.missing.length} missing, ${r.gaps.length} gaps`);
  }
  process.exit(r.untranslated.length || r.missing.length || r.gaps.length ? 1 : 0);
}
