import { describe, expect, it } from "vitest";
import { describeField, describeTable, sapField } from "./sap-fields";

const FIELDS = [
  "MARA-MATNR", "MARA-MTART", "MARA-MATKL", "MARA-MEINS", "MARA-BRGEW", "MARA-NTGEW", "MARA-GEWEI", "MAKT-MAKTX", "MARC-WERKS",
  "MARC-EKGRP", "MARC-DISMM", "MARC-BESKZ", "MBEW-BKLAS", "LFA1-LIFNR", "LFA1-NAME1", "LFA1-LAND1", "KNA1-KUNNR", "KNA1-NAME1",
  "KNA1-LAND1", "BUT000-PARTNER", "BUT000-BU_TYPE", "T001-BUKRS", "MARA-MBRSH", "MARA-SPART", "MARA-MSTAE", "MBEW-VPRSV",
  "KNA1-KTOKD", "KNVV-KDGRP", "KNVV-VTWEG", "KNVV-SPART", "KNVP-PARVW", "KNB1-AKONT", "BSID-UMSKZ", "LFA1-KTOKK", "LFB1-AKONT",
  "LFB1-ZWELS", "BSIK-UMSKZ", "SKA1-SAKNR", "ANLA-ANLN1", "MARA-MFRPN", "MARA-MFRNR", "MARA-BISMT", "MARA-LVORM", "KNA1-STCD1",
  "KNA1-STCD2", "KNA1-STCEG", "KNA1-STRAS", "KNA1-PSTLZ", "KNA1-ORT01", "KNA1-TELF1", "KNA1-LOEVM", "KNA1-SPERR", "KNA1-AUFSD",
  "ADR6-SMTP_ADDR", "KNBK-BANKL", "KNBK-BANKN", "BUT000-XDELE", "BUT000-XBLCK", "PERINFO-PERSON_ID", "PERINFO-NATIONAL_ID",
  "PERINFO-NATIONAL_ID_COUNTRY", "PERINFO-DATE_OF_BIRTH", "PERINFO-FIRSTNAME", "PERINFO-LASTNAME", "PERINFO-GENDER",
  "PERINFO-NATIONALITY",
];
const TABLES = ["MARA", "MAKT", "MARC", "MARD", "MBEW", "MVKE", "MLAN", "MARM", "KNA1", "KNB1", "KNVV", "LFA1", "LFB1", "LFM1", "BUT000", "ADRC"];

describe("sap-fields", () => {
  it("reads TABLE.FIELD as TABLE-FIELD", () => {
    expect(sapField("MARA.MEINS")).toBe("MARA-MEINS");
    expect(sapField("MARA-MEINS")).toBe("MARA-MEINS");
  });

  it.each(FIELDS)("describes %s with its SAP business name", (f) => {
    expect(describeField(f)).toMatch(/\S/);
    expect(describeField(f.replace("-", "."))).toBe(describeField(f));
  });

  it("prefers the API's description, but not when it only echoes the field name", () => {
    expect(describeField("MARA.MEINS", { "MARA.MEINS": "Base unit (API)" })).toBe("Base unit (API)");
    expect(describeField("MARA.MEINS", { "MARA-MEINS": "From key" })).toBe("From key");
    expect(describeField("MARA.MEINS", { "MARA.MEINS": "MEINS" })).toBe("Base unit of measure");
    expect(describeField("MARA.MEINS", { "MARA.MEINS": "MARA.MEINS" })).toBe("Base unit of measure");
    expect(describeField("ZZZ.UNKNOWN")).toBeNull();
    expect(describeField("ZZZ.UNKNOWN", null)).toBeNull();
  });

  it.each(TABLES)("describes table %s in any case", (tbl) => {
    expect(describeTable(tbl)).toMatch(/\S/);
    expect(describeTable(tbl.toLowerCase())).toBe(describeTable(tbl));
  });

  it("returns null for a table it does not know", () => {
    expect(describeTable("ZTAB")).toBeNull();
  });
});

describe("describeField on a bare key part", () => {
  it("reads the catalogued text of the same field name", () => {
    expect(describeField("WERKS")).toBe("Plant");
    expect(describeField("BUKRS")).toBe("Company code");
  });

  it("stays null for a table field the catalogue lacks", () => {
    expect(describeField("ZTAB.WERKS")).toBeNull();
  });
});
