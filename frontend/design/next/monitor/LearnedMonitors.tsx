"use client";

import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { acknowledgeBreak, expectBreak, explainBreak, getBreakEvidence, getLearnedMonitors, snoozeBreak, type BreakEvidence, type BreakKind, type BreakMetric, type LearnedBreak, type MonitorCoverage, type MonitorThreshold } from "@/lib/api/v2/learned-monitors";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { exportGrid } from "@/lib/api/v2/roles";
import { downloadCsv, tableCsv } from "@/lib/v2/grid-export";
import { failureText } from "@/lib/v2/errors";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { relTime } from "@/lib/v2/format";
import { f1, int } from "@/lib/v2/score";
import { Button, Chip, Code, DataTable, ErrorState, Skeleton, StatCard, useToast, type ChipTone, type Column } from "../kit";
import "./monitor.css";
import "./learned-monitors.css";

/**
 * Learned monitors, native: Aletheia learns the usual range of each figure from earlier runs and raises a break when a
 * new run falls outside it. Breaks, interim volume breaks, coverage, breaks below a raised minimum and the learned
 * minimums, with the steward's decisions (acknowledge, mark expected, snooze) gated on mdm.write.
 */

const KIND: Record<BreakKind, () => string> = {
  volume_drop: () => t("Volume drop"),
  volume_spike: () => t("Volume spike"),
  fail_rate_jump: () => t("Fail rate jump"),
  score_drop: () => t("Score drop"),
  field_emptied: () => t("Field emptied"),
  cardinality_shift: () => t("Distinct values shifted"),
  pattern_shift: () => t("Value shapes shifted"),
  format_break: () => t("Format broke"),
  range_shift: () => t("Range shifted"),
};

const METRIC: Record<BreakMetric, () => string> = {
  records: () => t("Records checked"),
  score: () => t("Score"),
  fail_rate: () => t("Fail rate"),
  blank_pct: () => t("Empty share"),
  distinct_pct: () => t("Distinct share"),
  pattern_pct: () => t("Share outside the usual shapes"),
  unparse_pct: () => t("Share not parseable"),
  num_mean: () => t("Mean"),
  num_max: () => t("Largest value"),
  num_min: () => t("Smallest value"),
  date_max: () => t("Latest date"),
  date_min: () => t("Earliest date"),
};

const RANGE = new Set<BreakMetric>(["num_mean", "num_max", "num_min", "date_max", "date_min"]);
const isDate = (m: BreakMetric) => m === "date_max" || m === "date_min";

const STATUS = { open: () => t("Open"), acknowledged: () => t("Acknowledged"), expected: () => t("Expected"), snoozed: () => t("Snoozed"), below_minimum: () => t("Below the minimum") };

const SEV: Record<LearnedBreak["severity"], { tone: ChipTone; label: () => string; rank: number }> = {
  critical: { tone: "bad", label: () => t("Critical"), rank: 0 },
  high: { tone: "bad", label: () => t("High"), rank: 1 },
  medium: { tone: "warn", label: () => t("Medium"), rank: 2 },
  low: { tone: "neutral", label: () => t("Low"), rank: 3 },
};

function Dash({ why }: { why?: string }) {
  return <span className="nx-lm-dash">-{why ? <span className="nx-sr"> {why}</span> : null}</span>;
}

const fmtText = (m: BreakMetric, n: number | null) => (n == null ? "-" : m === "records" ? int(n) : m === "score" ? f1(n) : `${f1(n)}%`);
const fmt = (m: BreakMetric, n: number | null) => (n == null ? <Dash /> : fmtText(m, n));

/** An effect in its own unit: records and numeric ranges as a share of the median, dates as days, score as points, the rest as percentage points. */
const eff = (m: BreakMetric, n: number) =>
  m === "records" ? `${f1(n * 100)}%` : RANGE.has(m) ? (isDate(m) ? t("{n, plural, one {# day} other {# days}}", { n: Math.round(n) }) : `${f1(n)}%`) : m === "score" ? t("{n} points", { n: f1(n) }) : t("{n} percentage points", { n: f1(n) });

/** How far a range metric moved from its usual level, in the unit of eff(): percent of the median, or days. */
const moved = (b: LearnedBreak) => {
  const m = b.median ?? 0;
  return eff(b.metric, isDate(b.metric) ? Math.abs(b.observed - m) : m === 0 ? 0 : (Math.abs(b.observed - m) / Math.abs(m)) * 100);
};

const usualText = (b: LearnedBreak) => (RANGE.has(b.metric) ? "-" : `${fmtText(b.metric, b.expected_low)} ${t("to")} ${fmtText(b.metric, b.expected_high)}`);
const Usual = ({ b }: { b: LearnedBreak }) => (RANGE.has(b.metric) ? <Dash why={t("Only the size of the move is shown, not a value of the field.")} /> : <>{fmt(b.metric, b.expected_low)} {t("to")} {fmt(b.metric, b.expected_high)}</>);
const seenText = (b: LearnedBreak) => (!RANGE.has(b.metric) ? fmtText(b.metric, b.observed) : !isDate(b.metric) && b.median == null ? t("Moved from a usual level of zero") : t("{effect} from the usual level", { effect: moved(b) }));
const kindText = (b: LearnedBreak) => (b.kind === "range_shift" ? `${KIND[b.kind]()} ${METRIC[b.metric]()}` : KIND[b.kind]());
const Kind = ({ b }: { b: LearnedBreak }) => <span className="nx-lm-stack"><span>{KIND[b.kind]()}</span>{b.kind === "range_shift" ? <span className="nx-sub">{METRIC[b.metric]()}</span> : null}</span>;
const Subject = ({ b }: { b: LearnedBreak }) => (b.subject_code ? <Code code={b.subject_code} text={b.subject_description ?? undefined} /> : <Dash />);
const Sev = ({ s }: { s: LearnedBreak["severity"] }) => <Chip tone={SEV[s].tone}>{SEV[s].label()}</Chip>;
const bySev = (a: LearnedBreak, b: LearnedBreak) => SEV[a.severity].rank - SEV[b.severity].rank;

/** The usual band against the observed value, on one strip. A range metric keeps its values off the screen. */
function Strip({ b }: { b: LearnedBreak }) {
  if (RANGE.has(b.metric)) return <Dash />;
  const lo = b.expected_low ?? b.observed;
  const hi = b.expected_high ?? b.observed;
  const min = Math.min(lo, b.observed);
  const max = Math.max(hi, b.observed);
  const span = max - min || 1;
  const x = (v: number) => 4 + ((v - min) / span) * 112;
  return (
    <svg className="nx-lm-strip" width={120} height={16} viewBox="0 0 120 16" role="img" aria-label={t("Usual range {lo} to {hi}, observed {o}", { lo: String(b.expected_low ?? "-"), hi: String(b.expected_high ?? "-"), o: String(b.observed) })}>
      <line className="nx-lm-axis" x1={4} x2={116} y1={8} y2={8} />
      <rect className="nx-lm-band" x={x(lo)} y={5} width={Math.max(x(hi) - x(lo), 2)} height={6} rx={2} />
      <line className="nx-lm-obs" x1={x(b.observed)} x2={x(b.observed)} y1={1} y2={15} />
    </svg>
  );
}

type Cell = string | number | null;
interface ExportCol<R> { key: string; header: string; value: (r: R) => Cell }

/** Excel and CSV export of one table, gated on export by the caller. */
function ExportBar<R>({ title, route, cols, rows }: { title: string; route: string; cols: ExportCol<R>[]; rows: R[] }) {
  const toast = useToast();
  const save = async (format: "xlsx" | "csv") => {
    const columns = cols.map((c) => ({ key: c.key, header: c.header }));
    const data = rows.map((r) => Object.fromEntries(cols.map((c) => [c.key, c.value(r)])) as Record<string, Cell>);
    try {
      const name = format === "csv" ? downloadCsv(route, tableCsv(columns, data)) : await exportGrid({ title, route, columns, rows: data, total: data.length });
      toast({ text: t("Exported {rowsCount} rows to {name}", { rowsCount: int(data.length), name }), tone: "good" });
    } catch (e) {
      toast({ text: failureText(e), tone: "bad" });
    }
  };
  if (rows.length === 0) return null;
  return (
    <div className="nx-lm-tools">
      <Button size={32} variant="quiet" icon="download" onClick={() => void save("xlsx")}>{t("Export to Excel")}</Button>
      <Button size={32} variant="quiet" icon="download" onClick={() => void save("csv")}>{t("Export to CSV")}</Button>
    </div>
  );
}

const breakCols = (): ExportCol<LearnedBreak>[] => [
  { key: "object", header: t("Object"), value: (b) => moduleText(b.module) },
  { key: "break", header: t("Break"), value: kindText },
  { key: "subject", header: t("Rule or field"), value: (b) => b.subject_code || null },
  { key: "subject_text", header: t("Description"), value: (b) => b.subject_description },
  { key: "usual", header: t("Usual range"), value: usualText },
  { key: "observed", header: t("Observed"), value: seenText },
  { key: "runs", header: t("Earlier runs used"), value: (b) => b.baseline_runs },
  { key: "severity", header: t("Severity"), value: (b) => SEV[b.severity].label() },
  { key: "status", header: t("Status"), value: (b) => STATUS[b.status]() },
];

function Panel({ title, meta, testId, tools, children }: { title: string; meta?: ReactNode; testId: string; tools?: ReactNode; children: ReactNode }) {
  return (
    <section className="nx-card nx-lm-panel" data-testid={testId}>
      <header className="nx-lm-panel-h">
        <div className="nx-lm-stack"><h2>{title}</h2>{meta ? <p className="nx-sub">{meta}</p> : null}</div>
        {tools}
      </header>
      {children}
    </section>
  );
}

export function LearnedMonitors() {
  const fixture = useFixture();
  const session = useV2Session();
  const qc = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["learned-monitors", fixture], queryFn: getLearnedMonitors, staleTime: 30_000 });

  if (q.isPending) return <div className="nx-mon nx-lm" data-testid="learned-monitors"><h1 className="nx-lm-title">{t("Learned monitors")}</h1><Skeleton lines={6} /></div>;
  if (q.isError) return <div className="nx-mon nx-lm" data-testid="learned-monitors"><h1 className="nx-lm-title">{t("Learned monitors")}</h1><ErrorState error={q.error} fallback={t("The monitors could not be read.")} onRetry={() => void q.refetch()} /></div>;

  const data = q.data;
  const interim = data.interim ?? [];
  const quiet = data.below_minimum ?? [];
  const breaks = [...data.breaks].sort(bySev);
  const open = [...breaks, ...interim].filter((b) => b.status === "open").length;
  const sel = [...interim, ...breaks].find((b) => b.id === picked) ?? breaks[0] ?? interim[0] ?? null;
  const allowed = session.can("mdm.write");
  const canExport = session.can("export");
  const firstOpen = breaks.find((b) => b.status === "open") ?? interim.find((b) => b.status === "open");
  const watching = data.coverage.filter((c) => c.state === "active").length;
  const refresh = () => void qc.invalidateQueries({ queryKey: ["learned-monitors", fixture] });

  const pick = (b: LearnedBreak, testId: string) => (
    <button type="button" className="nx-lm-pick" aria-pressed={sel?.id === b.id} data-testid={testId} onClick={() => setPicked(b.id)}><Kind b={b} /></button>
  );

  const breakColumns: Column<LearnedBreak>[] = [
    { id: "object", label: t("Object"), cell: (b) => moduleText(b.module), compare: (a, b) => moduleText(a.module).localeCompare(moduleText(b.module)) },
    { id: "break", label: t("Break"), cell: (b) => pick(b, `break-${b.id}`) },
    { id: "subject", label: t("Rule or field"), cell: (b) => <Subject b={b} /> },
    { id: "usual", label: t("Usual range"), cell: (b) => <Usual b={b} />, align: "end" },
    { id: "observed", label: t("Observed"), cell: (b) => seenText(b), align: "end" },
    { id: "chart", label: t("Range chart"), cell: (b) => <Strip b={b} /> },
    { id: "runs", label: t("Earlier runs used"), cell: (b) => int(b.baseline_runs), align: "end", compare: (a, b) => a.baseline_runs - b.baseline_runs },
    { id: "severity", label: t("Severity"), cell: (b) => <Sev s={b.severity} />, compare: bySev },
    { id: "status", label: t("Status"), cell: (b) => STATUS[b.status]() },
  ];

  const interimColumns: Column<LearnedBreak>[] = [
    { id: "object", label: t("Object"), cell: (b) => moduleText(b.module) },
    { id: "break", label: t("Break"), cell: (b) => pick(b, `interim-${b.id}`) },
    { id: "usual", label: t("Usual range"), cell: (b) => <Usual b={b} />, align: "end" },
    { id: "observed", label: t("Rows extracted"), cell: (b) => seenText(b), align: "end" },
    { id: "chart", label: t("Range chart"), cell: (b) => <Strip b={b} /> },
    { id: "runs", label: t("Earlier syncs used"), cell: (b) => int(b.baseline_runs), align: "end" },
    { id: "severity", label: t("Severity"), cell: (b) => <Sev s={b.severity} />, compare: bySev },
    { id: "status", label: t("Status"), cell: (b) => (b.status === "open" ? t("Analysis pending") : STATUS[b.status]()) },
    { id: "detected", label: t("Detected"), cell: (b) => relTime(b.detected_at) },
  ];

  const coverColumns: Column<MonitorCoverage>[] = [
    { id: "object", label: t("Object"), cell: (c) => <span data-testid={`monitor-object-${c.module}`}>{moduleText(c.module)}</span> },
    { id: "run", label: t("Latest run"), cell: (c) => (c.run_number == null ? <Dash /> : t("Run {n}", { n: c.run_number })) },
    { id: "runs", label: t("Earlier runs used"), cell: (c) => t("{n} of {min} needed", { n: int(c.baseline_runs), min: int(c.min_runs) }), align: "end" },
    { id: "state", label: t("State"), cell: (c) => (c.state === "active" ? <Chip tone="good">{t("Watching")}</Chip> : <Chip tone="neutral">{t("Learning")}</Chip>) },
    { id: "breaks", label: t("Breaks"), cell: (c) => (c.state === "active" ? int(c.breaks) : <Dash why={t("Raises nothing until it has enough earlier runs.")} />), align: "end" },
  ];

  return (
    <div className="nx-mon nx-lm" data-testid="learned-monitors">
      <h1 className="nx-lm-title">{t("Learned monitors")}</h1>
      <p className="nx-mon-lede">{t("Aletheia learns the usual range of each figure from earlier runs and raises a break when a new run falls outside it. Open a break to confirm it is real or mark it expected.")}</p>

      <section className="nx-card nx-lm-banner" data-testid="monitors" data-open={open > 0 || undefined}>
        <div className="nx-lm-stack">
          <h2>{t("{n, plural, =0 {No open break against the learned baseline} one {# open break against the learned baseline} other {# open breaks against the learned baseline}}", { n: open })}</h2>
          <p className="nx-sub">{t("Each object is compared with its own earlier runs. With fewer than {n} earlier runs it only learns and raises nothing.", { n: data.min_runs })}</p>
        </div>
        {firstOpen ? (
          <div className="nx-lm-stack nx-lm-banner-act">
            <Button variant="primary" size={40} data-testid="monitors-open-breached" onClick={() => setPicked(firstOpen.id)}>{t("Open the breached monitor")}</Button>
            <span className="nx-sub">{t("It is the first break still waiting for a decision.")}</span>
          </div>
        ) : null}
      </section>

      <div className="nx-lm-stats">
        <StatCard label={t("Open")} value={open} />
        <StatCard label={t("Between full runs")} value={interim.length} />
        <StatCard label={t("Below the learned minimum")} value={quiet.length} />
        <StatCard label={t("Watching")} value={watching} />
      </div>

      <Panel title={t("Breaks in the latest run")} meta={t("Most severe first.")} testId="monitors-breaks" tools={canExport ? <ExportBar title={t("Breaks in the latest run")} route="learned-monitors-breaks" cols={breakCols()} rows={breaks} /> : null}>
        <DataTable rows={breaks} columns={breakColumns} rowKey={(b) => b.id} rowLabel={(b) => `${moduleText(b.module)} ${kindText(b)}`} caption={t("Breaks in the latest run")} onOpenRow={(b) => setPicked(b.id)} empty={{ heading: t("No break. Every watched figure is inside its usual range.") }} />
      </Panel>

      <Panel title={t("Between full runs")} meta={t("Volume only. An extraction that landed after the latest finished run, whose analysis has not finished, compared with the rows of earlier syncs. Score, fail rate and empty share exist only after the checks run.")} testId="monitors-interim" tools={canExport ? <ExportBar title={t("Between full runs")} route="learned-monitors-interim" cols={breakCols()} rows={interim} /> : null}>
        <DataTable rows={interim} columns={interimColumns} rowKey={(b) => b.id} rowLabel={(b) => `${moduleText(b.module)} ${kindText(b)}`} caption={t("Between full runs")} onOpenRow={(b) => setPicked(b.id)} empty={{ heading: t("No break between full runs. No pending extraction is outside its usual size.") }} />
      </Panel>

      {sel ? <Detail key={sel.id} b={sel} allowed={allowed} onChanged={refresh} /> : null}

      <Panel title={t("What is learned")} meta={t("Earlier runs of the same system used for each object.")} testId="monitors-coverage" tools={canExport ? (
        <ExportBar title={t("What is learned")} route="learned-monitors-coverage" rows={data.coverage} cols={[
          { key: "object", header: t("Object"), value: (c) => moduleText(c.module) },
          { key: "run", header: t("Latest run"), value: (c) => c.run_number },
          { key: "runs", header: t("Earlier runs used"), value: (c) => t("{n} of {min} needed", { n: int(c.baseline_runs), min: int(c.min_runs) }) },
          { key: "state", header: t("State"), value: (c) => (c.state === "active" ? t("Watching") : t("Learning")) },
          { key: "breaks", header: t("Breaks"), value: (c) => (c.state === "active" ? c.breaks : null) },
        ]} />
      ) : null}>
        {data.coverage.length > 0 ? <ObjectBars rows={data.coverage} /> : null}
        <DataTable rows={data.coverage} columns={coverColumns} rowKey={(c) => c.module} rowLabel={(c) => moduleText(c.module)} caption={t("What is learned")} empty={{ heading: t("No finished run yet.") }} />
      </Panel>

      <BelowMinimum rows={quiet} thresholds={data.thresholds} allowed={allowed} canExport={canExport} onChanged={refresh} />
      <Thresholds rows={data.thresholds} canExport={canExport} />
    </div>
  );
}

/** Breaks by object: one bar per watched object, so a zero shows as an empty track. */
function ObjectBars({ rows }: { rows: MonitorCoverage[] }) {
  const active = rows.filter((c) => c.state === "active");
  const top = Math.max(1, ...active.map((c) => c.breaks));
  if (active.length === 0) return null;
  return (
    <figure className="nx-lm-bars" data-testid="monitors-chart">
      <figcaption className="nx-sub">{t("Breaks by object")}</figcaption>
      <ul>
        {active.map((c) => (
          <li key={c.module}>
            <span className="nx-lm-bar-name">{moduleText(c.module)}</span>
            <span className="nx-lm-track" aria-hidden="true"><span className="nx-lm-fill" data-tone={c.breaks > 0 ? "warn" : "good"} style={{ width: `${(c.breaks / top) * 100}%` }} /></span>
            <span className="nx-lm-bar-n">{int(c.breaks)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function BelowMinimum({ rows, thresholds, allowed, canExport, onChanged }: { rows: LearnedBreak[]; thresholds: MonitorThreshold[]; allowed: boolean; canExport: boolean; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useMutation({ mutationFn: (id: string) => acknowledgeBreak(id), onSuccess: onChanged, onError: (e: unknown) => toast({ text: errorSentence(e, t("The decision could not be saved.")), tone: "bad" }) });
  const min = (b: LearnedBreak) => thresholds.find((x) => x.module === b.module && x.metric === b.metric && x.subject_code === b.subject_code);
  const columns: Column<LearnedBreak>[] = [
    { id: "object", label: t("Object"), cell: (b) => <span data-testid={`quiet-${b.id}`}>{moduleText(b.module)}</span> },
    { id: "break", label: t("Break"), cell: (b) => <Kind b={b} /> },
    { id: "subject", label: t("Rule or field"), cell: (b) => <Subject b={b} /> },
    { id: "usual", label: t("Usual range"), cell: (b) => <Usual b={b} />, align: "end" },
    { id: "observed", label: t("Observed"), cell: (b) => seenText(b), align: "end" },
    { id: "min", label: t("Minimum now"), cell: (b) => { const m = min(b); return m ? eff(m.metric, m.min_effect) : <Dash />; }, align: "end" },
    { id: "actions", label: t("Actions"), cell: (b) => (allowed ? <Button size={32} variant="secondary" disabled={confirm.isPending} onClick={() => confirm.mutate(b.id)}>{t("Confirm as real")}</Button> : null) },
  ];
  return (
    <Panel title={t("Below the learned minimum")} meta={t("Outside the usual range but smaller than the minimum a steward raised. Nothing is alerted. Confirm one that is real and the minimum drops.")} testId="monitors-below-minimum" tools={canExport ? (
      <ExportBar title={t("Below the learned minimum")} route="learned-monitors-below-minimum" rows={rows} cols={[...breakCols().slice(0, 6), { key: "min", header: t("Minimum now"), value: (b) => { const m = min(b); return m ? eff(m.metric, m.min_effect) : null; } }]} />
    ) : null}>
      <DataTable rows={rows} columns={columns} rowKey={(b) => b.id} rowLabel={(b) => `${moduleText(b.module)} ${kindText(b)}`} caption={t("Below the learned minimum")} empty={{ heading: t("No break sits below a raised minimum.") }} />
    </Panel>
  );
}

const moveText = (r: MonitorThreshold, m: MonitorThreshold["moves"][number]) => {
  const vars = { n: m.run_number ?? "-", who: m.decided_by ?? "-", effect: eff(r.metric, m.effect), min: eff(r.metric, m.min_effect_after) };
  return m.decision === "expected" ? t("Run {n}: marked expected by {who} at {effect}, minimum now {min}", vars) : t("Run {n}: confirmed real by {who} at {effect}, minimum now {min}", vars);
};

function Thresholds({ rows, canExport }: { rows: MonitorThreshold[]; canExport: boolean }) {
  const columns: Column<MonitorThreshold>[] = [
    { id: "object", label: t("Object"), cell: (r) => <span data-testid={`threshold-${r.module}-${r.metric}-${r.subject_code || "all"}`}>{moduleText(r.module)}</span> },
    { id: "figure", label: t("Figure"), cell: (r) => METRIC[r.metric]() },
    { id: "subject", label: t("Rule or field"), cell: (r) => (r.subject_code ? <Code code={r.subject_code} text={r.subject_description ?? undefined} /> : <Dash />) },
    { id: "min", label: t("Minimum now"), cell: (r) => eff(r.metric, r.min_effect), align: "end" },
    { id: "floor", label: t("Fixed floor"), cell: (r) => eff(r.metric, r.floor), align: "end" },
    { id: "ceiling", label: t("Ceiling"), cell: (r) => eff(r.metric, r.ceiling), align: "end" },
    { id: "moves", label: t("Decisions that moved it"), cell: (r) => (r.moves.length === 0 ? <Dash /> : <ul className="nx-lm-moves">{r.moves.map((m) => <li key={m.break_id}>{moveText(r, m)}</li>)}</ul>) },
  ];
  return (
    <Panel title={t("Learned minimum effect")} meta={t("How big a break must be before it is raised. Stewards' decisions move it between the fixed floor and the ceiling.")} testId="monitors-thresholds" tools={canExport ? (
      <ExportBar title={t("Learned minimum effect")} route="learned-monitors-thresholds" rows={rows} cols={[
        { key: "object", header: t("Object"), value: (r) => moduleText(r.module) },
        { key: "figure", header: t("Figure"), value: (r) => METRIC[r.metric]() },
        { key: "subject", header: t("Rule or field"), value: (r) => r.subject_code || null },
        { key: "subject_text", header: t("Description"), value: (r) => r.subject_description },
        { key: "min", header: t("Minimum now"), value: (r) => eff(r.metric, r.min_effect) },
        { key: "floor", header: t("Fixed floor"), value: (r) => eff(r.metric, r.floor) },
        { key: "ceiling", header: t("Ceiling"), value: (r) => eff(r.metric, r.ceiling) },
        { key: "moves", header: t("Decisions that moved it"), value: (r) => r.moves.map((m) => moveText(r, m)).join("; ") || null },
      ]} />
    ) : null}>
      <DataTable rows={rows} columns={columns} rowKey={(r) => `${r.module}-${r.metric}-${r.subject_code}`} rowLabel={(r) => `${moduleText(r.module)} ${METRIC[r.metric]()}`} caption={t("Learned minimum effect")} empty={{ heading: t("No decision has moved a minimum yet. Every monitor uses its fixed floor.") }} />
    </Panel>
  );
}

/** One break: Aletheia's explanation with the runs it rests on, and the steward's decisions. */
function Detail({ b, allowed, onChanged }: { b: LearnedBreak; allowed: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [effect, setEffect] = useState<"exclude" | "accept">("exclude");
  const [days, setDays] = useState(7);
  const done = { onSuccess: onChanged, onError: (e: unknown) => toast({ text: errorSentence(e, t("The decision could not be saved.")), tone: "bad" as const }) };
  const ack = useMutation({ mutationFn: () => acknowledgeBreak(b.id), ...done });
  const exp = useMutation({ mutationFn: () => expectBreak(b.id, effect), ...done });
  const snz = useMutation({ mutationFn: () => snoozeBreak(b.id, days), ...done });
  const why = useMutation({ mutationFn: () => explainBreak(b.id), ...done });
  const busy = ack.isPending || exp.isPending || snz.isPending;
  const e = b.explanation;
  return (
    <Panel title={t("Why Aletheia flagged this")} meta={<>{KIND[b.kind]()} <Sev s={b.severity} /> {STATUS[b.status]()}</>} testId="monitors-detail">
      <p className="nx-lm-explain" data-testid="monitors-explanation">{e.sentences.join(" ")}</p>
      <ul className="nx-lm-facts">
        <li>{e.source === "ai" ? t("Worded by Aletheia from the figures only. It saw no record.") : t("Worded from the figures by a fixed template. No AI was used.")}</li>
        <li>{METRIC[b.metric]()}: {b.median == null || RANGE.has(b.metric) ? <Dash /> : t("baseline median {m} over {n} earlier runs", { m: b.metric === "records" ? int(b.median) : f1(b.median), n: int(b.baseline_runs) })}</li>
        <li data-testid="monitors-cites">
          {t("Runs behind it")}: {b.citations.map((c) => (
            <span key={c.run_id}>{c.run_number == null ? <Dash /> : <span className="nx-mono">{c.role === "current" ? t("Run {n} (this run)", { n: c.run_number }) : t("Run {n}", { n: c.run_number })}</span>}{" "}</span>
          ))}
        </li>
        {b.status !== "open" && b.decided_by ? <li>{t("{status} by {who}", { status: STATUS[b.status](), who: b.decided_by })}{b.baseline_effect ? ` ${b.baseline_effect === "exclude" ? t("This run is left out of later baselines.") : t("The baseline restarts at this run.")}` : ""}</li> : null}
      </ul>
      <WhyBreak b={b} />
      <div className="nx-lm-row">
        <Button size={32} variant="secondary" icon="sparkles" disabled={why.isPending} loading={why.isPending} onClick={() => why.mutate()} data-testid="monitors-explain">{t("Ask Aletheia to explain")}</Button>
      </div>
      {allowed ? (
        <>
          <p className="nx-sub">
            {effect === "exclude"
              ? t("Acknowledge confirms the break is real and lowers the minimum for similar breaks. Mark expected leaves this run out of later baselines. Snooze only sets the break aside for {n, plural, one {# day} other {# days}}.", { n: days })
              : t("Acknowledge confirms the break is real and lowers the minimum for similar breaks. Mark expected restarts the baseline at this run. Snooze only sets the break aside for {n, plural, one {# day} other {# days}}.", { n: days })}
          </p>
          <div className="nx-mon-filters" data-testid="monitors-actions">
            <Button size={32} variant="primary" disabled={busy} onClick={() => ack.mutate()}>{t("Acknowledge")}</Button>
            <label>
              <span className="nx-sr">{t("Effect on the baseline")}</span>
              <select value={effect} onChange={(ev) => setEffect(ev.target.value as "exclude" | "accept")}>
                <option value="exclude">{t("Leave this run out of the baseline")}</option>
                <option value="accept">{t("Accept as the new normal")}</option>
              </select>
            </label>
            <Button size={32} variant="secondary" disabled={busy} onClick={() => exp.mutate()}>{t("Mark expected")}</Button>
            <label>
              <span className="nx-sr">{t("Snooze for")}</span>
              <select value={days} onChange={(ev) => setDays(Number(ev.target.value))}>
                {[1, 7, 30].map((d) => <option key={d} value={d}>{t("{n, plural, one {# day} other {# days}}", { n: d })}</option>)}
              </select>
            </label>
            <Button size={32} variant="secondary" disabled={busy} onClick={() => snz.mutate()}>{t("Snooze")}</Button>
          </div>
        </>
      ) : null}
    </Panel>
  );
}

/**
 * Why this is a break, statistically: the robust z against the baseline runs' median and MAD, the band, the field's
 * DDIC entry and the codes that came and went checked against the live check table. Read when opened.
 */
function WhyBreak({ b }: { b: LearnedBreak }) {
  const fixture = useFixture();
  const [open, setOpen] = useState(false);
  const q = useQuery({ queryKey: ["learned-monitor-evidence", b.id, fixture], queryFn: () => getBreakEvidence(b.id), enabled: open, staleTime: 60_000, retry: false });
  return (
    <details className="nx-lm-why" data-testid="monitors-why" onToggle={(ev) => setOpen(ev.currentTarget.open)}>
      <summary>{t("Why this is a break")}</summary>
      {!open ? null : q.isPending ? <Skeleton lines={4} /> : q.isError ? <ErrorState error={q.error} fallback={t("The evidence could not be read.")} onRetry={() => void q.refetch()} /> : <Evidence b={b} e={q.data} />}
    </details>
  );
}

/** Baseline runs as dots, the band as a shaded strip, this run as the highlighted last dot. */
function EvidenceChart({ e, num }: { e: BreakEvidence; num: (v: number) => string }) {
  const points = [
    ...e.runs.map((r) => ({ id: r.run_id, label: r.run_number == null ? "-" : t("Run {n}", { n: r.run_number }), value: r.value, now: false })),
    { id: "observed", label: t("This run"), value: e.observed, now: true },
  ];
  const vals = [...points.map((p) => p.value), ...(e.expected_low == null ? [] : [e.expected_low]), ...(e.expected_high == null ? [] : [e.expected_high])];
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = hi - lo || 1;
  const W = 480;
  const H = 140;
  const L = 56;
  const y = (v: number) => 10 + (1 - (v - lo) / span) * (H - 30);
  const x = (i: number) => L + 8 + (points.length === 1 ? 0 : (i / (points.length - 1)) * (W - L - 24));
  return (
    <figure className="nx-lm-ev" data-testid="why-chart">
      <figcaption className="nx-lm-stack"><span className="nx-lm-ev-t">{t("Baseline runs against this run")}</span><span className="nx-sub">{t("The band is the median plus or minus {k} scaled MADs.", { k: f1(e.z_threshold) })}</span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={METRIC[e.metric]()} preserveAspectRatio="none">
        {e.expected_low != null && e.expected_high != null ? <rect className="nx-lm-band" x={L} width={W - L - 8} y={y(e.expected_high)} height={Math.max(y(e.expected_low) - y(e.expected_high), 1)} /> : null}
        {e.expected_low != null ? <g data-testid="why-band-low"><line className="nx-lm-ref" x1={L} x2={W - 8} y1={y(e.expected_low)} y2={y(e.expected_low)} /><text className="nx-lm-tick" x={L - 4} y={y(e.expected_low) + 4} textAnchor="end">{num(e.expected_low)}</text><title>{t("Band low")}</title></g> : null}
        {e.expected_high != null ? <g data-testid="why-band-high"><line className="nx-lm-ref" x1={L} x2={W - 8} y1={y(e.expected_high)} y2={y(e.expected_high)} /><text className="nx-lm-tick" x={L - 4} y={y(e.expected_high) + 4} textAnchor="end">{num(e.expected_high)}</text><title>{t("Band high")}</title></g> : null}
        <polyline className="nx-lm-line" points={points.map((p, i) => `${x(i)},${y(p.value)}`).join(" ")} />
        {points.map((p, i) => <circle key={p.id} className={p.now ? "nx-lm-dot-now" : "nx-lm-dot"} cx={x(i)} cy={y(p.value)} r={p.now ? 5 : 3}><title>{`${p.label}: ${num(p.value)}`}</title></circle>)}
        <text className="nx-lm-tick" x={x(points.length - 1)} y={H - 4} textAnchor="end">{t("This run")}</text>
      </svg>
      <table className="nx-sr">
        <caption>{t("Baseline runs and this run")}</caption>
        <thead><tr><th scope="col">{t("Run")}</th><th scope="col">{METRIC[e.metric]()}</th></tr></thead>
        <tbody>{points.map((p) => <tr key={p.id}><th scope="row">{p.label}</th><td>{num(p.value)}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

function Evidence({ b, e }: { b: LearnedBreak; e: BreakEvidence }) {
  const hide = RANGE.has(b.metric);
  const num = (v: number) => (e.metric === "records" ? int(v) : f1(v));
  const f = e.field;
  const v = e.values;
  return (
    <div className="nx-lm-evidence" data-testid="monitors-evidence">
      <ul className="nx-lm-facts">
        <li data-testid="why-z">
          {e.z == null ? t("The baseline runs did not vary, so no z can be computed. Any move past the minimum spread is a break.")
            : e.basis === "runs" ? t("Robust z {z}: the observed value is {z} scaled MADs from the baseline median. A break needs at least {k}.", { z: f1(Math.abs(e.z)), k: f1(e.z_threshold) })
            : t("Robust z of at least {z}: the baseline runs could not be read, so the spread comes from the stored band. A break needs at least {k}.", { z: f1(Math.abs(e.z)), k: f1(e.z_threshold) })}
        </li>
        {!hide && e.median != null ? <li>{t("Median {m}, MAD {mad}, scaled MAD {s} (MAD times 1.4826).", { m: num(e.median), mad: num(e.mad), s: num(e.scaled_mad) })}</li> : null}
        {e.floored ? <li>{t("The band was widened to the minimum spread: the baseline runs alone vary less than that.")}</li> : null}
      </ul>
      {hide ? <p className="nx-sub">{t("Only the size of the move is shown, not a value of the field.")}</p> : e.runs.length === 0 ? null : <EvidenceChart e={e} num={num} />}
      {f ? (
        <dl className="nx-lm-dl" data-testid="why-field">
          <dt>{t("Field")}</dt><dd><Code code={`${f.table}.${f.field}`} text={f.description ?? undefined} />{f.table_text ? <> {t("in {table}", { table: f.table_text })}</> : null}</dd>
          <dt>{t("Data element and domain")}</dt><dd>{f.data_element ? <span className="nx-mono">{f.data_element}</span> : <Dash />} / {f.domain ? <span className="nx-mono">{f.domain}</span> : <Dash />}{f.type ? <> {f.type} {f.length ?? ""}</> : null}</dd>
          <dt>{t("Check table")}</dt><dd>{f.check_table ? <span className="nx-mono">{f.check_field ? `${f.check_table}.${f.check_field}` : f.check_table}</span> : <Dash why={t("The dictionary names no check table for this field.")} />}</dd>
          {f.fixed_values_total > 0 ? <><dt>{t("Fixed values")}</dt><dd className="nx-lm-row">{f.fixed_values.map((x) => <Code key={x.low} code={x.low || " "} text={x.text} />)}{f.fixed_values_total > f.fixed_values.length ? <span>{t("and {n} more", { n: f.fixed_values_total - f.fixed_values.length })}</span> : null}</dd></> : null}
        </dl>
      ) : null}
      {v ? (
        <div className="nx-lm-scroll" role="region" tabIndex={0} aria-label={t("Codes that came and went, scrollable")}>
          <table className="nx-lm-table" data-testid="why-codes">
            <caption className="nx-sr">{t("Codes that entered or left the top values against {n, plural, one {# baseline run} other {# baseline runs}}", { n: v.baseline_runs })}</caption>
            <thead><tr><th scope="col">{t("Code")}</th><th scope="col">{t("Change")}</th><th scope="col">{t("In the check table")}</th><th scope="col">{t("Records or runs")}</th></tr></thead>
            <tbody>
              {v.appeared.map((c) => (
                <tr key={`a-${c.value}`} data-testid={`why-appeared-${c.value}`}>
                  <th scope="row"><Code code={c.value} text={c.text ?? undefined} /></th>
                  <td><Chip tone="new">{t("Appeared")}</Chip></td>
                  <td>{c.in_check_table == null ? <Dash why={t("No live snapshot of the check table.")} /> : c.in_check_table ? t("Yes") : <strong>{t("No")}</strong>}</td>
                  <td className="nx-lm-num">{c.count == null ? <Dash /> : t("{n, plural, one {# record} other {# records}}", { n: c.count })}</td>
                </tr>
              ))}
              {v.vanished.map((c) => (
                <tr key={`v-${c.value}`} data-testid={`why-vanished-${c.value}`}>
                  <th scope="row"><Code code={c.value} text={c.text ?? undefined} /></th>
                  <td><Chip tone="neutral">{t("Vanished")}</Chip></td>
                  <td>{c.in_check_table == null ? <Dash why={t("No live snapshot of the check table.")} /> : c.in_check_table ? t("Yes") : t("No")}</td>
                  <td className="nx-lm-num">{c.runs == null ? <Dash /> : t("in {n, plural, one {# baseline run} other {# baseline runs}}", { n: c.runs })}</td>
                </tr>
              ))}
              {v.appeared.length + v.vanished.length === 0 ? <tr><td colSpan={4}>{t("The same codes lead the field as in the baseline runs.")}</td></tr> : null}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
