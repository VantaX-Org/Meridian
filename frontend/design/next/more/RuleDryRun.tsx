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
import Link from "next/link";
import { Button, Chip, Code, EmptyState, ErrorState, StatCard, Stepper, type StepItem } from "../kit";
import { SegBar } from "../kit/viz";

/** A failure rate as a percentage with one decimal. */
export const pct = (n: number) => `${n.toFixed(1)}%`;
const signed = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}`;

/** The changes box: empty means none, otherwise it must hold a JSON object of rule fields. */
export function parseChanges(text: string): Record<string, unknown> | null {
  if (text.trim() === "") return null;
  const v: unknown = JSON.parse(text);
  if (v === null || typeof v !== "object" || Array.isArray(v)) throw new TypeError();
  return v as Record<string, unknown>;
}

const CAPS = [10 * 1000, 50 * 1000, 200 * 1000];

/**
 * Rule impact dry run, native: what enabling, editing or adding one rule would do to an object before anyone does it.
 * The rule runs read-only on the latest stored extraction, on at most a stated number of rows per table.
 */
export function RuleDryRun() {
  const q = useSearchParams();
  const session = useV2Session();
  const allowed = session.can("manage_rules");
  const [objectKey, setObjectKey] = useState(q.get("module") ?? "");
  const [ruleId, setRuleId] = useState(q.get("rule") ?? "");
  const [changes, setChanges] = useState("");
  const [cap, setCap] = useState(50 * 1000);
  const [bad, setBad] = useState<string | null>(null);
  const run = useMutation({ mutationFn: runImpactDryRun });

  const ready = objectKey.trim() !== "" && (ruleId.trim() !== "" || changes.trim() !== "");
  const submit = () => {
    let rule: Record<string, unknown> | null;
    try {
      rule = parseChanges(changes);
    } catch {
      setBad(t("The changes must be a JSON object of rule fields, for example {example}.", { example: '{"pattern": "^[0-9]+$"}' }));
      return;
    }
    setBad(null);
    run.mutate({ module: objectKey.trim(), rule_id: ruleId.trim() || undefined, rule: rule ?? undefined, row_cap: cap });
  };

  const r = run.data;
  const current = r ? 2 : ready ? 1 : 0;
  const labels = [t("Choose the rule"), t("Run it on current data"), t("Read the effect"), t("Decide what to do")];
  const steps: StepItem[] = labels.map((label, i) => ({ id: String(i), label, state: i < current ? "done" : i === current ? "current" : "future" }));

  return (
    <div className="nx-body" data-testid="rule-dry-run">
      <section className="nx-card">
        <h2>{r?.evaluated ? t("{n, plural, one {# record fails} other {# records fail}} this rule", { n: r.records_failing ?? 0 }) : t("See what a rule would do before you change it")}</h2>
        <p className="nx-sub">{t("Test a rule or a draft on the latest stored data before it goes live. Nothing is written. Fill in the form, then run it.")}</p>
        <p className="nx-sub">{t("The rule runs on the latest stored extraction. Nothing is written and SAP is not called.")}</p>
        {r?.evaluated ? (
          <div className="nx-statgrid">
            <StatCard label={t("Records checked")} value={r.records_evaluated ?? 0} />
            <StatCard label={t("Failure rate")} value={r.failure_rate ?? 0} format={pct} />
            <StatCard label={t("Score change")} value={r.dqs?.delta ?? 0} format={signed} />
          </div>
        ) : null}
        {r?.evaluated ? (
          <ul className="nx-sub">
            <li>{t("Records the rule could read, scaled from the rows tested.")}</li>
            <li>{t("Share of checked records that fail the rule.")}</li>
            <li>{t("Points the object score would move if the rule were live.")}</li>
          </ul>
        ) : null}
      </section>

      <div data-testid="dry-run-steps">
        <Stepper steps={steps} label={t("Dry run steps")} />
      </div>

      <section className="nx-card" data-testid="dry-run-form">
        <h2>{t("Rule to test")}</h2>
        <p className="nx-sub">{t("Name an existing rule, switched on or off. Add changes to test an edit, or leave the rule id empty and give a whole draft.")}</p>
        <div className="nx-form">
          <label className="nx-field">
            <span>{t("Object")}</span>
            <input className="nx-input nx-mono" value={objectKey} onChange={(e) => setObjectKey(e.target.value)} data-testid="dry-run-module" />
            <small className="nx-sub">{t("The object whose latest extraction is used, for example accounts_payable.")}</small>
          </label>
          <label className="nx-field">
            <span>{t("Rule id")}</span>
            <input className="nx-input nx-mono" value={ruleId} onChange={(e) => setRuleId(e.target.value)} data-testid="dry-run-rule" />
          </label>
          <label className="nx-field">
            <span>{t("Changes (JSON, optional)")}</span>
            <textarea className="nx-input nx-mono" rows={4} value={changes} aria-invalid={bad ? true : undefined} onChange={(e) => setChanges(e.target.value)} data-testid="dry-run-changes" />
            <small className="nx-sub">{t("Fields to change on the rule, or the whole draft when the rule id is empty.")}</small>
            {bad ? <small className="nx-banner" data-tone="bad" role="alert">{bad}</small> : null}
          </label>
          <label className="nx-field">
            <span>{t("Rows per table")}</span>
            <select className="nx-input" value={cap} onChange={(e) => setCap(Number(e.target.value))} data-testid="dry-run-cap">
              {CAPS.map((c) => <option key={c} value={c}>{int(c)}</option>)}
            </select>
            <small className="nx-sub">{t("The first rows of each table are tested and the counts are scaled to the full table.")}</small>
          </label>
        </div>
        {allowed ? (
          <div className="nx-row nx-wrap">
            <Button variant="primary" disabled={!ready} loading={run.isPending} loadingLabel={t("Working…")} onClick={submit} data-testid="dry-run-go">
              {t("Run the draft against current data")}
            </Button>
            <span className="nx-sub">{ready ? t("Shows how many records would fail, before anything changes.") : t("Name an object and a rule id or changes first.")}</span>
          </div>
        ) : (
          <p className="nx-sub" data-testid="dry-run-gate">{t("Running a dry run needs the manage rules permission.")}</p>
        )}
        {!r ? <p className="nx-sub">{t("A dry run reads up to {cap} rows per table from the latest stored extraction. It writes nothing and does not call SAP.", { cap: int(cap) })}</p> : null}
      </section>

      {run.isError ? (
        <ErrorState sentence={errorSentence(run.error, t("The dry run could not be done."))} onRetry={submit} />
      ) : !r ? (
        run.isPending ? null : <EmptyState heading={t("Run a dry run to see the effect here.")} />
      ) : !r.evaluated ? (
        <p className="nx-banner" data-tone="warn">{r.reason ?? t("The rule could not be evaluated.")}</p>
      ) : (
        <Result r={r} />
      )}
    </div>
  );
}

function Result({ r }: { r: ImpactResult }) {
  const failing = r.records_failing ?? 0;
  const total = r.records_evaluated ?? 0;
  const d = r.delta;
  const shapes = r.failing_shapes ?? [];
  return (
    <>
      <section className="nx-card" data-testid="dry-run-result">
        <h2>{t("Effect of the rule")}</h2>
        <p className="nx-sub">{r.mode === "edit" ? t("Edit of an existing rule") : t("New rule")}</p>
        <div className="nx-cell-stack">
          <Code code={r.rule_id} text={r.rule.message ?? undefined} />
          {r.rule.field ? <Code code={r.rule.field} text={r.rule.field_text} /> : null}
          <span>{moduleText(r.module)}</span>
        </div>
        <p className="nx-sub">{t("Records failing and passing")}</p>
        <SegBar
          testid="dry-run-split"
          format={int}
          segs={[
            { key: "fail", label: t("Failing"), value: failing, tone: "bad" },
            { key: "pass", label: t("Passing"), value: Math.max(0, total - failing), tone: "good" },
          ]}
        />
        <p className="nx-sub">
          {t("{n} of {total} records fail", { n: int(failing), total: int(total) })}. {t("{n} records pass", { n: int(Math.max(0, total - failing)) })}.
        </p>
        <p className="nx-row nx-wrap" data-testid="dry-run-next">
          <span>{t("Happy with the effect? Open the rule to switch it on or edit it.")}</span>
          <Link className="nx-btn nx-btn-quiet" href={`/more/rules/${encodeURIComponent(r.rule_id)}`}>{t("Open the rule")}</Link>
        </p>
        <p className="nx-sub" data-testid="dry-run-cap-note">
          {r.row_cap.sampled
            ? t("{cap} rows per table were tested and the counts are scaled to the full table.", { cap: int(r.row_cap.cap) })
            : t("Every row was tested, up to {cap} per table.", { cap: int(r.row_cap.cap) })}
        </p>
      </section>

      {r.dqs ? (
        <section className="nx-card" data-testid="dry-run-dqs">
          <h2>{t("Projected object score")}</h2>
          <p className="nx-sub">{t("The same scoring as a run, with this rule's result swapped in.")}</p>
          <div className="nx-statgrid">
            <StatCard label={t("Before")} value={r.dqs.before} format={(n) => n.toFixed(1)} />
            <StatCard label={t("After")} value={r.dqs.after} format={(n) => n.toFixed(1)} />
            <div className="nx-cell-stack">
              <span className="nx-sub">{t("Change")}</span>
              <span data-testid="dry-run-delta-score">
                <Chip tone={r.dqs.delta < 0 ? "bad" : r.dqs.delta > 0 ? "good" : "neutral"}>{signed(r.dqs.delta)}</Chip>
              </span>
            </div>
          </div>
        </section>
      ) : null}

      {d ? (
        <section className="nx-card" data-testid="dry-run-edit">
          <h2>{t("Against the current rule")}</h2>
          <p className="nx-sub">{t("{n} records failed under the current rule.", { n: int(d.current_failing) })}</p>
          <p className="nx-sub">{t("Records newly failing and newly passing")}</p>
          <SegBar
            testid="dry-run-move"
            format={int}
            segs={[
              { key: "new", label: t("Newly failing"), value: d.newly_failing, tone: "bad" },
              { key: "same", label: t("Failing before and after"), value: d.unchanged_failing, tone: "warn" },
              { key: "fixed", label: t("Newly passing"), value: d.newly_passing, tone: "good" },
            ]}
          />
          <ul className="nx-sub">
            <li>{t("{n} records start to fail", { n: int(d.newly_failing) })}</li>
            <li>{t("{n} records fail before and after", { n: int(d.unchanged_failing) })}</li>
            <li>{t("{n} records start to pass", { n: int(d.newly_passing) })}</li>
          </ul>
          <p data-testid="dry-run-edit-line">{t("{failing} newly failing, {passing} newly passing.", { failing: int(d.newly_failing), passing: int(d.newly_passing) })}</p>
        </section>
      ) : null}

      <section className="nx-card" data-testid="dry-run-shapes">
        <h2>{t("Failing values by shape")}</h2>
        <p className="nx-sub">{t("Counts only. A shape stands for a pattern, never a value: A is a letter, 9 a digit.")}</p>
        {shapes.length === 0 ? (
          <p className="nx-sub">{t("No record fails.")}</p>
        ) : (
          <>
            <SegBar format={int} segs={shapes.map((s, i) => ({ key: s.shape, label: t("{n} failing values of shape {shape}", { n: int(s.count), shape: s.shape }), value: s.count, tone: i === 0 ? "bad" : "data" }))} />
            <ul className="nx-checklist">
              {shapes.map((s) => (
                <li key={s.shape} className="nx-row">
                  <span className="nx-mono">{s.shape}</span>
                  <span className="nx-sub">{t("{n} values", { n: int(s.count) })}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </>
  );
}
