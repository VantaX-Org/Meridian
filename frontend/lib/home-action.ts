/**
 * The persona home's primary action (the verdict's one button), chosen from the persona and what the viewer may do.
 * Pure, so each role's landing action is testable without rendering the home.
 */
import { APPROVALS_HREF, approvesOnly } from "@/lib/persona";
import type { DoNext } from "@/lib/do-next";

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

/** The one step of a persona home: the sentence "Next: ..." and the "Do next" cell state, and the button that does it. */
export interface HomeStep {
  sentence: string;
  label: string;
  href: string;
}

export const FIX_WORK_HREF = "/fix";
export const PROPOSALS_HREF = "/rules/drafts?tab=ai";

export interface HomeStepInput extends HomeActionInput {
  /** The viewer's top to-do item's title, for the sentence when `attention` is given. */
  attentionTitle?: string;
  /** AI rule proposals waiting for this reviewer. */
  proposals?: number;
  /** `doNext()` over the scope's objects (lib/do-next.ts), or null when nothing is scored. */
  next?: DoNext | null;
  /** The steward's records to fix (shell counts `fix`), or null/undefined when no work list is built. */
  recordsToFix?: number | null;
  /** The steward has fixes under way (proposed in the work list): "Continue in Fix work" instead of "Start fixing". */
  fixStarted?: boolean;
  /** The first failing active system, for Basis. */
  failingSystem?: string;
}

const count = (n: number) => n.toLocaleString("en-US");

/**
 * The one next step of a persona home, from one source so the hero button, the "Next:" line above it and the
 * "Do next" cell can never differ. In order:
 * 1. the viewer's top to-do item (`attention`, tier 3 or better);
 * 2. the persona's own step: AI proposals to review, the auditor's audit log, the data owner's approvals, the
 *    steward's Fix work, Basis's systems;
 * 3. otherwise the score's step (`doNext`), and when nothing is scored the persona's generic action.
 * Pure.
 */
export function homeStep(input: HomeStepInput): HomeStep {
  const { persona, can, attention, attentionTitle, proposals = 0, next, recordsToFix, fixStarted, failingSystem } = input;
  if (attention) return { sentence: (attentionTitle ?? attention.label).replace(/\.$/, ""), ...attention };
  if (proposals > 0) {
    return { sentence: `${count(proposals)} AI rule ${proposals === 1 ? "proposal waits" : "proposals wait"} for your review`, label: `Review ${count(proposals)} ${proposals === 1 ? "proposal" : "proposals"}`, href: PROPOSALS_HREF };
  }
  if (persona === "lead") {
    const readOnly = readOnlyLeadAction(can);
    if (readOnly) return { sentence: "Read the audit log for what changed", ...readOnly };
  }
  if (persona === "steward") {
    if (approvesOnly(can)) return { sentence: "Fixes wait for your approval", label: "Open approvals", href: APPROVALS_HREF };
    // Nothing to fix (a built work list that is clear) leaves the score's step.
    if (can("apply") && recordsToFix !== 0) {
      const what = recordsToFix ? `${count(recordsToFix)} ${recordsToFix === 1 ? "record needs" : "records need"} fixing` : "Records need fixing";
      return { sentence: what, label: fixStarted ? "Continue in Fix work" : "Start fixing", href: FIX_WORK_HREF };
    }
  }
  if (persona === "basis") {
    return input.systemFailing
      ? { sentence: `${failingSystem ?? "A connected system"} is not healthy`, label: "Open failed system", href: "/systems" }
      : { sentence: "Check that every connected system is healthy", label: "Open systems", href: "/systems" };
  }
  if (next) return { sentence: next.sentence, label: next.action.label, href: next.action.href };
  const action = homeActionFor({ ...input, attention: undefined });
  const below = input.belowTarget;
  return { sentence: below ? `${count(below)} ${below === 1 ? "object is" : "objects are"} below target` : "Have a look over the objects; nothing stands out", ...action };
}
