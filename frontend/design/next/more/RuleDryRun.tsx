"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { runImpactDryRun, type ImpactResult } from "@/lib/api/v2/rule-impact";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { int } from "@/lib/v2/score";
import { TableExport } from "@/design/v2/TableExport";
import { parseChanges, pct } from "@/design/v2/screens/RuleDryRun";
import { Button, EmptyState, ErrorState, StatCard } from "../kit";
import { StackedBar, type Seg } from "../viz";
import { Denied } from "./states";

const CAPS = [10_000, 50_000, 200_000] as const;
const signed = (n: number): string => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;
const SHAPE_TONES: Seg["tone"][] = ["chart1", "chart2", "chart3", "warn", "mute"];

/**
 * Rule dry run in the new kit: what enabling, editing or adding one rule would do to an object, read-only on the latest
 * stored extraction. Same API and the same checks as the earlier screen; failing values are counts by shape, never values.
 */
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

  const ready = objectKey.trim() !== "" && (ruleId.trim() !== "" || changes.trim() !== "");
  const submit = () => {
    if (!allowed || !ready || run.isPending) return;
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
  const r = run.data;

  return (
    <div className="nx-body" data-testid="rule-dry-run">
      <p className="nx-sub">{t("Test a rule or a draft on the latest stored data before it goes live. Nothing is written. Fill in the form, then run it.")}</p>
      {r?.evaluated ? (
        <div className="nx-chartcards">
          <StatCard label={t("Records checked")} value={r.records_evaluated ?? 0} />
          <StatCard label={t("Failure rate")} value={r.failure_rate ?? 0} format={pct} />
          <StatCard label={t("Score change")} value={r.dqs?.delta ?? 0} format={signed} />
        </div>
      ) : null}
      {!allowed ? <Denied what={t("Rule dry run")}>{t("Running a dry run needs the manage rules permission.")}</Denied> : null}
      <form className="nx-card nx-form" data-testid="dry-run-form" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <h3>{t("Rule to test")}</h3>
        <p className="nx-sub">{t("Name an existing rule, switched on or off. Add changes to test an edit, or leave the rule id empty and give a whole draft.")}</p>
        <label className="nx-field">{t("Object")}
          <input className="nx-input" value={objectKey} onChange={(e) => setObjectKey(e.target.value)} data-testid="dry-run-module" placeholder={t("The object whose latest extraction is used, for example accounts_payable.")} />
        </label>
        <label className="nx-field">{t("Rule id")}
          <input className="nx-input" value={ruleId} onChange={(e) => setRuleId(e.target.value)} data-testid="dry-run-rule" />
        </label>
        <label className="nx-field">{t("Changes (JSON, optional)")}
          <textarea className="nx-input" rows={4} value={changes} onChange={(e) => setChanges(e.target.value)} data-testid="dry-run-changes" aria-invalid={bad ? true : undefined} />
          <span>{bad ?? t("Fields to change on the rule, or the whole draft when the rule id is empty.")}</span>
        </label>
        <label className="nx-field">{t("Rows per table")}
          <select className="nx-input" value={cap} onChange={(e) => setCap(Number(e.target.value))} data-testid="dry-run-cap">
            {CAPS.map((c) => <option key={c} value={c}>{int(c)}</option>)}
          </select>
          <span>{t("The first rows of each table are tested and the counts are scaled to the full table.")}</span>
        </label>
        <div>
          <Button type="submit" variant="primary" disabled={!allowed || !ready} loading={run.isPending} loadingLabel={t("Working…")} reason={ready ? undefined : t("Name an object and a rule id or changes first.")} data-testid="dry-run-go">
            {t("Run the draft against current data")}
          </Button>
        </div>
        {!r ? <p className="nx-sub">{t("A dry run reads up to {cap} rows per table from the latest stored extraction. It writes nothing and does not call SAP.", { cap: int(cap) })}</p> : null}
      </form>
      {run.isError ? <ErrorState error={run.error} fallback={t("The dry run could not be done.")} onRetry={submit} /> : null}
      {r ? <Result r={r} /> : !run.isError ? <EmptyState heading={t("Rule dry run")}>{t("Run a dry run to see the effect here.")}</EmptyState> : null}
    </div>
  );
}

function Result({ r }: { r: ImpactResult }) {
  if (!r.evaluated) return <EmptyState heading={t("Rule dry run")}>{r.reason ?? t("The rule could not be evaluated.")}</EmptyState>;
  const failing = r.records_failing ?? 0;
  const total = r.records_evaluated ?? 0;
  const split: Seg[] = [
    { id: "fail", label: t("Failing"), value: failing, tone: "bad" },
    { id: "pass", label: t("Passing"), value: Math.max(0, total - failing), tone: "good" },
  ];
  const shapes = r.failing_shapes ?? [];
  const d = r.delta;
  return (
    <>
      <section className="nx-card nx-form" data-testid="dry-run-result">
        <h3>{t("Effect of the rule")}</h3>
        <p className="nx-sub">{r.mode === "edit" ? t("Edit of an existing rule") : t("New rule")}</p>
        <p><code>{r.rule_id}</code> {r.rule.message}</p>
        <p className="nx-sub">{r.rule.field ? <><code>{r.rule.field}</code> {r.rule.field_text} </> : null}{moduleText(r.module)}</p>
        <div data-testid="dry-run-split"><StackedBar segs={split} label={t("Records failing and passing")} /></div>
        <p data-testid="dry-run-next">{t("Happy with the effect? Open the rule to switch it on or edit it.")} <Link href={`/more/rules/${encodeURIComponent(r.rule_id)}`} className="nx-link">{t("Open the rule")}</Link></p>
        <p className="nx-sub" data-testid="dry-run-cap-note">
          {r.row_cap.sampled
            ? t("{cap} rows per table were tested and the counts are scaled to the full table.", { cap: int(r.row_cap.cap) })
            : t("Every row was tested, up to {cap} per table.", { cap: int(r.row_cap.cap) })}
        </p>
      </section>
      {r.dqs ? (
        <section className="nx-card nx-form" data-testid="dry-run-dqs">
          <h3>{t("Projected object score")}</h3>
          <p className="nx-sub">{t("The same scoring as a run, with this rule's result swapped in.")}</p>
          <TableExport><table className="nx-table">
            <thead><tr><th scope="col" className="nx-th">{t("Before")}</th><th scope="col" className="nx-th">{t("After")}</th><th scope="col" className="nx-th">{t("Change")}</th></tr></thead>
            <tbody><tr>
              <td>{r.dqs.before.toFixed(1)}</td>
              <td>{r.dqs.after.toFixed(1)}</td>
              <td data-testid="dry-run-delta-score">{signed(r.dqs.delta)}</td>
            </tr></tbody>
          </table></TableExport>
        </section>
      ) : null}
      {d ? (
        <section className="nx-card nx-form" data-testid="dry-run-edit">
          <h3>{t("Against the current rule")}</h3>
          <p className="nx-sub">{t("{n} records failed under the current rule.", { n: int(d.current_failing) })}</p>
          <StackedBar
            label={t("Records newly failing and newly passing")}
            segs={[
              { id: "new", label: t("Newly failing"), value: d.newly_failing, tone: "bad" },
              { id: "still", label: t("Failing before and after"), value: d.unchanged_failing, tone: "mute" },
              { id: "gone", label: t("Newly passing"), value: d.newly_passing, tone: "good" },
            ]}
          />
          <p data-testid="dry-run-edit-line">{t("{failing} newly failing, {passing} newly passing.", { failing: int(d.newly_failing), passing: int(d.newly_passing) })}</p>
        </section>
      ) : null}
      <section className="nx-card nx-form" data-testid="dry-run-shapes">
        <h3>{t("Failing values by shape")}</h3>
        <p className="nx-sub">{t("Counts only. A shape stands for a pattern, never a value: A is a letter, 9 a digit.")}</p>
        {shapes.length === 0 ? <p className="nx-sub">{t("No record fails.")}</p> : (
          <>
            <StackedBar label={t("Failing values by shape")} segs={shapes.map((s, i) => ({ id: s.shape, label: s.shape, value: s.count, tone: SHAPE_TONES[i % SHAPE_TONES.length] }))} />
            <ul className="nx-pick">
              {shapes.map((s) => <li key={s.shape} className="nx-row"><code>{s.shape}</code> <span className="nx-sub">{t("{n} values", { n: int(s.count) })}</span></li>)}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
