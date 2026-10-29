/**
 * Business names of the SAP fields the record inspector meets most, for fields the API does not describe. These are
 * SAP's own standard field names (data elements), nothing Meridian invented. A field not listed shows its TABLE-FIELD
 * alone; the API's `field_descriptions` on a record, when present, win over this list.
 */
const DESCRIPTIONS: Record<string, string> = {
  "MARA-MATNR": "Material number",
  "MARA-MTART": "Material type",
  "MARA-MATKL": "Material group",
  "MARA-MEINS": "Base unit of measure",
  "MARA-BRGEW": "Gross weight",
  "MARA-NTGEW": "Net weight",
  "MARA-GEWEI": "Weight unit",
  "MAKT-MAKTX": "Material description",
  "MARC-WERKS": "Plant",
  "MARC-EKGRP": "Purchasing group",
  "MARC-DISMM": "MRP type",
  "MARC-BESKZ": "Procurement type",
  "MBEW-BKLAS": "Valuation class",
  "LFA1-LIFNR": "Vendor account number",
  "LFA1-NAME1": "Name",
  "LFA1-LAND1": "Country key",
  "KNA1-KUNNR": "Customer number",
  "KNA1-NAME1": "Name",
  "KNA1-LAND1": "Country key",
  "BUT000-PARTNER": "Business partner number",
  "BUT000-BU_TYPE": "Business partner type",
  "T001-BUKRS": "Company code",
  "SKA1-SAKNR": "G/L account number",
  "ANLA-ANLN1": "Main asset number",
};

/** "MARA.MEINS" and "MARA-MEINS" both read "MARA-MEINS". */
export const sapField = (field: string): string => field.replace(".", "-");

export function describeField(field: string, fromApi?: Record<string, string> | null): string | null {
  const key = sapField(field);
  return fromApi?.[field] ?? fromApi?.[key] ?? DESCRIPTIONS[key] ?? null;
}
