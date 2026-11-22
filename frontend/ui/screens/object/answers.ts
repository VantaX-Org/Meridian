import { t } from "@/lib/v2/i18n";
import type { ChatAction } from "@/ui/kit";
import { compactCount } from "./format";
import type { ObjectData } from "./useObjectData";

export interface Answer { text: string; evidence: string[]; actions: ChatAction[]; chart?: { kind: "bar" | "line"; data: { label: string; value: number }[] } }
export type PromptId = "worst" | "cap" | "fix" | "target";

/**
 * Aletheia answers, derived locally from the object's own rule data. lib/api has no chat or ask endpoint, so nothing
 * here calls a model: every sentence quotes numbers the screen already holds, and the evidence chips list them.
 */
export function answerFor(id: PromptId, d: ObjectData, href: (seg: "proposed" | "manual", rule?: string) => string, openRule: (id: string) => void): Answer {
  const top = d.failing[0];
  const ruleAction = (rid: string): ChatAction => ({ id: `rule-${rid}`, label: t("Open the rule"), onClick: () => openRule(rid) });
  if (id === "worst") {
    if (!top) return { text: t("No rule fails in this run."), evidence: [], actions: [] };
    return {
      text: t("{rule} fails the most. It fails {n} records, and it is a {sev} rule.", { rule: top.check_id, n: compactCount(top.affected_count), sev: top.severity }),
      evidence: [top.name, t("{n} of {m} records fail", { n: compactCount(top.affected_count), m: compactCount(top.total_count) })],
      actions: [ruleAction(top.check_id), { id: "review", label: t("Review fixes"), href: href("proposed", top.check_id) }],
      chart: { kind: "bar", data: d.failing.slice(0, 5).map((x) => ({ label: x.check_id, value: x.affected_count })) },
    };
  }
  if (id === "cap") {
    if (!d.capped || d.capLevel === null) return { text: t("The score is not held down by a rule."), evidence: [], actions: [] };
    return {
      text: t("The score is held at {cap} because critical rules fail.", { cap: d.capLevel }),
      evidence: d.capIds,
      actions: d.capIds.slice(0, 2).map(ruleAction),
    };
  }
  if (id === "fix") {
    return {
      text: t("{n} records are open. {p} have a proposed fix and {m} need a person.", { n: compactCount(d.open), p: compactCount(d.proposed), m: compactCount(d.person) }),
      evidence: [t("{n} records", { n: compactCount(d.open) })],
      actions: [{ id: "review", label: t("Review fixes"), href: href("proposed") }, { id: "assign", label: t("Assign records"), href: href("manual") }],
    };
  }
  const s = d.pair?.last?.scores;
  if (!d.pair || !s) return { text: t("No target system is paired with this object yet."), evidence: [], actions: [] };
  return {
    text: t("{source} to {target}", { source: d.pair.source.name, target: d.pair.target.name }),
    evidence: [s.source, s.projected, s.actual].map((v, i) => `${[t("Source DQS"), t("Projected target DQS"), t("Actual target DQS")][i]}: ${v ?? t("n/a")}`),
    actions: [],
  };
}
