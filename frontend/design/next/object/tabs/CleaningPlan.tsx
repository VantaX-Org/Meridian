"use client";

import { useQuery } from "@tanstack/react-query";
import { getCleaningPlan, type CleaningBatch, type CleaningItem, type CleaningPlan as Plan, type EngineOffReason, type RuleChange, type RuleRange } from "@/lib/api/v2/aletheia-engine";
import { useFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import { Code, DataTable, ErrorState, Skeleton, type Column } from "@/design/next/kit";
import { ExportTable } from "@/design/next/more/ExportTable";
import "./tabs-f.css";

const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
/** A missing route or a refused read does not get better on retry. */
const retry = (n: number, e: unknown) => {
  const s = status(e);
  return s !== 403 && s !== 404 && n < 2;
};

const KIND: Record<string, () => string> = { auto: () => t("Suggested value"), fill: () => t("Fill a required field"), pick: () => t("Pick an allowed value"), review: () => t("Review by hand") };
const kind = (k: string) => KIND[k]?.() ?? k;
const SOURCE: Record<string, () => string> = { rule_auto_fix: () => t("Rule's automatic fix"), value_fix_map: () => t("Rule's value map"), fix_draft: () => t("Drafted fix") };
const ENGINE_OFF: Record<EngineOffReason, () => string> = {
  too_few_runs: () => t("Three scored runs are needed before the engine can learn from the trend."),
  not_configured: () => t("This deployment runs without its Aletheia engine. An administrator can set it up."),
  unreachable: () => t("The Aletheia engine does not answer. The rest of this page is not affected."),
  no_token: () => t("The Aletheia engine has no access token, so it cannot learn from the trend yet."),
  licence_invalid: () => t("The Aletheia engine licence is not valid, so the engine is not used."),
  engine_error: () => t("The Aletheia engine could not learn from the trend this time."),
};
const CHANGE: Record<"new" | "resolved" | "worse" | "better", () => string> = { new: () => t("Fails for the first time"), resolved: () => t("Now passes"), worse: () => t("More failing records"), better: () => t("Fewer failing records") };

/** "MARA-MTART (Material type)" carries the field's text in brackets; the code alone is the field. */
function fieldText(field: string, label: string): string | null {
  const head = `${field} (`;
  return label.startsWith(head) && label.endsWith(")") ? label.slice(head.length, -1) : null;
}

type Change = RuleChange & { what: keyof typeof CHANGE };

/** Why the object's records fail each rule, the suggested fix, fix batches by field and what changed since the last run. */
export function CleaningPlan({ module, label, versionId }: { module: string; label: string; versionId: string | null }) {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["aletheia", "cleaning-plan", fixture, module, versionId ?? null], queryFn: () => getCleaningPlan(module, versionId), staleTime: 60_000, retry });
  return (
    <section className="nx-card nx-tf-sec" aria-label={t("Cleaning plan")} data-testid="acp">
      <div className="nx-tf-head">
        <h2 className="nx-sec-h">{t("Cleaning plan")}</h2>
        <span className="nx-tf-sub">{t("Why {label} records fail and how to fix them", { label })}</span>
      </div>
      {q.isPending ? (
        <Skeleton lines={4} label={t("Loading")} />
      ) : q.isError ? (
        <ErrorState sentence={t("The cleaning plan could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
      ) : q.data.items.length === 0 ? (
        <p className="nx-muted">{t("No rule fails for {label} in this run.", { label })}</p>
      ) : (
        <Body p={q.data} />
      )}
    </section>
  );
}

function Body({ p }: { p: Plan }) {
  const messages = new Map(p.items.map((i) => [i.rule, i.message]));
  const c = p.changes;
  const changes: Change[] = c.available ? (["new", "resolved", "worse", "better"] as const).flatMap((what) => c[what].map((r) => ({ ...r, what }))) : [];
  const changeCols: Column<Change>[] = [
    { id: "what", label: t("Change"), cell: (r) => CHANGE[r.what]() },
    { id: "rule", label: t("Rule"), cell: (r) => <Code code={r.rule} text={messages.get(r.rule)} /> },
    { id: "before", label: t("Before"), cell: (r) => int(r.before), align: "end", compare: (a, b) => a.before - b.before },
    { id: "after", label: t("After"), cell: (r) => int(r.after), align: "end", compare: (a, b) => a.after - b.after },
  ];
  const batchCols: Column<CleaningBatch>[] = [
    { id: "field", label: t("Field"), cell: (b) => <Code code={b.field} text={fieldText(b.field, b.field_label)} /> },
    { id: "kind", label: t("Kind of fix"), cell: (b) => kind(b.kind) },
    { id: "rules", label: t("Rules"), cell: (b) => <span className="nx-mono">{b.rules.join(", ")}</span> },
    { id: "affected", label: t("Records"), cell: (b) => int(b.affected), align: "end", compare: (a, b) => a.affected - b.affected },
    { id: "instruction", label: t("What to do"), cell: (b) => b.instruction },
    { id: "evidence", label: t("Evidence"), cell: (b) => <span className="nx-muted">{b.evidence}</span> },
  ];
  const itemCols: Column<CleaningItem>[] = [
    { id: "rule", label: t("Rule"), cell: (i) => <Code code={i.rule} text={i.message} /> },
    { id: "field", label: t("Field"), cell: (i) => <Code code={i.field} text={fieldText(i.field, i.field_label)} /> },
    { id: "why", label: t("Why it is wrong"), cell: (i) => i.explanation },
    {
      id: "fix",
      label: t("Suggested fix"),
      cell: (i) =>
        i.suggestion ? (
          <span className="nx-tf-pair">
            <span className="nx-mono">{i.suggestion.value}</span>
            <small>{SOURCE[i.suggestion.source]?.() ?? i.suggestion.source}</small>
          </span>
        ) : (
          kind(i.kind)
        ),
    },
    { id: "confidence", label: t("Confidence"), cell: (i) => (i.suggestion ? t("{n} out of 100", { n: int(i.suggestion.confidence) }) : t("Not scored")), align: "end" },
    {
      id: "evidence",
      label: t("Evidence"),
      cell: (i) =>
        i.suggestion ? t("{e} Rests on {c} of {b} records.", { e: i.suggestion.evidence, c: int(i.suggestion.covered), b: int(i.suggestion.base) }) : t("{a} of {t} records fail.", { a: int(i.affected), t: int(i.total) }),
    },
  ];
  return (
    <div className="nx-tf-stack">
      {c.available ? (
        <>
          <p data-testid="acp-narrative">{c.narrative}</p>
          {changes.length ? (
            <ExportTable>
              <DataTable rows={changes} columns={changeCols} rowKey={(r) => `${r.what}-${r.rule}`} rowLabel={(r) => r.rule} caption={t("What changed since the last run")} />
            </ExportTable>
          ) : null}
        </>
      ) : (
        <p className="nx-muted">{t("Two runs of this object are needed before Meridian can say what changed.")}</p>
      )}
      {p.batches.length === 0 ? (
        <p className="nx-muted">{t("No rule fails in this run, so there is nothing to batch.")}</p>
      ) : (
        <ExportTable>
          <DataTable rows={p.batches} columns={batchCols} rowKey={(b) => b.id} rowLabel={(b) => b.field} caption={t("Fix batches by field")} />
        </ExportTable>
      )}
      <ExportTable>
        <DataTable rows={p.items} columns={itemCols} rowKey={(i) => `${i.rule}|${i.field}`} rowLabel={(i) => i.rule} caption={t("Why each rule fails")} />
      </ExportTable>
      <Engine p={p} />
    </div>
  );
}

function Engine({ p }: { p: Plan }) {
  const e = p.engine;
  const cols: Column<RuleRange>[] = [
    { id: "rule", label: t("Rule"), cell: (r) => <span className="nx-mono">{r.rule}</span> },
    { id: "range", label: t("Normal range"), cell: (r) => t("{low} to {high}", { low: int(r.low ?? 0), high: int(r.high ?? 0) }), align: "end" },
    { id: "latest", label: t("This run"), cell: (r) => int(r.latest), align: "end", compare: (a, b) => a.latest - b.latest },
    { id: "verdict", label: t("Verdict"), cell: (r) => (r.outside ? t("Outside the normal range") : t("Inside the normal range")) },
  ];
  return (
    <div className="nx-tf-stack" data-testid="acp-engine">
      {!e.available ? (
        <p className="nx-muted">{(ENGINE_OFF[(e.reason ?? "engine_error") as EngineOffReason] ?? ENGINE_OFF.engine_error)()}</p>
      ) : e.ranges.length === 0 ? (
        <p className="nx-muted">{t("Every failing rule sits inside its learned normal range.")}</p>
      ) : (
        <ExportTable>
          <DataTable rows={e.ranges} columns={cols} rowKey={(r) => r.rule} rowLabel={(r) => r.rule} caption={t("Normal range of failing records per rule")} />
        </ExportTable>
      )}
      <details className="nx-tf-disclose" data-testid="acp-engine-evidence">
        <summary>{t("How the engine reached this")}</summary>
        <dl className="nx-tf-facts">
          <dt>{t("Method")}</dt>
          <dd>{e.evidence.method}</dd>
          <dt>{t("Confidence")}</dt>
          <dd>{e.evidence.confidence == null ? t("Not scored") : t("{n} out of 100", { n: int(e.evidence.confidence) })}</dd>
          <dt>{t("Inputs")}</dt>
          <dd>{e.evidence.inputs.join(", ")}</dd>
          <dt>{t("Runs")}</dt>
          <dd>{int(e.evidence.runs ?? e.runs)}</dd>
        </dl>
      </details>
    </div>
  );
}
