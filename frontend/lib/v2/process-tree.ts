import type { BusinessProcessL1, BusinessProcessL5Activity, BusinessProcessL5Field } from "@/types/api";
import { t } from "@/lib/v2/i18n";

/**
 * The L1 to L5 process document (GET /business-process/{run}/{module}) read as steps. A step is an L4 sub-process:
 * one transaction, with its activities (L5) and their fields. A step is blocked when the API marks it red: a field it
 * writes fails a critical or high rule, or passes under 70%.
 */

export type DQ = "green" | "amber" | "red";

/** Objects with an L1 to L5 definition (sap/process_definitions.py): the others have no process document. */
export const PROCESS_MODULES: ReadonlySet<string> = new Set([
  "accounts_payable", "mm_purchasing", "material_master", "fi_gl", "accounts_receivable", "sd_customer_master", "sd_sales_orders",
  "production_planning", "asset_accounting", "controlling", "plant_maintenance", "quality_management", "project_system", "hcm", "employee_central",
]);

export const DQ_WORD: Record<DQ, string> = { get green() { return t("Ready"); }, get amber() { return t("At risk"); }, get red() { return t("Blocked"); } };
export const DQ_VERDICT = { green: "go", amber: "at-risk", red: "no-go" } as const;

/** One failing rule inside a step, once, with the fields of the step it reads. */
export interface StepRule {
  checkId: string;
  message: string;
  fields: string[];
  affected: number;
  passRate: number | null;
}

export interface StepView {
  /** The L4 id, such as PTP-GR-MIGO. */
  id: string;
  l1Id: string;
  l1Name: string;
  l2Name: string;
  l3Name: string;
  name: string;
  tcode: string;
  description: string;
  status: DQ;
  blocked: boolean;
  /** 1-based position among the steps of its L1. */
  number: number;
  activities: BusinessProcessL5Activity[];
  fields: BusinessProcessL5Field[];
  /** The failing rules (a field with a red or amber status and a check), most records first. */
  rules: StepRule[];
  /** The most records any one of its rules fails; a record can fail several rules, so this is a floor. */
  recordsAtLeast: number;
}

/** `?open=step:<module>:<l4 id>`: the step inspector needs the object to find the document. */
export const stepRef = (module: string, l4: string): string => `${module}:${l4}`;

export function parseStepRef(ref: string): { module: string; step: string } | null {
  const at = ref.indexOf(":");
  if (at <= 0 || at === ref.length - 1) return null;
  return { module: ref.slice(0, at), step: ref.slice(at + 1) };
}

function rulesOf(fields: BusinessProcessL5Field[]): StepRule[] {
  const by = new Map<string, StepRule>();
  for (const f of fields) {
    if (f.dq_status === "green" || !f.check_id) continue;
    const prior = by.get(f.check_id);
    if (prior) {
      if (!prior.fields.includes(f.field)) prior.fields.push(f.field);
      prior.affected = Math.max(prior.affected, f.affected_count);
    } else by.set(f.check_id, { checkId: f.check_id, message: f.finding_message || f.description, fields: [f.field], affected: f.affected_count, passRate: f.pass_rate });
  }
  return [...by.values()].sort((a, b) => b.affected - a.affected || a.checkId.localeCompare(b.checkId));
}

/** Every step of the document in reading order, numbered within its L1. */
export function stepsOf(doc: readonly BusinessProcessL1[]): StepView[] {
  const out: StepView[] = [];
  for (const l1 of doc) {
    let n = 0;
    for (const l2 of l1.l2_groups) {
      for (const l3 of l2.l3_processes) {
        for (const l4 of l3.l4_subprocesses) {
          n += 1;
          const fields = l4.activities.flatMap((a) => a.fields);
          const rules = rulesOf(fields);
          out.push({
            id: l4.l4_id,
            l1Id: l1.l1_id,
            l1Name: l1.l1_name,
            l2Name: l2.l2_name,
            l3Name: l3.l3_name,
            name: l4.l4_name,
            tcode: l4.tcode,
            description: l4.description,
            status: l4.step_status,
            blocked: l4.step_status === "red",
            number: n,
            activities: l4.activities,
            fields,
            rules,
            recordsAtLeast: rules.reduce((m, r) => Math.max(m, r.affected), 0),
          });
        }
      }
    }
  }
  return out;
}

export function firstBlockedStep(doc: readonly BusinessProcessL1[]): StepView | null {
  return stepsOf(doc).find((s) => s.blocked) ?? null;
}

export function blockedCount(doc: readonly BusinessProcessL1[]): number {
  return stepsOf(doc).filter((s) => s.blocked).length;
}

/** The readiness of an L1 or L2 as the API's worst-of colouring. */
export function worstOf(statuses: readonly DQ[]): DQ {
  return statuses.includes("red") ? "red" : statuses.includes("amber") ? "amber" : "green";
}
