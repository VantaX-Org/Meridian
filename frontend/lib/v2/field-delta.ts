import type { FieldDef, FieldMapping } from "@/lib/api/v2/migration";

/**
 * The definition delta between a source field and the target field it maps to, read from the two DDIC definitions
 * the field map carries. Nothing is guessed: when either definition is missing the delta is "unknown".
 */
export type DeltaKind = "dropped" | "unknown" | "type" | "shorter" | "longer" | "decimals" | "check_table" | "same";

export interface Delta {
  kind: DeltaKind;
  from?: string | number | null;
  to?: string | number | null;
}

export function fieldDelta(m: Pick<FieldMapping, "dest_table" | "dest_field" | "source_def" | "target_def">): Delta[] {
  if (!m.dest_table || !m.dest_field) return [{ kind: "dropped" }];
  const s: FieldDef | null = m.source_def;
  const g: FieldDef | null = m.target_def;
  if (!s || !g || !s.type || !g.type) return [{ kind: "unknown" }];
  const out: Delta[] = [];
  if (s.type !== g.type) out.push({ kind: "type", from: s.type, to: g.type });
  if (s.length != null && g.length != null && s.length !== g.length) out.push({ kind: g.length < s.length ? "shorter" : "longer", from: s.length, to: g.length });
  if ((s.decimals ?? 0) !== (g.decimals ?? 0)) out.push({ kind: "decimals", from: s.decimals ?? 0, to: g.decimals ?? 0 });
  if ((s.check_table ?? null) !== (g.check_table ?? null)) out.push({ kind: "check_table", from: s.check_table, to: g.check_table });
  return out.length ? out : [{ kind: "same" }];
}

/** Changes that lose or reject data on load unless a transformation handles them. */
export const RISKY: ReadonlySet<DeltaKind> = new Set(["type", "shorter", "decimals", "check_table"]);

/** Whether the mapping still needs a transformation the steward has not written: a risky change with no note or value map. */
export const needsTransform = (m: Pick<FieldMapping, "dest_table" | "dest_field" | "source_def" | "target_def" | "transform_note" | "value_map">) =>
  !m.transform_note && !m.value_map && fieldDelta(m).some((d) => RISKY.has(d.kind));
