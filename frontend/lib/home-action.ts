/**
 * The persona home's primary action (the verdict's one button), chosen from the persona and what the viewer may do.
 * Pure, so each role's landing action is testable without rendering the home.
 */
import { APPROVALS_HREF, approvesOnly } from "@/lib/persona";

export interface HomeAction {
  label: string;
  href: string;
}

export interface HomeActionInput {
  persona: "lead" | "steward" | "basis";
  can: (action: string) => boolean;
  /** Objects below target (at risk or no-go) in scope. */
  belowTarget: number;
  /** The objects list, filtered to objects below target when `filtered`. */
  objectsHref: (filtered: boolean) => string;
  /** The steward's worst object, when one is scored. */
  worstHref?: string;
  /** Basis: an active system reports failed or degraded health. */
  systemFailing: boolean;
  /** The viewer's top to-do item as a button (lib/attention.ts `attentionAction`, tier 3 or better). It wins when present. */
  attention?: HomeAction;
}

/** Actions that change something: a role holding none of them has nothing on the home to act on. */
const ACTING = ["upload", "analyse", "approve", "apply", "assign", "manage_systems", "trigger_sync", "manage_rules", "mdm.write"] as const;

export const AUDIT_LOG_HREF = "/admin/audit";

/** True when the viewer may act on none of the home's work (an auditor, a viewer). */
export const actsOnNothing = (can: (action: string) => boolean): boolean => !ACTING.some((a) => can(a));

/**
 * The lead home's action for a read-only role, or null to keep the lead's own. The auditor (view_audit, nothing to
 * act on) reads the audit log. Other read-only roles add their branch here (the AI reviewer's is owned elsewhere).
 */
export function readOnlyLeadAction(can: (action: string) => boolean): HomeAction | null {
  if (!actsOnNothing(can)) return null;
  if (can("view_audit")) return { label: "Open audit log", href: AUDIT_LOG_HREF };
  return null;
}

export function homeActionFor({ persona, can, belowTarget, objectsHref, worstHref, systemFailing, attention }: HomeActionInput): HomeAction {
  if (attention) return attention;
  if (persona === "lead") {
    return readOnlyLeadAction(can)
      ?? { label: belowTarget ? "Open objects below target" : "Open objects", href: objectsHref(belowTarget > 0) };
  }
  if (persona === "steward") {
    // A data owner approves but cannot apply: their work is the approvals tab, not a record to fix.
    if (approvesOnly(can)) return { label: "Open approvals", href: APPROVALS_HREF };
    return { label: "Open worst object", href: worstHref ?? objectsHref(false) };
  }
  return { label: systemFailing ? "Open failed system" : "Open systems", href: "/systems" };
}
