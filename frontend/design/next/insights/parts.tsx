"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import type { Anomaly, EngineOffReason, Evidence } from "@/lib/api/v2/aletheia-engine";
import { formatDate } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { f1, int, pct1 } from "@/lib/v2/score";
import { useRuleList } from "@/lib/v2/sys-queries";
import { Chip, Code, DataTable, StatCard, type Column } from "../kit";
import type { TrendPoint } from "../viz";
import "./insights.css";

type HttpError = { response?: { status?: number }; status?: number };
export const status = (e: unknown) => (e as HttpError | null)?.response?.status ?? (e as HttpError | null)?.status;
/** Retry a failed read twice, except when the answer is final: no access, or nothing there. */
export const retry = (n: number, e: unknown) => {
  const s = status(e);
  return s !== 403 && s !== 404 && n < 2;
};
export const pctOf = (n: number | null | undefined) => (n == null ? pct1(null) : pct1(n / 100));

/** A rule id with its text beside it. A rule's name is "CHECK_ID: text", so the code is the part before the colon. */
export function useRuleName() {
  const rules = useRuleList();
  const names = new Map((rules.data?.rules ?? []).map((r) => {
    const i = r.name.indexOf(":");
    return i > 0 ? [r.name.slice(0, i), r.name.slice(i + 1).trim()] : [r.name, r.name];
  }));
  return function RuleName(id: string) {
    return <Code code={id} text={names.get(id)} />;
  };
}

/** A read where 404 means nothing has been scored yet: the screen shows it as empty, not as an error. */
export function useLift<T>(key: readonly unknown[], fn: () => Promise<T>, empty: T, enabled = true) {
  const fixture = useFixture();
  return useQuery({
    queryKey: [...key, fixture],
    queryFn: async () => {
      try {
        return await fn();
      } catch (e) {
        if (status(e) === 404) return empty;
        throw e;
      }
    },
    enabled,
    staleTime: 60_000,
    retry,
  });
}

export const ENGINE_OFF: Record<EngineOffReason, () => string> = {
  too_few_runs: () => t("Three scored runs are needed before the engine can learn from the trend."),
  not_configured: () => t("This deployment runs without its Aletheia engine. An administrator can set it up."),
  unreachable: () => t("The Aletheia engine does not answer. The rest of this page is not affected."),
  no_token: () => t("The Aletheia engine has no access token, so it cannot learn from the trend yet."),
  licence_invalid: () => t("The Aletheia engine licence is not valid, so the engine is not used."),
  engine_error: () => t("The Aletheia engine could not learn from the trend this time."),
};

/** A run-level measure the engine names: a dimension, or a label the API sends with it. Code with its text beside it. */
export function MetricName({ labels, metric }: { labels: Record<string, string>; metric: string }) {
  const text = metric.startsWith("dimension:") ? t("{dimension} dimension", { dimension: labelText(metric.slice(10)) }) : labels[metric];
  return <Code code={metric} text={text} />;
}

/** The Aletheia mark beside an engine result. */
export function Mark() {
  return <Chip tone="aletheia">{t("Aletheia")}</Chip>;
}

const day = (v: string | null | undefined) => (v ? formatDate(v, "date") : "");

/** The evidence behind one Aletheia result: inputs, method and confidence. Aggregates only, never a record. */
export function EvidencePanel({ ev, testId }: { ev: Evidence | null | undefined; testId: string }) {
  if (!ev) return null;
  return (
    <details className="nx-ins-evidence">
      <summary className="nx-sub">{t("Evidence")} <span>{t("inputs, method and confidence")}</span></summary>
      <dl className="nx-ins-dl" data-testid={testId}>
        <dt>{t("Inputs")}</dt><dd>{ev.inputs.join("; ")}</dd>
        <dt>{t("Method")}</dt><dd>{ev.method}</dd>
        <dt>{t("Confidence")}</dt>
        <dd>{ev.confidence == null ? t("Shown per result, as its deviation score") : t("{n} out of 100", { n: int(ev.confidence) })}</dd>
        {ev.first_run ? (
          <>
            <dt>{t("Runs used")}</dt>
            <dd>{t("{n} runs, {from} to {to}", { n: int(ev.runs ?? 0), from: day(ev.first_run), to: day(ev.last_run) })}</dd>
          </>
        ) : null}
      </dl>
    </details>
  );
}

/** One figure in a screen's stat strip. A null value shows as not known yet. */
export interface Fig { label: string; value: number | null; format?: (n: number) => string; note?: string }

/** The headline of a screen: one sentence, why, then the kit stat strip that backs it. Notes sit under the strip. */
export function Banner({ eyebrow, headline, why, figs, verdict, testId }: { eyebrow: string; headline: string; why?: ReactNode; figs: Fig[]; verdict?: string; testId: string }) {
  const notes = figs.filter((f) => f.note);
  return (
    <section className="nx-ins-lead" data-testid={testId} data-verdict={verdict} aria-label={eyebrow}>
      <h2>{headline}</h2>
      {why ? <p className="nx-sub">{why}</p> : null}
      <div className="nx-statgrid">
        {figs.map((f) => (
          <StatCard key={f.label} label={f.label} value={f.value ?? 0} format={f.value == null ? () => f1(null) : f.format ?? int} />
        ))}
      </div>
      {notes.length > 0 ? (
        <ul className="nx-ins-list">
          {notes.map((f) => <li key={f.label} className="nx-sub"><strong>{f.label}</strong> {f.note}</li>)}
        </ul>
      ) : null}
    </section>
  );
}

/** A titled block of a screen, on the kit card. */
export function Block({ title, meta, testId, children }: { title: string; meta?: string; testId?: string; children: ReactNode }) {
  return (
    <section className="nx-card nx-ins-block" data-testid={testId} aria-label={title}>
      <header>
        <h2>{title}</h2>
        {meta ? <p className="nx-sub">{meta}</p> : null}
      </header>
      {children}
    </section>
  );
}

export interface HBar { key: string; label: ReactNode; value: number; text: string; tone?: "good" | "warn" | "bad" }

/** Ranked horizontal bars, longest first as given. Each bar carries its number. */
export function HBars({ bars, label, testId }: { bars: HBar[]; label: string; testId?: string }) {
  const max = Math.max(0, ...bars.map((b) => Math.abs(b.value)));
  return (
    <ul className="nx-ins-hbars" aria-label={label} data-testid={testId}>
      {bars.map((b) => (
        <li key={b.key} className="nx-ins-hbar" data-tone={b.tone}>
          <span className="nx-ins-hbar-name">{b.label}</span>
          <span className="nx-ins-hbar-track" aria-hidden="true">
            <span className="nx-ins-hbar-fill" style={{ inlineSize: `${max > 0 ? Math.max(2, (Math.abs(b.value) / max) * 100) : 0}%` }} />
          </span>
          <span className="nx-ins-hbar-num">{b.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** A list of rule names, or a dash. */
export function RuleList({ ids, name }: { ids: string[]; name: (id: string) => ReactNode }) {
  if (ids.length === 0) return <>{t("None")}</>;
  return <span className="nx-cell-stack">{ids.map((id) => <span key={id}>{name(id)}</span>)}</span>;
}

type Run = { version_id: string | null; label: string | null; run_at: string | null; composite: number | null };

/** The composite per scored run, oldest first as the API sends it, for AreaTrend. */
export const runTrend = (runs: Run[]): TrendPoint[] =>
  runs.filter((r) => r.composite != null).map((r) => ({ label: r.label ?? day(r.run_at), value: r.composite as number }));

/** Runs the deterministic check or the engine did not expect: one table shape for both. Scores only, never a record. */
export function DeviationTable({ rows, labels, caption }: { rows: Anomaly[]; labels: Record<string, string>; caption: string }) {
  const cols: Column<Anomaly>[] = [
    { id: "run", label: t("Run"), cell: (a) => a.label ?? formatDate(a.run_at) },
    { id: "metric", label: t("Measure"), cell: (a) => <MetricName labels={labels} metric={a.metric} /> },
    { id: "expected", label: t("Expected"), align: "end", cell: (a) => f1(a.expected) },
    { id: "observed", label: t("Observed"), align: "end", cell: (a) => f1(a.observed) },
    { id: "z", label: t("Deviation"), align: "end", cell: (a) => (a.z == null ? f1(null) : a.z.toFixed(1)), compare: (a, b) => Math.abs(a.z ?? 0) - Math.abs(b.z ?? 0) },
    { id: "sev", label: t("Severity"), cell: (a) => (a.severity === "high" ? t("High") : t("Medium")) },
  ];
  return <DataTable rows={rows} columns={cols} rowKey={(a) => `${a.version_id}-${a.metric}`} rowLabel={(a) => a.label ?? a.metric} caption={caption} />;
}

const SEV: Record<string, { tone: "bad" | "warn" | "neutral"; word: () => string }> = {
  critical: { tone: "bad", word: () => t("Critical") },
  high: { tone: "bad", word: () => t("High") },
  medium: { tone: "warn", word: () => t("Medium") },
  low: { tone: "neutral", word: () => t("Low") },
};

/** A severity on the kit chip. The kit has no severity chip yet, so this maps the four levels onto chip tones. */
export function Sev({ severity }: { severity: string | null | undefined }) {
  if (!severity) return <>{f1(null)}</>;
  const s = SEV[severity.toLowerCase()];
  return s ? <Chip tone={s.tone}>{s.word()}</Chip> : <>{labelText(severity)}</>;
}
