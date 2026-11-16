import type { FirewallModuleRow, HoldState, RecordHold, StewardRequest } from "@/lib/api/v2/dq-firewall";
import type { MdmSnapshot } from "@/lib/api/v2/mdm-health";
import type { AnomalyItem, DuplicatePair } from "@/lib/api/v2/mining";
import type { RequestObject, RequestStatus } from "@/lib/api/v2/requests";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";

/** Words and small derivations the master data screens share. Native copies, so nothing depends on design/v2. */

// --- Golden records health -------------------------------------------------------------------------------------
type Share = "golden_record_coverage_pct" | "avg_match_confidence" | "steward_sla_compliance_pct" | "source_consistency_pct";

/** The four shares in the score with their weights, as api/services/mdm_scoring.py weighs them. */
export const PARTS: { key: Share; weight: number; label: () => string; what: () => string }[] = [
  { key: "golden_record_coverage_pct", weight: 0.4, label: () => t("Golden record coverage"), what: () => t("Source records linked to a golden record") },
  { key: "avg_match_confidence", weight: 0.3, label: () => t("Match confidence"), what: () => t("Average confidence of the matches behind the golden records") },
  { key: "steward_sla_compliance_pct", weight: 0.2, label: () => t("Steward SLA"), what: () => t("Stewardship items resolved within their SLA") },
  { key: "source_consistency_pct", weight: 0.1, label: () => t("Source consistency"), what: () => t("Golden records whose sources agree") },
];

/** The points one share adds to the score. */
export const points = (s: MdmSnapshot, p: (typeof PARTS)[number]) => s[p.key] * p.weight * 100;

// --- Record links ----------------------------------------------------------------------------------------------
const TYPE_TEXT: Record<string, () => string> = {
  bp_is_customer: () => t("Business partner is a customer"),
  bp_is_vendor: () => t("Business partner is a vendor"),
  material_at_plant: () => t("Material exists at a plant"),
  gl_in_company_code: () => t("G/L account in a company code"),
  vendor_in_company_code: () => t("Vendor in a company code"),
  customer_in_company_code: () => t("Customer in a company code"),
  asset_in_cost_center: () => t("Asset in a cost centre"),
  pay_for_employee: () => t("Basic pay of an employee"),
  po_references_material: () => t("Purchase order item names a material"),
  equipment_in_plant: () => t("Equipment in a plant"),
  customer_in_sales_org: () => t("Customer in a sales area"),
  so_references_material: () => t("Sales order item names a material"),
  bom_references_material: () => t("Bill of material item names a material"),
  stock_in_bin: () => t("Stock in a storage bin"),
  batch_for_material: () => t("Batch of a material"),
  fleet_uses_equipment: () => t("Fleet object is a piece of equipment"),
  shipment_contains_delivery: () => t("Shipment contains a delivery"),
  interface_routes_to_warehouse: () => t("Interface routes to a warehouse"),
  mdg_change_for_entity: () => t("MDG change request for a record"),
  fi_posting_references_bp: () => t("FI posting names a business partner"),
};
export const typeText = (type: string) => TYPE_TEXT[type]?.() ?? null;

// --- Data mining -----------------------------------------------------------------------------------------------
export function byObject(dupes: readonly DuplicatePair[], outliers: readonly AnomalyItem[]): { module: string; dupes: number; outliers: number }[] {
  const by = new Map<string, { module: string; dupes: number; outliers: number }>();
  const at = (m: string) => by.get(m) ?? by.set(m, { module: m, dupes: 0, outliers: 0 }).get(m)!;
  for (const d of dupes) at(d.module_id).dupes += 1;
  for (const a of outliers) at(a.module_id).outliers += 1;
  return [...by.values()].sort((a, b) => b.dupes + b.outliers - (a.dupes + a.outliers));
}

/** The modules to mine per analysis run, from the landscape cells that have a run. */
export function runsToMine(cells: readonly { run_id?: string | null; module: string }[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of cells) if (c.run_id) out.set(c.run_id, [...new Set([...(out.get(c.run_id) ?? []), c.module])]);
  return out;
}

// --- Entry gate ------------------------------------------------------------------------------------------------
export const LICENSED_MODULES = ["material_master", "sd_customer_master", "employee_central"] as const;

export function moduleRows(rows: readonly FirewallModuleRow[]): { module: string; row: FirewallModuleRow | null }[] {
  return LICENSED_MODULES.map((m) => ({ module: m, row: rows.find((r) => r.module === m) ?? null }));
}

export function notOpenedWord(r: StewardRequest["reason"]): string {
  switch (r) {
    case "module_has_no_change_request": return t("This object has no change request, so nothing was opened. Hand the record to a steward another way.");
    case "over_limit": return t("Too many records in one call. Only the first 25 flagged records open a request.");
    case "not_accepted": return t("The change request refused this record, so nothing was opened.");
    default: return t("The request could not be opened. The verdict above still stands.");
  }
}

export function holdWord(s: HoldState): string {
  switch (s) {
    case "held": return t("Held");
    case "released": return t("Released");
    case "rejected": return t("Rejected");
    case "written": return t("Written");
    default: return t("Not held");
  }
}

export function holdNote(h: RecordHold): string {
  switch (h.state) {
    case "held": return t("Waiting for the approval workflow. The SAP save stops.");
    case "released": return t("Approved and released to the SAP save. The save may go on, even for a blocked record.");
    case "rejected": return t("Rejected by an approver. The SAP save stops. Changed content opens a new request.");
    case "written": return h.reason === "exported_as_load_file"
      ? t("Already taken as a load file. The SAP save stops, so the record is not created twice.")
      : t("Meridian writes or has written this record to SAP. The SAP save stops, so the record is not created twice.");
    default: return notOpenedWord(h.reason as StewardRequest["reason"]);
  }
}

export function statusWord(s: RequestStatus, releasedAt?: string | null): string {
  if (s === "approved" && releasedAt) return t("Released to the SAP save");
  const words: Record<RequestStatus, string> = {
    draft: t("Draft"), submitted: t("Submitted"), in_approval: t("In approval"), approved: t("Approved"), rejected: t("Rejected"),
    creating: t("Creating in SAP"), created: t("Created in SAP"), failed: t("Failed in SAP"), cancelled: t("Cancelled"),
  };
  return words[s] ?? s;
}

export function objectWord(o: RequestObject): string {
  const words: Record<RequestObject, string> = { material: t("Material"), customer: t("Customer"), vendor: t("Vendor"), business_partner: t("Business partner") };
  return words[o] ?? o;
}

/** Hours open as a short span: under two days in hours, else in days. */
export const ageWord = (h: number): string => (h < 48 ? t("{n} h", { n: int(Math.round(h)) }) : t("{n} d", { n: int(Math.round(h / 24)) }));
