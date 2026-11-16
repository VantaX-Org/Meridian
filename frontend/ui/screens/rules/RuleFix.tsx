"use client";

import "./rules.css";
import { useState } from "react";
import { t } from "@/lib/v2/i18n";
import { Button, Field, Input, Select, StatTile, Toggle, EmptyState, DiffView } from "@/ui/kit";
import { RULE_VERSION_TRANSITIONS } from "@/lib/api/rule-authoring";
import { endSuppression, setRuleEnabled, transitionRuleVersion, type RuleVersionState } from "@/lib/api/v2/rulelib";
import { draftTunedVersion } from "@/lib/api/v2/pilot";
import { handOffRule, suppressRule, type RuleScope } from "@/lib/api/v2/object";
import { useStewards } from "@/lib/v2/object-queries";
import { pct } from "./format";
import { useAct, useFeedback, useSuppressions, useTuning, useVersionDiff } from "./queries";

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Everything that changes a rule: switch it, suppress it, tune it, hand it off, move its versions. */
export function RuleFix({ id, scope }: { id: string; scope: RuleScope }) {
  const [reason, setReason] = useState("");
  const [until, setUntil] = useState(inDays(30));
  const [assignee, setAssignee] = useState("");
  const [note, setNote] = useState("");
  const [due, setDue] = useState(inDays(14));
  const [diffAt, setDiffAt] = useState<number | null>(null);
  const feedback = useFeedback(id).data?.rules.find((r) => r.check_id === id);
  const sup = (useSuppressions().data?.suppressions ?? []).filter((s) => s.check_id === id && s.active);
  const tune = (useTuning().data?.proposals ?? []).filter((p) => p.rule_id === id);
  const stewards = useStewards(true).data ?? [];
  const rid = scope.tenant_rule?.id ?? id; // versions live on the tenant row
  const diff = useVersionDiff(rid, diffAt).data;

  const toggle = useAct((on: boolean) => setRuleEnabled(rid, on), () => t("Rule switch saved"));
  const suppress = useAct(() => suppressRule(id, reason, new Date(until).toISOString()), () => t("Rule suppressed"));
  const unsuppress = useAct((sid: string) => endSuppression(sid), () => t("Suppression ended"));
  const tuned = useAct((rid: string) => draftTunedVersion(rid), () => t("Tuned version drafted"));
  const hand = useAct(() => handOffRule({ check_id: id, module: scope.module ?? "", assignee_id: assignee, note, due_date: due }), () => t("Rule handed off"));
  const move = useAct((a: { version: number; to: RuleVersionState }) => transitionRuleVersion(rid, a.version, a.to), () => t("Version moved"));

  return (
    <div className="mx-rules-form">
      {scope.tenant_rule ? <Toggle label={t("Rule is on")} checked={scope.tenant_rule.enabled} onChange={(v) => toggle.mutate(v)} /> : <p className="mx-muted">{t("This rule is not in your library yet.")}</p>}

      <h3 className="mx-card-t">{t("Suppress")}</h3>
      <div className="mx-rules-row">
        <Field label={t("Reason")}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        <Field label={t("Until")}><Input type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
        <Button variant="secondary" disabled={!reason.trim() || suppress.isPending} onClick={() => suppress.mutate(undefined)}>{t("Suppress the rule")}</Button>
      </div>
      {sup.length ? (
        <ul className="mx-rules-list" aria-label={t("Active suppressions")}>
          {sup.map((s) => (
            <li key={s.id} className="mx-rules-item">
              <span>{s.reason}</span>
              <span className="mx-muted">{t("Until {date}", { date: s.expires_at.slice(0, 10) })}</span>
              <Button variant="ghost" onClick={() => unsuppress.mutate(s.id)}>{t("End suppression")}</Button>
            </li>
          ))}
        </ul>
      ) : null}

      <h3 className="mx-card-t">{t("Feedback")}</h3>
      {feedback ? (
        <dl className="mx-tiles">
          <StatTile label={t("Flagged by people")} value={feedback.flagged} />
          <StatTile label={t("Called false positive")} value={feedback.false_positive} />
          <StatTile label={t("Confirmed real")} value={feedback.real} />
          <StatTile label={t("False positive rate")} value={pct(feedback.false_positive_rate)} />
        </dl>
      ) : <p className="mx-muted">{t("Nobody has given feedback on this rule yet.")}</p>}

      <h3 className="mx-card-t">{t("Tuning")}</h3>
      {tune.length ? tune.map((p) => (
        <div key={p.rule_id} className="mx-rules-item">
          <p>{p.rationale}</p>
          <p className="mx-muted">{t("Precision {a} to {b}, {n} false positives removed, {m} real lost", { a: pct(p.precision_before), b: pct(p.precision_after), n: p.fp_removed, m: p.real_lost })}</p>
          {p.pending ? <p className="mx-muted">{t("Version {n} is waiting as {state}", { n: p.pending.version, state: p.pending.state })}</p> : <Button variant="secondary" disabled={tuned.isPending} onClick={() => tuned.mutate(p.rule_id)}>{t("Draft the tuned version")}</Button>}
        </div>
      )) : <p className="mx-muted">{t("No tuning is proposed for this rule.")}</p>}

      <h3 className="mx-card-t">{t("Hand off to a steward")}</h3>
      <div className="mx-rules-row">
        <Field label={t("Steward")}><Select value={assignee} onChange={(e) => setAssignee(e.target.value)} options={[{ value: "", label: t("Choose a steward") }, ...stewards.map((s) => ({ value: s.id, label: s.name ?? s.email }))]} /></Field>
        <Field label={t("Note")}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Field label={t("Due")}><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} /></Field>
        <Button variant="secondary" disabled={!assignee || hand.isPending} onClick={() => hand.mutate(undefined)}>{t("Hand off")}</Button>
      </div>

      <h3 className="mx-card-t">{t("Versions")}</h3>
      {scope.versions.length ? (
        <ul className="mx-rules-list" aria-label={t("Versions")}>
          {scope.versions.map((v) => (
            <li key={v.version} className="mx-rules-item">
              <span>{t("Version {n}, {state}", { n: v.version, state: v.state })}</span>
              <span className="mx-muted">{[v.author, v.note].filter(Boolean).join(", ")}</span>
              <div className="mx-rules-row">
                <Button variant="ghost" onClick={() => setDiffAt(v.version)}>{t("Show changes")}</Button>
                {(RULE_VERSION_TRANSITIONS[v.state as RuleVersionState] ?? []).map((to) => (
                  <Button key={to} variant="secondary" disabled={move.isPending} onClick={() => move.mutate({ version: v.version, to })}>{t("Move to {state}", { state: to })}</Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : <EmptyState heading={t("No versions yet")} />}
      {diff ? <DiffView label={t("Changes between versions")} diff={diff.diff} /> : null}
    </div>
  );
}
