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
  get "MARA-MBRSH"() { return t("Industry sector"); },
  get "MARA-SPART"() { return t("Division"); },
  get "MARA-MSTAE"() { return t("Cross-plant material status"); },
  get "MBEW-VPRSV"() { return t("Price control indicator"); },
  get "KNA1-KTOKD"() { return t("Customer account group"); },
  get "KNVV-KDGRP"() { return t("Customer group"); },
  get "KNVV-VTWEG"() { return t("Distribution channel"); },
  get "KNVV-SPART"() { return t("Division"); },
  get "KNVP-PARVW"() { return t("Partner function"); },
  get "KNB1-AKONT"() { return t("Reconciliation account"); },
  get "BSID-UMSKZ"() { return t("Special G/L indicator"); },
  get "LFA1-KTOKK"() { return t("Vendor account group"); },
  get "LFB1-AKONT"() { return t("Reconciliation account"); },
  get "LFB1-ZWELS"() { return t("Payment methods"); },
  get "BSIK-UMSKZ"() { return t("Special G/L indicator"); },
  get "SKA1-SAKNR"() { return t("G/L account number"); },
  get "ANLA-ANLN1"() { return t("Main asset number"); },
  // Match profile and consolidation pack fields (workers/tasks/run_match.py, api/services/consolidation_pack.py).
  get "MARA-MFRPN"() { return t("Manufacturer part number"); },
  get "MARA-MFRNR"() { return t("Manufacturer"); },
  get "MARA-BISMT"() { return t("Old material number"); },
  get "MARA-LVORM"() { return t("Flag material for deletion at client level"); },
  get "KNA1-STCD1"() { return t("Tax number 1"); },
  get "KNA1-STCD2"() { return t("Tax number 2"); },
  get "KNA1-STCEG"() { return t("VAT registration number"); },
  get "KNA1-STRAS"() { return t("Street and house number"); },
  get "KNA1-PSTLZ"() { return t("Postal code"); },
  get "KNA1-ORT01"() { return t("City"); },
  get "KNA1-TELF1"() { return t("First telephone number"); },
  get "KNA1-LOEVM"() { return t("Central deletion flag for master record"); },
  get "KNA1-SPERR"() { return t("Central posting block"); },
  get "KNA1-AUFSD"() { return t("Central order block for customer"); },
  get "ADR6-SMTP_ADDR"() { return t("E-mail address"); },
  get "KNBK-BANKL"() { return t("Bank key"); },
  get "KNBK-BANKN"() { return t("Bank account number"); },
  get "BUT000-XDELE"() { return t("Central archiving flag"); },
  get "BUT000-XBLCK"() { return t("Central block for business partner"); },
  get "PERINFO-PERSON_ID"() { return t("Person ID"); },
  get "PERINFO-NATIONAL_ID"() { return t("National ID"); },
  get "PERINFO-NATIONAL_ID_COUNTRY"() { return t("National ID country"); },
  get "PERINFO-DATE_OF_BIRTH"() { return t("Date of birth"); },
  get "PERINFO-FIRSTNAME"() { return t("First name"); },
  get "PERINFO-LASTNAME"() { return t("Last name"); },
  get "PERINFO-GENDER"() { return t("Gender"); },
  get "PERINFO-NATIONALITY"() { return t("Nationality"); },
};

/** "MARA.MEINS" and "MARA-MEINS" both read "MARA-MEINS". */
export const sapField = (field: string): string => field.replace(".", "-");

export function describeField(field: string, fromApi?: Record<string, string> | null): string | null {
  const key = sapField(field);
  // The API falls back to the field name itself when the catalogue has no text; that is not a description.
  const api = [fromApi?.[field], fromApi?.[key]].find((d) => d && d !== field && d !== key && d !== field.split(".").pop());
  return api ?? DESCRIPTIONS[key] ?? null;
}

/** SAP's standard short texts of the tables a record's fields come from (SE11 descriptions). */
const TABLES: Record<string, string> = {
  get MARA() { return t("General material data"); },
  get MAKT() { return t("Material descriptions"); },
  get MARC() { return t("Plant data for material"); },
  get MARD() { return t("Storage location data for material"); },
  get MBEW() { return t("Material valuation"); },
  get MVKE() { return t("Sales data for material"); },
  get MLAN() { return t("Tax classification for material"); },
  get MARM() { return t("Units of measure for material"); },
  get KNA1() { return t("Customer master: general data"); },
  get KNB1() { return t("Customer master: company code data"); },
  get KNVV() { return t("Customer master: sales data"); },
  get LFA1() { return t("Vendor master: general data"); },
  get LFB1() { return t("Vendor master: company code data"); },
  get LFM1() { return t("Vendor master: purchasing organisation data"); },
  get BUT000() { return t("Business partner: general data"); },
  get ADRC() { return t("Addresses"); },
};

export const describeTable = (table: string): string | null => TABLES[table.toUpperCase()] ?? null;
