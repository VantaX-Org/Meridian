import type { L4, ProcessModelDocument } from "@/types/process-model";
import { locate, patchActivity, findActivity, removeNode } from "@/lib/v2/process-doc";
import { t } from "@/lib/v2/i18n";

export const LEVEL_WORD: Readonly<Record<1 | 2 | 3 | 4 | 5, string>> = {
  get 1() { return t("Process"); },
  get 2() { return t("Area"); },
  get 3() { return t("Sub-process"); },
  get 4() { return t("Step"); },
  get 5() { return t("Activity"); },
};

/** TABLE.FIELD as SAP names them: capitals, digits, underscore and namespace slashes on both sides of one dot. */
export const FIELD_RE = /^[A-Z0-9_/]+\.[A-Z0-9_/]+$/;

export function fieldError(value: string, existing: readonly string[]): string | undefined {
  const v = value.trim().toUpperCase();
  if (!v) return t("Enter the field as TABLE.FIELD");
  if (!FIELD_RE.test(v)) return t("Use TABLE.FIELD, for example MARA.MATNR");
  if (existing.includes(v)) return t("This field is already mapped to the activity");
  return undefined;
}

/** Maps a field to an activity. Table and rule ids of the activity are recomputed from its fields. */
export function addField(d: ProcessModelDocument, actId: string, field: string): ProcessModelDocument {
  const hit = findActivity(d, actId);
  if (!hit) return d;
  return patchActivity(d, actId, { fields: [...hit.act.fields, { field: field.trim().toUpperCase(), check_id: null, description: "", mandatory: false, config_source: null }] });
}

export function removeField(d: ProcessModelDocument, actId: string, field: string): ProcessModelDocument {
  const hit = findActivity(d, actId);
  if (!hit) return d;
  return patchActivity(d, actId, { fields: hit.act.fields.filter((f) => f.field !== field) });
}

export function toggleMandatory(d: ProcessModelDocument, actId: string, field: string): ProcessModelDocument {
  const hit = findActivity(d, actId);
  if (!hit) return d;
  return patchActivity(d, actId, { fields: hit.act.fields.map((f) => (f.field === field ? { ...f, mandatory: !f.mandatory } : f)) });
}

/** Moves an activity of a step up or down and numbers them again. */
export function moveActivity(d: ProcessModelDocument, actId: string, dir: -1 | 1): ProcessModelDocument {
  const hit = findActivity(d, actId);
  if (!hit) return d;
  const next = structuredClone(d);
  const l4 = locate(next, hit.l4.id)?.item as L4 | undefined;
  if (!l4) return d;
  const i = l4.activities.findIndex((a) => a.id === actId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= l4.activities.length) return d;
  [l4.activities[i], l4.activities[j]] = [l4.activities[j], l4.activities[i]];
  l4.activities.forEach((a, k) => {
    a.order = k + 1;
  });
  return next;
}

/** Deletes an activity together with the task that draws it in the step's diagram. */
export function deleteActivity(d: ProcessModelDocument, actId: string): ProcessModelDocument {
  const hit = findActivity(d, actId);
  if (!hit) return d;
  const node = hit.l4.diagram.nodes.find((n) => n.activity_id === actId);
  if (node) return removeNode(d, hit.l4.id, node.id, true);
  const next = structuredClone(d);
  const l4 = locate(next, hit.l4.id)?.item as L4 | undefined;
  if (l4) l4.activities = l4.activities.filter((a) => a.id !== actId).map((a, k) => ({ ...a, order: k + 1 }));
  return next;
}

/** Structural change since the saved document, for the "unsaved changes" line. */
export const sameDoc = (a: ProcessModelDocument, b: ProcessModelDocument): boolean => JSON.stringify(a) === JSON.stringify(b);
