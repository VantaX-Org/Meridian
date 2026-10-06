/**
 * The SAP material master maintenance views (MM01/MM02), each with the tables its rules anchor on.
 * Mirrors checks/views/material_master.yaml and docs/material-master-rules.md; the API holds the
 * authoritative rule-to-view assignment, this list gives the page its labels and table order.
 */
export interface MmView {
  id: string;
  label: string;
  tables: readonly string[];
  transaction?: string;
}

export const MM_VIEWS: readonly MmView[] = [
  { id: "basic_data", label: "Basic data and descriptions", tables: ["MARA", "MAKT", "MEAN", "MARC"], transaction: "MM02" },
  { id: "classification", label: "Classification", tables: ["KLAH", "CABN", "AUSP", "KSSK", "INOB", "CAWN"], transaction: "CL20N" },
  { id: "sales", label: "Sales", tables: ["MVKE", "MLAN", "MARC"], transaction: "MM02" },
  { id: "purchasing", label: "Purchasing and foreign trade", tables: ["MARC", "MARA", "EINE", "EINA"], transaction: "MM02" },
  { id: "mrp", label: "MRP", tables: ["MARC", "MDMA"], transaction: "MM02" },
  { id: "work_scheduling", label: "Work scheduling and production", tables: ["MARC", "MKAL", "MAST", "MAPL"], transaction: "MM02" },
  { id: "storage", label: "Storage and warehouse", tables: ["MARD", "MLGN", "MLGT"], transaction: "MM02" },
  { id: "quality", label: "Quality (MM view level)", tables: ["QMAT", "MARC"], transaction: "MM02" },
  { id: "accounting", label: "Accounting and costing", tables: ["MBEW", "CKMLHD"], transaction: "MM02" },
  { id: "batch", label: "Batch management", tables: ["MCH1"], transaction: "MSC2N" },
  { id: "units", label: "Units of measure", tables: ["MARM", "MEAN"], transaction: "MM02" },
  { id: "supersession", label: "Supersession and discontinuation", tables: ["MARC", "STPO", "MBEW"], transaction: "MM02" },
  { id: "lifecycle", label: "Lifecycle and cross-level", tables: ["MARC", "MARD", "MARA", "MLGN", "MLGT"], transaction: "MM02" },
];
