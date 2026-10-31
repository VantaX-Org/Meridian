/**
 * Record links fixture: the cross-object links relationship discovery wrote for ECC production, shaped like
 * api/routes/relationships.py. The filters work as the route's do: an object alone matches either end, an object and
 * a key match that one record in both directions, and ended links stay out unless asked for. The link types are the
 * five the migration seeds.
 */
import type { LinkType, RecordLink } from "../links";

export const NONE_LINKS = Symbol("not a record links path");

// from object, from key, to object, to key, type, link table, day in October, active, AI confidence (null: from SAP)
const ROWS: [string, string, string, string, string, string | null, number, boolean, number | null][] = [
  ["business_partner", "0001000412", "customer", "0000200318", "bp_is_customer", "KNA1", 30, true, null],
  ["business_partner", "0001000412", "vendor", "0000300412", "bp_is_vendor", "LFA1", 30, true, null],
  ["business_partner", "0001003318", "customer", "0000204411", "bp_is_customer", "KNA1", 30, true, null],
  ["business_partner", "0001000377", "vendor", "0000300377", "bp_is_vendor", "LFA1", 29, true, null],
  ["business_partner", "0001001108", "customer", "0000201108", "bp_is_customer", "KNA1", 29, false, null],
  ["material_master", "000000000010004711", "material_plant", "000000000010004711/1000", "material_at_plant", "MARC", 30, true, null],
  ["material_master", "000000000010004711", "material_plant", "000000000010004711/2000", "material_at_plant", "MARC", 30, true, null],
  ["material_master", "000000000010009120", "material_plant", "000000000010009120/1000", "material_at_plant", "MARC", 30, true, null],
  ["material_master", "000000000010007220", "material_plant", "000000000010007220/3000", "material_at_plant", "MARC", 28, true, null],
  ["fi_gl", "0000113100", "gl_company_code", "0000113100/1000", "gl_in_company_code", "SKB1", 27, true, null],
  ["fi_gl", "0000400000", "gl_company_code", "0000400000/1000", "gl_in_company_code", "SKB1", 27, true, null],
  ["accounts_payable", "0000300412", "vendor_company_code", "0000300412/1000", "vendor_in_company_code", "LFB1", 26, true, null],
  ["sd_customer_master", "0000200318", "customer_sales_area", "0000200318/1000/10/00", "customer_in_sales_org", "KNVV", 26, true, null],
  ["mm_purchasing", "4500017720/00010", "material_master", "000000000010004711", "po_references_material", "EKPO", 25, true, null],
  ["sd_sales_orders", "0000120044/000010", "material_master", "000000000010009120", "so_references_material", "VBAP", 25, true, null],
  ["plant_maintenance", "000000000010008801", "material_master", "000000000010007220", "equipment_uses_material", null, 24, true, 0.82],
  ["business_partner", "0001000877", "accounts_receivable", "0000200877/1000", "bp_has_open_items", null, 24, true, 0.71],
];

const links = (): RecordLink[] =>
  ROWS.map(([from_domain, from_key, to_domain, to_key, relationship_type, sap_link_table, d, active, conf], i) => ({
    id: `link-${i + 1}`, from_domain, from_key, to_domain, to_key, relationship_type, sap_link_table,
    discovered_at: `2026-10-${String(d).padStart(2, "0")}T02:10:00+00:00`, active, ai_inferred: conf != null,
    ai_confidence: conf, impact_score: conf == null ? null : Math.round(conf * 60) / 10,
  }));

const TYPES: LinkType[] = [
  ["BUT000", "KNA1", "bp_is_customer", "Business Partner is a Customer"],
  ["BUT000", "LFA1", "bp_is_vendor", "Business Partner is a Vendor"],
  ["MARA", "MARC", "material_at_plant", "Material exists at Plant"],
  ["SKA1", "SKB1", "gl_in_company_code", "GL Account in Company Code"],
  ["BSEG", "BUT000", "fi_posting_references_bp", "FI Posting references Business Partner"],
].map(([from_table, to_table, relationship_type, description], i) => ({ id: `type-${i + 1}`, from_table, to_table, relationship_type, description }));

export function linksRead(path: string, params: Record<string, unknown>): unknown {
  if (path === "/relationship-types") return TYPES;
  if (path !== "/relationships") return NONE_LINKS;
  const domain = params.domain as string | undefined;
  const key = params.key as string | undefined;
  const rows = links()
    .filter((l) => params.include_inactive === true || params.include_inactive === "true" || l.active)
    .filter((l) => !domain || (key ? (l.from_domain === domain && l.from_key === key) || (l.to_domain === domain && l.to_key === key) : l.from_domain === domain || l.to_domain === domain))
    .sort((a, b) => b.discovered_at.localeCompare(a.discovered_at));
  return { relationships: rows.slice(0, 200), total: rows.length };
}
