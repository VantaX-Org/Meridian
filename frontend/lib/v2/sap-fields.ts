import { t } from "@/lib/v2/i18n";
/**
 * Business names of the SAP fields the record inspector meets most, for fields the API does not describe. These are
 * SAP's own standard field names (data elements), nothing Meridian invented. A field not listed shows its TABLE-FIELD
 * alone; the API's `field_descriptions` on a record, when present, win over this list.
 */
const DESCRIPTIONS: Record<string, string> = {
  get "MARA-MATNR"() { return t("Material number"); },
  get "MARA-MTART"() { return t("Material type"); },
  get "MARA-MATKL"() { return t("Material group"); },
  get "MARA-MEINS"() { return t("Base unit of measure"); },
  get "MARA-BRGEW"() { return t("Gross weight"); },
  get "MARA-NTGEW"() { return t("Net weight"); },
  get "MARA-GEWEI"() { return t("Weight unit"); },
  get "MAKT-MAKTX"() { return t("Material description"); },
  get "MARC-WERKS"() { return t("Plant"); },
  get "MARC-EKGRP"() { return t("Purchasing group"); },
  get "MARC-DISMM"() { return t("MRP type"); },
  get "MARC-BESKZ"() { return t("Procurement type"); },
  get "MBEW-BKLAS"() { return t("Valuation class"); },
  get "LFA1-LIFNR"() { return t("Vendor account number"); },
  get "LFA1-NAME1"() { return t("Name"); },
  get "LFA1-LAND1"() { return t("Country key"); },
  get "KNA1-KUNNR"() { return t("Customer number"); },
  get "KNA1-NAME1"() { return t("Name"); },
  get "KNA1-LAND1"() { return t("Country key"); },
  get "BUT000-PARTNER"() { return t("Business partner number"); },
  get "BUT000-BU_TYPE"() { return t("Business partner type"); },
  get "T001-BUKRS"() { return t("Company code"); },
  get "SKA1-SAKNR"() { return t("G/L account number"); },
  get "ANLA-ANLN1"() { return t("Main asset number"); },
};

/** "MARA.MEINS" and "MARA-MEINS" both read "MARA-MEINS". */
export const sapField = (field: string): string => field.replace(".", "-");

export function describeField(field: string, fromApi?: Record<string, string> | null): string | null {
  const key = sapField(field);
  return fromApi?.[field] ?? fromApi?.[key] ?? DESCRIPTIONS[key] ?? null;
}
