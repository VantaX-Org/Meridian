/** Mirror of api/models/process_model.py. Optional `source` and `evidence` are set by config-derived flows. */

export type NodeType = "startEvent" | "endEvent" | "task" | "exclusiveGateway" | "parallelGateway";
export type Classification = "implemented" | "dormant" | "configured_not_used" | "customer_specific";
export type Evidence = "extracted" | "not_extracted";
export type DqColour = "green" | "amber" | "red";

export interface FieldRef {
  field: string;
  check_id: string | null;
  description: string;
  mandatory: boolean;
  config_source: string | null;
}

export interface DiagramNode {
  id: string;
  type: NodeType;
  activity_id: string | null;
  label: string | null;
  x: number | null;
  y: number | null;
  evidence?: Evidence | null;
}

export interface Flow {
  id: string;
  source: string;
  target: string;
  label: string | null;
  condition: string | null;
}

export interface Diagram {
  nodes: DiagramNode[];
  flows: Flow[];
}

export interface L5 {
  id: string;
  name: string;
  description: string;
  order: number;
  tcode: string | null;
  fields: FieldRef[];
  check_ids: string[];
  sap_tables: string[];
  evidence?: Evidence | null;
}

export interface VariantRef {
  sap_table: string;
  sap_field: string;
  value: string;
  classification: Classification;
}

export interface L4 {
  id: string;
  name: string;
  description: string;
  order: number;
  tcode: string | null;
  config_dependency: string | null;
  activities: L5[];
  diagram: Diagram;
  variants: VariantRef[];
}

export interface L3 { id: string; name: string; description: string; order: number; l4: L4[] }
export interface L2 { id: string; name: string; description: string; order: number; l3: L3[] }
export interface L1 { id: string; name: string; description: string; order: number; modules: string[]; l2: L2[] }

export interface ProcessModelDocument {
  schema_version: 1;
  l1: L1[];
  source?: string | null;
}

export interface ProcessVariant {
  id: string | null;
  version_id: string | null;
  process_id: string;
  l4_id: string | null;
  sap_table: string;
  sap_field: string;
  value: string;
  doc_count: number;
  first_seen: string | null;
  last_seen: string | null;
  classification: Classification;
  config_table: string | null;
  evidence: Evidence | null;
}

export interface ModelSummary {
  id: string;
  name: string;
  status: string;
  current_version: number;
  updated_at: string | null;
}

export interface ModelVersionRow {
  version_no: number;
  note: string | null;
  created_by: string | null;
  created_at: string | null;
}

export interface ActivityOverlay {
  dq_status: DqColour;
  pass_rate: number | null;
  affected_count: number;
  finding_count: number;
}

export interface ModelOverlay {
  activities: Record<string, ActivityOverlay>;
  l4: Record<string, { step_status: DqColour; variants: number }>;
  variants: ProcessVariant[];
}

export interface ValidationError { path: string; message: string }
