"use client";

import type { UseQueryResult } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Anomaly, EngineOffReason, Evidence, Surprise } from "@/lib/api/v2/aletheia-engine";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { f1, int } from "@/lib/v2/score";
import { Chip, Code, DataTable, ErrorState, Skeleton, type Column } from "../kit";
import { Fold, Panel } from "./cfg-parts";

/**
 * Pieces shared by the native Aletheia screens: the evidence behind every result, the Aletheia mark, the sentence
 * for an engine that is off, and the table of runs that fell out of line. Only run-level scores and counts are shown.
 */

export const ENGINE_OFF: Record<EngineOffReason, () => string> = {
  too_few_runs: () => t("Three scored runs are needed before the engine can learn from the trend."),
  not_configured: () => t("This deployment runs without its Aletheia engine. An administrator can set it up."),
  unreachable: () => t("The Aletheia engine does not answer. The rest of this page is not affected."),
  no_token: () => t("The Aletheia engine has no access token, so it cannot learn from the trend yet."),
  licence_invalid: () => t("The Aletheia engine licence is not valid, so the engine is not used."),
  engine_error: () => t("The Aletheia engine could not learn from the trend this time."),
};

/** The evidence behind one result: what went in, the method, and how sure it is. */
export function EvidencePanel({ ev, testId }: { ev: Evidence; testId: string }) {
  return (
    <Fold title={t("Evidence")} hint={t("inputs, method and confidence")}>
      <dl className="nx-cfg-figs" data-testid={testId}>
        <div><dt className="nx-sub">{t("Inputs")}</dt><dd>{ev.inputs.join("; ")}</dd></div>
        <div><dt className="nx-sub">{t("Method")}</dt><dd>{ev.method}</dd></div>
        <div>
          <dt className="nx-sub">{t("Confidence")}</dt>
          <dd>{ev.confidence == null ? t("Shown per result, as its deviation score") : t("{n} out of 100", { n: int(ev.confidence) })}</dd>
        </div>
        {ev.first_run ? <div><dt className="nx-sub">{t("Runs used")}</dt><dd>{t("{n} runs, {from} to {to}", { n: int(ev.runs ?? 0), from: formatDate(ev.first_run), to: formatDate(ev.last_run) })}</dd></div> : null}
      </dl>
    </Fold>
  );
}

export function Mark() {
  return (
    <span className="nx-sub nx-row">
      {/* eslint-disable-next-line @next/next/no-img-element -- the Aletheia mark is served unaltered, docs/diligence/licences.md section 6 */}
      <img src="/brand/aletheia-mark.svg" alt="" width={16} height={16} /> {t("Aletheia")}
    </span>
  );
}

/** A metric is a rule id or "dimension:<name>"; either shows its code with its text. */
export function metricName(labels: Record<string, string>, m: string) {
  return <Code code={m} text={m.startsWith("dimension:") ? t("{dimension} dimension", { dimension: labelText(m.slice(10)) }) : labels[m]} />;
}

/** Runs that fell out of line, from the deterministic check or the engine: expected against observed, with severity. */
export function DeviationTable({ rows, labels, caption, testId }: { rows: (Anomaly | Surprise)[]; labels: Record<string, string>; caption: string; testId: string }) {
  const columns: Column<Anomaly | Surprise>[] = [
    { id: "run", label: t("Run"), cell: (a) => a.label ?? formatDate(a.run_at) },
    { id: "metric", label: t("Measure"), cell: (a) => metricName(labels, a.metric) },
    { id: "expected", label: t("Expected"), align: "end", cell: (a) => f1(a.expected) },
    { id: "observed", label: t("Observed"), align: "end", cell: (a) => f1(a.observed) },
    { id: "z", label: t("Deviation"), align: "end", cell: (a) => (a.z == null ? f1(null) : a.z.toFixed(1)), compare: (a, b) => Math.abs(a.z ?? 0) - Math.abs(b.z ?? 0) },
    { id: "severity", label: t("Severity"), cell: (a) => (a.severity === "high" ? <Chip tone="bad">{t("High")}</Chip> : <Chip tone="warn">{t("Medium")}</Chip>) },
  ];
  return (
    <div data-testid={testId}>
      <DataTable rows={rows} columns={columns} rowKey={(a) => `${a.version_id}-${a.metric}`} rowLabel={(a) => `${a.label ?? formatDate(a.run_at)} ${a.metric}`} caption={caption} />
    </div>
  );
}

/** A panel that reads one shared query: skeleton while it loads, an error with retry, else its body. */
export function QueryPanel<T>({ q, title, meta, testId, children }: { q: UseQueryResult<T>; title: string; meta?: string; testId: string; children: (d: T) => ReactNode }) {
  return (
    <Panel title={title} meta={meta} testId={testId}>
      {q.isPending ? <Skeleton lines={4} label={title} /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : children(q.data as T)}
    </Panel>
  );
}
