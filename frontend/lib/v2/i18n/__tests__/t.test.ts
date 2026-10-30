import { afterEach, describe, expect, it } from "vitest";
import { CATALOGUES, currentLang, langOf, setLang, t, tx } from "../index";
import { formatMessage } from "../icu";

afterEach(() => setLang("en"));

describe("formatMessage: the ICU subset", () => {
  it("fills simple placeholders and leaves a missing one visible", () => {
    expect(formatMessage("Run {run_at}", { run_at: "16 Oct" }, "en")).toBe("Run 16 Oct");
    expect(formatMessage("Run {run_at}", {}, "en")).toBe("Run {run_at}");
  });

  it("picks the English plural forms, with # as the count in the locale's digits", () => {
    const m = "{n, plural, one {# rule} other {# rules}}";
    expect(formatMessage(m, { n: 1 }, "en-US")).toBe("1 rule");
    expect(formatMessage(m, { n: 0 }, "en-US")).toBe("0 rules");
    expect(formatMessage(m, { n: 1234 }, "en-US")).toBe("1,234 rules");
    expect(formatMessage(m, { n: 1234 }, "de-DE")).toBe("1.234 rules");
  });

  it("takes an exact =n branch before the plural category", () => {
    const m = "{n, plural, =0 {nothing} one {one thing} other {# things}}";
    expect(formatMessage(m, { n: 0 }, "en")).toBe("nothing");
    expect(formatMessage(m, { n: 1 }, "en")).toBe("one thing");
    expect(formatMessage(m, { n: 3 }, "en")).toBe("3 things");
  });

  it("follows the locale's plural rules: Japanese has only other", () => {
    const m = "{n, plural, one {ONE} other {OTHER}}";
    expect(formatMessage(m, { n: 1 }, "ja-JP")).toBe("OTHER");
    expect(formatMessage(m, { n: 1 }, "de-DE")).toBe("ONE");
  });

  it("selects by value, falling back to other", () => {
    const m = "{kind, select, rule {a rule} system {a system} other {something}}";
    expect(formatMessage(m, { kind: "rule" }, "en")).toBe("a rule");
    expect(formatMessage(m, { kind: "job" }, "en")).toBe("something");
  });

  it("nests placeholders inside plural branches", () => {
    expect(formatMessage("{n, plural, one {# record in {where}} other {# records in {where}}}", { n: 2, where: "ECC" }, "en")).toBe("2 records in ECC");
  });
});

describe("t() and tx()", () => {
  it("writes English by default", () => {
    expect(currentLang()).toBe("en");
    expect(t("Landscape")).toBe("Landscape");
    expect(t("{systemsCount} {systemsCount, plural, one {system} other {systems}}", { systemsCount: 1 })).toBe("1 system");
    expect(t("{systemsCount} {systemsCount, plural, one {system} other {systems}}", { systemsCount: 3 })).toBe("3 systems");
  });

  it("writes German with German plurals and SAP vocabulary", () => {
    setLang("de", "de-DE");
    expect(t("Landscape")).toBe("Landschaft");
    expect(t("{systemsCount} {systemsCount, plural, one {system} other {systems}}", { systemsCount: 1 })).toBe("1 System");
    expect(t("{systemsCount} {systemsCount, plural, one {system} other {systems}}", { systemsCount: 2 })).toBe("2 Systeme");
    expect(tx("Material master")).toBe("Materialstamm");
    expect(t("Company code")).toBe("Buchungskreis");
    expect(t("Plant")).toBe("Werk");
    expect(t("Base unit of measure")).toBe("Basismengeneinheit");
    expect(tx("Business partner")).toBe("Geschäftspartner");
  });

  it("writes Japanese, with one form for every count", () => {
    setLang("ja", "ja-JP");
    expect(t("Landscape")).toBe("ランドスケープ");
    expect(tx("Material master")).toBe("品目マスタ");
    expect(t("Company code")).toBe("会社コード");
    expect(t("Plant")).toBe("プラント");
    expect(t("Base unit of measure")).toBe("基本数量単位");
    expect(tx("Business partner")).toBe("ビジネスパートナー");
    expect(t("{systemsCount} {systemsCount, plural, one {system} other {systems}}", { systemsCount: 1 })).toBe("1 件のシステム");
  });

  it("keeps check ids, TABLE.FIELD and run ids as placeholders, untranslated", () => {
    setLang("de", "de-DE");
    expect(t("Fix for {check_id}", { check_id: "MM142" })).toBe("Korrektur für MM142");
    expect(t("Lineage: {field} to {id} to {value}", { field: "MARA.MEINS", id: "MM142", value: "MIGO" })).toContain("MARA.MEINS");
  });

  it("falls back to English for a key a language leaves empty, and to the key itself for an unknown one", () => {
    setLang("de", "de-DE");
    const de = CATALOGUES.de as Record<string, string>;
    const before = de["Landscape"];
    de["Landscape"] = "";
    try {
      expect(t("Landscape")).toBe("Landscape");
    } finally {
      de["Landscape"] = before;
    }
    expect(tx("A label the server invented")).toBe("A label the server invented");
  });

  it("reads the language from a locale tag", () => {
    expect(langOf("de-CH")).toBe("de");
    expect(langOf("ja")).toBe("ja");
    expect(langOf("fr-FR")).toBe("en");
    expect(langOf(null)).toBe("en");
    setLang("de", "de-AT");
    expect(t("{n} {n2, plural, one {record} other {records}}", { n: "1.234", n2: 1234 })).toBe("1.234 Datensätze");
  });
});

describe("the catalogues", () => {
  const en = CATALOGUES.en as Record<string, string>;
  it("translate every English key into German and Japanese", () => {
    for (const lang of ["de", "ja"] as const) {
      const cat = CATALOGUES[lang] as Record<string, string>;
      const missing = Object.keys(en).filter((k) => !cat[k]);
      expect(missing, `${lang} leaves keys untranslated`).toEqual([]);
    }
  });

  it("render every message in every language without throwing", () => {
    for (const lang of ["en", "de", "ja"] as const) {
      setLang(lang);
      for (const k of Object.keys(en)) expect(typeof tx(k, { n: 2, count: 2 })).toBe("string");
    }
  });
});
