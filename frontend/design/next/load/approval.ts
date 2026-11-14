/**
 * Four-eyes approval of a load. The preparer gives the first approval; a different person gives the second. The
 * preparer can never give it, a reject needs a comment, and the load stays disabled until both approvals exist.
 */
import { t } from "@/lib/v2/i18n";
import type { ApprovalState } from "@/lib/api/next/load";

export type SecondBlock = "preparer" | "no-first" | "done" | "rejected" | "signed-out";

/** Why this user cannot give the second approval, or null when they can. */
export function secondBlock(s: ApprovalState, userId: string | null): SecondBlock | null {
  if (!userId) return "signed-out";
  if (s.rejected) return "rejected";
  if (s.second) return "done";
  if (!s.first) return "no-first";
  if (userId === s.preparer.id) return "preparer";
  return null;
}

/** A reject needs words. */
export const canReject = (comment: string) => comment.trim().length > 0;

export type LoadBlock = "no-first" | "no-second" | "rejected" | null;
export function loadBlock(s: ApprovalState): LoadBlock {
  if (s.rejected) return "rejected";
  if (!s.first) return "no-first";
  if (!s.second) return "no-second";
  return null;
}

export function loadReason(s: ApprovalState): string | undefined {
  switch (loadBlock(s)) {
    case "rejected": return t("The load was rejected; prepare it again.");
    case "no-first": return t("The preparer has not approved yet.");
    case "no-second": return t("Waiting for a second approval from someone other than {name}.", { name: s.preparer.name });
    default: return undefined;
  }
}

export function secondReason(b: SecondBlock): string {
  switch (b) {
    case "preparer": return t("You prepared this load; someone else must approve it");
    case "no-first": return t("The first approval is not given yet.");
    case "done": return t("The second approval is already given.");
    case "rejected": return t("The load was rejected.");
    case "signed-out": return t("Sign in to approve.");
  }
}
