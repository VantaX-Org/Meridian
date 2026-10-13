/** Form model of one rule draft. The API takes the rule as YAML; JSON is valid YAML, so the form serialises with JSON.stringify. */

import type { CheckClass } from "@/lib/api/rules";

export const CHECK_CLASSES: CheckClass[] = [
  "null_check", "domain_value_check", "regex_check", "cross_field_check", "dependency_check", "uniqueness_check",
];
export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export const DIMENSIONS = ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"] as const;

export interface DraftForm {
  id: string;
  module: string;
  field: string;
  check_class: string;
  severity: string;
  dimension: string;
  message: string;
  /** Every other key of the rule (pattern, allowed_values, fail_when, ...), as JSON text. */
  conditions: string;
}

export const EMPTY_FORM: DraftForm = {
  id: "", module: "", field: "", check_class: "null_check", severity: "medium", dimension: "completeness", message: "", conditions: "{}",
};

const FORM_KEYS = new Set(["id", "rule_id", "module", "field", "check_class", "severity", "dimension", "message"]);

/** Form values from a rule object (a saved draft's `proposed_rule`, or a generated rule). */
export function ruleToForm(rule: Record<string, unknown> | null | undefined, module: string): DraftForm {
  const r = rule ?? {};
  const str = (v: unknown, fallback = "") => (typeof v === "string" ? v : fallback);
  const rest = Object.fromEntries(Object.entries(r).filter(([k]) => !FORM_KEYS.has(k)));
  return {
    id: str(r.id, str(r.rule_id)),
    module,
    field: str(r.field),
    check_class: str(r.check_class, EMPTY_FORM.check_class),
    severity: str(r.severity, EMPTY_FORM.severity),
    dimension: str(r.dimension, EMPTY_FORM.dimension),
    message: str(r.message),
    conditions: JSON.stringify(rest, null, 2),
  };
}

export type ConditionsResult = { ok: true; value: Record<string, unknown> } | { ok: false; error: string };

/** The conditions text must be one JSON object. */
export function parseConditions(text: string): ConditionsResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: {} };
  try {
    const value: unknown = JSON.parse(trimmed);
    if (value === null || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Conditions must be a JSON object" };
    return { ok: true, value: value as Record<string, unknown> };
  } catch (e) {
    return { ok: false, error: `Conditions are not valid JSON: ${e instanceof Error ? e.message : "parse error"}` };
  }
}

/** Field-level problems the form can catch before the API does. */
export function validateForm(f: DraftForm): Partial<Record<keyof DraftForm, string>> {
  const errors: Partial<Record<keyof DraftForm, string>> = {};
  if (!f.id.trim()) errors.id = "Enter a rule id";
  if (!f.module.trim()) errors.module = "Choose an object";
  if (!f.message.trim()) errors.message = "Enter the message stewards will see";
  const c = parseConditions(f.conditions);
  if (!c.ok) errors.conditions = c.error;
  return errors;
}

/** The rule object the API validates; form fields win over a same-named key in the conditions. */
export function formToRule(f: DraftForm): Record<string, unknown> {
  const c = parseConditions(f.conditions);
  const rule: Record<string, unknown> = {
    ...(c.ok ? c.value : {}),
    id: f.id.trim(),
    check_class: f.check_class,
    severity: f.severity,
    dimension: f.dimension,
    message: f.message.trim(),
  };
  if (f.field.trim()) rule.field = f.field.trim();
  return rule;
}

export function formToBody(f: DraftForm, rationale?: string): { module: string; rule_yaml: string; rationale?: string } {
  return { module: f.module.trim(), rule_yaml: JSON.stringify(formToRule(f), null, 2), ...(rationale ? { rationale } : {}) };
}
