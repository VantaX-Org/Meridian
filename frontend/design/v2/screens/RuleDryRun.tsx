"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { runImpactDryRun, type ImpactResult } from "@/lib/api/v2/rule-impact";
import { errorSentence } from "@/lib/api/v2/client";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { DeltaBar, StackedBar, type StackPart } from "../charts";
import { Field, Gate } from "../forms";
import { Coded, EmptyFrame, ErrorFrame, Mono } from "../parts";
import { CcBanner, CcPage } from "./cc-parts";
import { Panel } from "./Mining";

/**
 * Rule impact dry run: what enabling, editing or adding one rule would do to an object, before anyone does it. The rule
 * runs read-only on the latest stored extraction (never SAP, nothing written to findings), on at most a stated number of
 * rows per table. Failing values are shown as counts by shape, never as values. Needs the manage rules permission.
 */

const CAPS = [10_000, 50_000, 200_000] as const;

export const pct = (n: number): string => `${n.toFixed(1)}%`;
const signed = (n: number): string => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;

/** Parse the optional changes box: a JSON object of rule fields to change, or null when empty. Throws on anything else. */
export function parseChanges(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null;
  const v: unknown = JSON.parse(text);
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new TypeError();
  return v as Record<string, unknown>;
}

export function RuleDryRun() {
  const q = useSearchParams();
  const { can } = useV2Session();
  const allowed = can("manage_rules");
  const [objectKey, setObjectKey] = useState(q.get("module") ?? "");
  const [ruleId, setRuleId] = useState(q.get("rule") ?? "");
  const [changes, setChanges] = useState("");
  const [cap, setCap] = useState<number>(50_000);
  const [bad, setBad] = useState<string | null>(null);
  const run = useMutation({ mutationFn: runImpactDryRun });

  const submit = () => {
    setBad(null);
    let rule: Record<string, unknown> | null;
    try {
      rule = parseChanges(changes);
    } catch {
      setBad(t("The changes must be a JSON object of rule fields, for example {example}.", { example: '{"pattern": "^[0-9]+$"}' }));
      return;
    }
    run.mutate({ module: objectKey.trim(), rule_id: ruleId.trim() || undefined, rule: rule ?? undefined, row_cap: cap });
  };
  const ready = objectKey.trim() !== "" && (ruleId.trim() !== "" || changes.trim() !== "");
  const r = run.data;

  return (
    <CcPage title={t("Rule dry run")}>
      <CcBanner
        testId="rule-dry-run"
        label={t("Rule dry run")}
        eyebrow={t("Rule dry run")}
        headline={r?.evaluated ? t("{n, plural, one {# record fails} other {# records fail}} this rule", { n: r.records_failing ?? 0 }) : t("See what a rule would do before you change it")}
        why={t("The rule runs on the latest stored extraction. Nothing is written and SAP is not called.")}
        figs={r?.evaluated ? [
          { label: t("Records checked"), value: int(r.records_evaluated ?? 0) },
          { label: t("Failure rate"), value: pct(r.failure_rate ?? 0) },
          { label: t("Score change"), value: signed(r.dqs?.delta ?? 0) },
        ] : []}
      />
      <Panel title={t("Rule to test")} meta={t("Name an existing rule, switched on or off. Add changes to test an edit, or leave the rule id empty and give a whole draft.")} testId="dry-run-form">
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Field label={t("Object")} hint={t("The object whose latest extraction is used, for example accounts_payable.")}>
            {(p) => <input {...p} className="m2-input" value={objectKey} onChange={(e) => setObjectKey(e.target.value)} data-testid="dry-run-module" />}
          </Field>
          <Field label={t("Rule id")}>
            {(p) => <input {...p} className="m2-input" value={ruleId} onChange={(e) => setRuleId(e.target.value)} data-testid="dry-run-rule" />}
          </Field>
          <Field label={t("Changes (JSON, optional)")} hint={t("Fields to change on the rule, or the whole draft when the rule id is empty.")} error={bad ?? undefined}>
            {(p) => <textarea {...p} className="m2-input" rows={4} value={changes} onChange={(e) => setChanges(e.target.value)} data-testid="dry-run-changes" />}
          </Field>
          <Field label={t("Rows per table")} hint={t("The first rows of each table are tested and the counts are scaled to the full table.")}>
            {(p) => (
              <select {...p} className="m2-input" value={cap} onChange={(e) => setCap(Number(e.target.value))} data-testid="dry-run-cap">
                {CAPS.map((c) => <option key={c} value={c}>{int(c)}</option>)}
              </select>
            )}
          </Field>
          <div className="m2-acts">
            <button type="submit" className="m2-btn m2-next" disabled={!allowed || !ready || run.isPending} data-testid="dry-run-go">
              {run.isPending ? t("Working…") : t("Run dry run")}
            </button>
          </div>
          {!allowed ? <Gate>{t("Running a dry run needs the manage rules permission.")}</Gate> : null}
        </form>
      </Panel>
      {run.isError ? <ErrorFrame onRetry={submit}>{errorSentence(run.error, t("The dry run could not be done."))}</ErrorFrame> : null}
      {r ? <Result r={r} /> : !run.isError ? <EmptyFrame>{t("Run a dry run to see the effect here.")}</EmptyFrame> : null}
    </CcPage>
  );
}

function Result({ r }: { r: ImpactResult }) {
  if (!r.evaluated) return <EmptyFrame>{r.reason ?? t("The rule could not be evaluated.")}</EmptyFrame>;
  const failing = r.records_failing ?? 0;
  const total = r.records_evaluated ?? 0;
  const split: StackPart[] = [
    { key: "fail", label: t("Failing"), value: failing, colour: "--m2-sev-crit", title: t("{n} of {total} records fail", { n: int(failing), total: int(total) }) },
    { key: "pass", label: t("Passing"), value: Math.max(0, total - failing), colour: "--m2-chart-1", title: t("{n} records pass", { n: int(Math.max(0, total - failing)) }) },
  ];
  const shapes = r.failing_shapes ?? [];
  const shapeParts: StackPart[] = shapes.map((s, i) => ({ key: s.shape, label: s.shape, value: s.count, colour: `--m2-chart-${(i % 8) + 1}`, title: t("{n} failing values of shape {shape}", { n: int(s.count), shape: s.shape }) }));
  const d = r.delta;
  const move: StackPart[] = d ? [
    { key: "new", label: t("Newly failing"), value: d.newly_failing, colour: "--m2-sev-crit", title: t("{n} records start to fail", { n: int(d.newly_failing) }) },
    { key: "still", label: t("Failing before and after"), value: d.unchanged_failing, colour: "--m2-sev-low", title: t("{n} records fail before and after", { n: int(d.unchanged_failing) }) },
    { key: "gone", label: t("Newly passing"), value: d.newly_passing, colour: "--m2-chart-1", title: t("{n} records start to pass", { n: int(d.newly_passing) }) },
  ] : [];
  return (
    <>
      <Panel title={t("Effect of the rule")} meta={r.mode === "edit" ? t("Edit of an existing rule") : t("New rule")} testId="dry-run-result">
        <p><Coded code={r.rule_id} text={r.rule.message} first /></p>
        <p>
          {r.rule.field ? <Coded code={r.rule.field} text={r.rule.field_text} /> : null}{" "}
          <span className="m2-meta">{moduleText(r.module)}</span>
        </p>
        <StackedBar parts={split} label={t("Records failing and passing")} format={int} testId="dry-run-split" />
        <p className="m2-meta" data-testid="dry-run-cap-note">
          {r.row_cap.sampled
            ? t("{cap} rows per table were tested and the counts are scaled to the full table.", { cap: int(r.row_cap.cap) })
            : t("Every row was tested, up to {cap} per table.", { cap: int(r.row_cap.cap) })}
        </p>
      </Panel>
      {r.dqs ? (
        <Panel title={t("Projected object score")} meta={t("The same scoring as a run, with this rule's result swapped in.")} testId="dry-run-dqs">
          <table className="m2-tbl">
            <thead>
              <tr>
                <th scope="col">{t("Before")}</th>
                <th scope="col">{t("After")}</th>
                <th scope="col">{t("Change")}</th>
                <th scope="col"><span className="m2-sr">{t("Change, drawn")}</span></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="m2-num">{r.dqs.before.toFixed(1)}</td>
                <td className="m2-num">{r.dqs.after.toFixed(1)}</td>
                <td className="m2-num" data-testid="dry-run-delta-score">{signed(r.dqs.delta)}</td>
                <td><DeltaBar d={r.dqs.delta} /></td>
              </tr>
            </tbody>
          </table>
        </Panel>
      ) : null}
      {d ? (
        <Panel title={t("Against the current rule")} meta={t("{n} records failed under the current rule.", { n: int(d.current_failing) })} testId="dry-run-edit">
          <StackedBar parts={move} label={t("Records newly failing and newly passing")} format={int} testId="dry-run-move" />
          <p data-testid="dry-run-edit-line">{t("{failing} newly failing, {passing} newly passing.", { failing: int(d.newly_failing), passing: int(d.newly_passing) })}</p>
        </Panel>
      ) : null}
      <Panel title={t("Failing values by shape")} meta={t("Counts only. A shape stands for a pattern, never a value: A is a letter, 9 a digit.")} testId="dry-run-shapes">
        {shapes.length === 0 ? <EmptyFrame>{t("No record fails.")}</EmptyFrame> : (
          <>
            <StackedBar parts={shapeParts} label={t("Failing values by shape")} format={int} />
            <ul className="m2-cl-changes">
              {shapes.map((s) => <li key={s.shape}><Mono>{s.shape}</Mono> <span className="m2-meta">{t("{n} values", { n: int(s.count) })}</span></li>)}
            </ul>
          </>
        )}
      </Panel>
    </>
  );
}
