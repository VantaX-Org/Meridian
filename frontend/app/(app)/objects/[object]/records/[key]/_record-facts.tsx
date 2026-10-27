// The record page's identity values and missing-field count, kept out of page.tsx (a page exports only its component).
import type { ReactNode } from "react";
import { Mono } from "@/design";
import type { Material360 } from "@/lib/api/materials";

/**
 * An identity field: its configured label when configuration names the value, else the raw value the record holds
 * (as the field sheet shows it, so Identity never reads "—" beside MTART=FERT), else a dash.
 */
export function identityValue(material: Pick<Material360, "labels" | "mara">, field: string): ReactNode {
  const label = material.labels[field];
  const raw = material.mara?.[field];
  if (label != null && String(label).trim() !== "") return label;
  if (raw != null && String(raw).trim() !== "") return <Mono>{raw}</Mono>;
  return "—";
}

/**
 * The record's required fields left blank: every field a failing rule reads whose value is empty, from the material
 * findings (actual_value) and the work list's issues (current_value), each field once.
 */
export function missingFields(byView: { failing: { field: string | null; actual_value: string | null }[] }[],
  issues: { field: string | null; current_value: string | null }[]): Set<string> {
  const blank = (v: string | null | undefined) => v == null || String(v).trim() === "";
  const out = new Set<string>();
  for (const v of byView) for (const r of v.failing) if (r.field && blank(r.actual_value)) out.add(r.field);
  for (const i of issues) if (i.field && blank(i.current_value)) out.add(i.field);
  return out;
}
