"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getBurndown, getProposalQuality, getRecurrence, getRootCauses, getRuleFeedback, getRunChange, getThroughput, getTimeToFix, type FixStat } from "@/lib/api/v2/work-analytics";
import { getOperational } from "@/lib/api/v2/analytics";
import { exportGrid } from "@/lib/api/v2/roles";
import { downloadCsv, tableCsv } from "@/lib/v2/grid-export";
import { failureText } from "@/lib/v2/errors";
import { formatDate, formatModuleName } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { f1, int, pct1 } from "@/lib/v2/score";
import { useV2Session } from "@/lib/v2/hooks";
import { useRuleList } from "@/lib/v2/sys-queries";
import { V2Link } from "@/design/v2/parts";
import { Button, Chip, Code, DataTable, EmptyState, ErrorState, PartBar, Skeleton, Sparkline, StatCard, useToast, type ChipTone, type Column } from "../kit";
import { AreaTrend, StackedBar } from "../viz";
import "./analytics.css";

/**
 * Work analytics: how fast the steward work list is being worked down (api/routes/work_analytics.py). Every figure is
 * read from the backend; a figure it has not computed shows as a dash. Each panel reads its own endpoint, so a role that
 * cannot read one panel still sees the others.
 */

type Cell = string | number | null;
type Q<T> = { isPending: boolean; isError: boolean; error: unknown; data: T | undefined; refetch: () => unknown };
/** A table column that also says what goes in the export for each row. */
type Col<R> = Column<R> & { value: (r: R) => Cell };

const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
const retry = (n: number, e: unknown) => { const s = status(e); return s !== 403 && s !== 404 && n < 2; };
/** The backend gives shares as percentages; pct1 takes a share of one. */
const pctOf = (n: number | null | undefined) => (n == null ? pct1(null) : pct1(n / 100));
const days = (n: number | null | undefined) => (n == null ? f1(null) : t("{n} days", { n: f1(n) }));
const num = <R,>(id: string, label: string, get: (r: R) => number | null, show: (n: number | null) => string = int): Col<R> => ({
  id, label, align: "end", value: get, cell: (r) => show(get(r)), compare: (a, b) => (get(a) ?? -1) - (get(b) ?? -1),
});

const SOURCE: Record<string, () => string> = {
  rule: () => t("Rule fixes"),
  steward: () => t("Steward edits"),
  cleaning: () => t("Cleaning engine"),
  simulation: () => t("Simulations"),
  manual: () => t("Manual entries"),
};
const SEV_LABEL: Record<string, () => string> = { critical: () => t("Critical"), high: () => t("High"), medium: () => t("Medium"), low: () => t("Low") };
const SEV_TONE: Record<string, ChipTone> = { critical: "bad", high: "bad", medium: "warn", low: "neutral" };
const sevText = (s: string) => SEV_LABEL[s]?.() ?? s;
const Sev = ({ s }: { s: string }) => <Chip tone={SEV_TONE[s] ?? "neutral"}>{sevText(s)}</Chip>;

function useAnalytics<T>(key: string, fn: () => Promise<T>) {
  const fixture = useFixture();
  return useQuery({ queryKey: ["work-analytics", key, fixture], queryFn: fn, staleTime: 60_000, retry });
}

/** The rule text beside a check id, from the rule library. A rule's name is "CHECK_ID: text". */
function useRuleText(): (id: string) => string | undefined {
  const rules = useRuleList();
  const names = new Map((rules.data?.rules ?? []).map((r) => {
    const i = r.name.indexOf(":");
    return i > 0 ? [r.name.slice(0, i), r.name.slice(i + 1).trim()] : [r.name, r.name];
  }));
  return (id) => names.get(id);
}
const ruleCell = (id: string, text: string | undefined) => <Code code={id} text={text} />;
const ruleValue = (id: string, text: string | undefined) => (text ? `${id}: ${text}` : id);

/** A panel: a heading, the line under it, then its own loading, dash (403) or failure state. */
function Section<T>({ q, title, meta, testId, children }: { q: Q<T>; title: string; meta?: string; testId: string; children: (d: T) => ReactNode }) {
  return (
    <section className="nx-wa-panel" data-testid={testId} aria-label={title}>
      <header className="nx-wa-head">
        <h2>{title}</h2>
        {meta ? <p className="nx-sub">{meta}</p> : null}
      </header>
      {q.isPending ? (
        <Skeleton lines={4} label={title} />
      ) : q.isError || q.data === undefined ? (
        status(q.error) === 403 ? (
          <p className="nx-wa-dash" data-testid="wa-dash">{f1(null)} {t("Your role cannot read this list.")}</p>
        ) : (
          <ErrorState sentence={t("This list could not be read.")} error={q.error} onRetry={() => void q.refetch()} />
        )
      ) : (
        children(q.data)
      )}
    </section>
  );
}

/** A titled table with Excel and CSV export of the rows it holds, for a role that may export. */
function Table<R>({ title, route, rows, cols, rowKey }: { title: string; route: string; rows: R[]; cols: Col<R>[]; rowKey: (r: R) => string }) {
  const session = useV2Session();
  const toast = useToast();
  const save = async (format: "xlsx" | "csv") => {
    const columns = cols.map((c) => ({ key: c.id, header: c.label }));
    const data = rows.map((r) => Object.fromEntries(cols.map((c) => [c.id, c.value(r)])));
    const name = `work-analytics-${route}`;
    try {
      const file = format === "csv" ? downloadCsv(name, tableCsv(columns, data)) : await exportGrid({ title, route: name, columns, rows: data, total: data.length });
      toast({ text: t("Exported {rowsCount} rows to {name}", { rowsCount: int(data.length), name: file }), tone: "good" });
    } catch (e) {
      toast({ text: failureText(e), tone: "bad" });
    }
  };
  return (
    <div className="nx-wa-table">
      <div className="nx-wa-tablehead">
        <h3>{title}</h3>
        {session.can("export") && rows.length > 0 ? (
          <span className="nx-wa-export">
            <Button size={32} variant="quiet" icon="download" onClick={() => void save("xlsx")}>{t("Export to Excel")}</Button>
            <Button size={32} variant="quiet" icon="download" onClick={() => void save("csv")}>{t("Export to CSV")}</Button>
          </span>
        ) : null}
      </div>
      <DataTable rows={rows} columns={cols} rowKey={rowKey} rowLabel={(r) => String(cols[0].value(r) ?? "")} caption={title} />
    </div>
  );
}

export function WorkAnalytics() {
  const burn = useAnalytics("burndown", getBurndown);

  if (burn.isPending) return <div className="nx-body nx-wa"><Skeleton lines={8} label={t("Work analytics")} /></div>;
  if (burn.isError) {
    return (
      <div className="nx-body nx-wa">
        {status(burn.error) === 403 ? (
          <EmptyState heading={t("Your role cannot read the work analytics.")} />
        ) : (
          <ErrorState sentence={t("The work analytics could not be read.")} error={burn.error} onRetry={() => void burn.refetch()} />
        )}
      </div>
    );
  }
  const b = burn.data;
  const title = t("Open issues, day by day");
  const trend = b.days.map((d) => ({ label: formatDate(d.day, "date"), value: d.open }));
  const dayCols: Col<(typeof b.days)[number]>[] = [
    { id: "day", label: t("Day"), value: (d) => d.day, cell: (d) => formatDate(d.day, "date"), compare: (x, y) => x.day.localeCompare(y.day) },
    num("open", t("Open"), (d) => d.open),
    num("found", t("Found"), (d) => d.opened),
    num("closed", t("Closed"), (d) => d.closed),
  ];
  return (
    <div className="nx-body nx-wa" data-testid="work-analytics">
      <section className="nx-wa-banner" data-testid="wa-banner" aria-label={t("Work analytics")}>
        <p className="nx-sub">{t("Work analytics on {date}", { date: formatDate(b.today, "date") })}</p>
        <h1>{t("{n} issues open", { n: int(b.open_now) })}</h1>
        <p>
          {b.projected_finish
            ? t("At {pace} closed a day over the last {n} days, the list is clear by {date}.", { pace: f1(b.pace_per_day), n: int(b.pace_window_days), date: formatDate(b.projected_finish, "date") })
            : t("At the pace of the last {n} days the list is not getting shorter, so there is no finish date.", { n: int(b.pace_window_days) })}
        </p>
        {b.open_now > 0 ? <V2Link href="/work" className="nx-btn nx-btn-primary nx-btn-sm" data-testid="wa-primary">{t("Open the work list")}</V2Link> : null}
      </section>
      <div className="nx-statgrid">
        <StatCard label={t("Records with an open issue")} value={b.open_records ?? 0} format={(n) => (b.open_records == null ? f1(null) : int(n))} />
        <StatCard label={t("Closed in 7 days")} value={b.fixed_7d} spark={b.days.map((d) => d.closed)} sparkLabel={t("Closed")} />
        <div className="nx-wa-stat">
          <StatCard label={t("Closed a day")} value={b.pace_per_day} format={(n) => f1(n)} />
          <small className="nx-sub">{t("Over {n} days", { n: int(b.pace_window_days) })}</small>
        </div>
      </div>
      <p className="nx-wa-lede">{t("This page shows how fast the work list is being cleared. Read the trend first, then the panels, which each answer one question. Every figure comes from the work list and the latest run of each object.")}</p>
      <dl className="nx-wa-glossary">
        {([
          [t("Open"), t("Issues on the work list that nobody has closed.")],
          [t("Closed a day"), t("Issues closed per day over the pace window.")],
          [t("Median"), t("Half of the fixed issues took this long or less.")],
          [t("Slowest tenth"), t("One in ten fixed issues took this long or more.")],
        ] as const).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <ol className="nx-wa-steps" aria-label={t("Analytics steps")}>
        <li aria-current="step"><strong>{t("Read the trend")}</strong> <span className="nx-mono">{int(b.open_now)}</span><small>{t("Is the list getting shorter, and when will it be clear?")}</small></li>
        <li><strong>{t("Find what slows it")}</strong><small>{t("Check the run changes and the time to fix below.")}</small></li>
        <li><strong>{t("Open the work list")}</strong><small>{t("Work the oldest issues first.")}</small></li>
      </ol>
      <p className="nx-sub">{t("This page only reads. Nothing on it changes data or the work list.")}</p>
      <section className="nx-wa-panel" data-testid="wa-burndown" aria-label={title}>
        <header className="nx-wa-head">
          <h2>{title}</h2>
          <p className="nx-sub">{t("Open at the end of each day")}</p>
        </header>
        <div className="nx-wa-chart">
          <AreaTrend points={trend} height={140} label={`${title} (${t("issues")})`} empty={t("Two days of history are needed to draw a trend.")} />
        </div>
        {trend.length >= 2 ? <Table title={title} route="burndown" rows={b.days} cols={dayCols} rowKey={(d) => d.day} /> : null}
      </section>
      <RunChangePanel />
      <TimeToFixPanel />
      <details className="nx-wa-more">
        <summary>{t("Who works the list, why issues come back and how rules are judged")}</summary>
        <ThroughputPanel />
        <CleaningPacePanel />
        <RecurrencePanel />
        <RootCausePanel />
        <ProposalPanel />
        <RuleFeedbackPanel />
      </details>
    </div>
  );
}

function RunChangePanel() {
  const q = useAnalytics("run-change", getRunChange);
  const rule = useRuleText();
  const title = t("What the latest run changed");
  type O = NonNullable<typeof q.data>["objects"][number];
  const cols: Col<O>[] = [
    { id: "object", label: t("Object"), value: (o) => formatModuleName(o.module), cell: (o) => <Code code={o.module} text={formatModuleName(o.module)} />, compare: (a, b) => a.module.localeCompare(b.module) },
    num("new", t("New"), (o) => o.new),
    num("fixed", t("Fixed"), (o) => o.fixed),
    num("still", t("Still failing"), (o) => o.still_failing),
    {
      id: "newly", label: t("Rules newly failing"),
      value: (o) => o.rules.newly_failing.map((r) => `${ruleValue(r.check_id, rule(r.check_id))} (${sevText(r.severity)}, ${t("{n} records", { n: int(r.new) })})`).join("; ") || null,
      cell: (o) => o.rules.newly_failing.length === 0 ? f1(null) : (
        <ul className="nx-wa-list">{o.rules.newly_failing.map((r) => <li key={r.check_id}>{ruleCell(r.check_id, rule(r.check_id))} <Sev s={r.severity} /> <small className="nx-sub">{t("{n} records", { n: int(r.new) })}</small></li>)}</ul>
      ),
    },
    {
      id: "recovered", label: t("Rules recovered"),
      value: (o) => o.rules.recovered.map((r) => ruleValue(r.check_id, rule(r.check_id))).join("; ") || null,
      cell: (o) => o.rules.recovered.length === 0 ? f1(null) : <ul className="nx-wa-list">{o.rules.recovered.map((r) => <li key={r.check_id}>{ruleCell(r.check_id, rule(r.check_id))}</li>)}</ul>,
    },
  ];
  return (
    <Section q={q} title={title} meta={t("Each object at its latest run against the run before")} testId="wa-run-change">
      {(d) => d.objects.length === 0 ? (
        <EmptyState heading={t("No object has two runs to compare yet.")} action={<V2Link href="/runs" className="nx-btn nx-btn-secondary nx-btn-sm">{t("Open the runs")}</V2Link>} />
      ) : (
        <>
          <div className="nx-wa-bars">
            {d.objects.map((o) => (
              <div key={o.module} className="nx-wa-bar">
                <small>{formatModuleName(o.module)}</small>
                <StackedBar label={formatModuleName(o.module)} segs={[
                  { id: "new", label: t("New"), value: o.new, tone: "bad" },
                  { id: "fixed", label: t("Fixed"), value: o.fixed, tone: "good" },
                  { id: "still", label: t("Still failing"), value: o.still_failing, tone: "warn" },
                ]} />
              </div>
            ))}
          </div>
          <Table title={title} route="run-change" rows={d.objects} cols={cols} rowKey={(o) => o.module} />
        </>
      )}
    </Section>
  );
}

const statCols = <R extends FixStat>(): Col<R>[] => [
  num("fixed", t("Fixed"), (s) => s.fixed),
  num("median", t("Median"), (s) => s.median_days, days),
  num("p90", t("Slowest tenth"), (s) => s.p90_days, days),
];

function TimeToFixPanel() {
  const q = useAnalytics("time-to-fix", () => getTimeToFix(180));
  const rule = useRuleText();
  type D = NonNullable<typeof q.data>;
  const sevCols: Col<D["by_severity"][number]>[] = [{ id: "sev", label: t("Severity"), value: (s) => sevText(s.severity), cell: (s) => <Sev s={s.severity} /> }, ...statCols<D["by_severity"][number]>()];
  const objCols: Col<D["by_object"][number]>[] = [{ id: "object", label: t("Object"), value: (s) => formatModuleName(s.module), cell: (s) => <Code code={s.module} text={formatModuleName(s.module)} /> }, ...statCols<D["by_object"][number]>()];
  const ruleCols: Col<D["by_check"][number]>[] = [{ id: "rule", label: t("Rule"), value: (s) => ruleValue(s.check_id, rule(s.check_id)), cell: (s) => ruleCell(s.check_id, rule(s.check_id)) }, ...statCols<D["by_check"][number]>()];
  return (
    <Section q={q} title={t("Time to fix")} meta={t("From found to fixed, last {n} days", { n: int(180) })} testId="wa-time-to-fix">
      {(d) => d.overall.fixed === 0 ? <EmptyState heading={t("Nothing was fixed in this window.")} /> : (
        <>
          <p className="nx-sub">{t("Half of all issues are fixed within {m}; nine in ten within {p}.", { m: days(d.overall.median_days), p: days(d.overall.p90_days) })}</p>
          <Table title={t("Time to fix by severity")} route="time-to-fix-severity" rows={d.by_severity} cols={sevCols} rowKey={(s) => s.severity} />
          <Table title={t("Time to fix by object")} route="time-to-fix-object" rows={d.by_object} cols={objCols} rowKey={(s) => s.module} />
          <Table title={t("Slowest rules to fix")} route="time-to-fix-rule" rows={d.by_check} cols={ruleCols} rowKey={(s) => s.check_id} />
        </>
      )}
    </Section>
  );
}

function CleaningPacePanel() {
  const q = useAnalytics("operational", getOperational);
  return (
    <Section q={q} title={t("Cleaning engine pace")} meta={t("Every day the cleaning engine has recorded")} testId="wa-cleaning-pace">
      {({ kpis: k }) => k.total_detected === 0 && k.total_processed === 0 ? <EmptyState heading={t("The cleaning engine has not recorded a day yet.")} /> : (
        <>
          <PartBar label={t("Fixes found")} format={int} segments={[
            { label: t("Fixes applied"), value: k.total_processed },
            { label: t("Waiting to be applied"), value: k.items_in_flight },
          ]} />
          <dl className="nx-wa-facts">
            {([
              [t("Fixes found"), int(k.total_detected)],
              [t("Fixes applied"), int(k.total_processed)],
              [t("Applied a day"), f1(k.throughput)],
              [t("Waiting to be applied"), int(k.items_in_flight)],
              [t("Approved without review"), pctOf(k.automation_rate)],
              [t("Rejected at review"), pctOf(k.rejection_rate)],
              [t("Rolled back after applying"), pctOf(k.rollback_rate)],
              [t("Average review time"), k.mttr_hours ? t("{n} hours", { n: f1(k.mttr_hours) }) : f1(null)],
              [t("Most fixes found in"), k.top_object_type && k.top_object_type !== "N/A" ? formatModuleName(k.top_object_type) : f1(null)],
            ] as const).map(([label, v]) => <div key={label}><dt>{label}</dt><dd className="nx-mono">{v}</dd></div>)}
          </dl>
        </>
      )}
    </Section>
  );
}

function ThroughputPanel() {
  const q = useAnalytics("throughput", getThroughput);
  const title = t("Decisions per person");
  type D = NonNullable<typeof q.data>;
  const dayRows = q.data?.days ?? [];
  const series = (p: string) => dayRows.map((x) => x.by_person[p] ?? 0);
  const people: Col<D["people"][number]>[] = [
    { id: "person", label: t("Person"), value: (p) => p.person, cell: (p) => p.person, compare: (a, b) => a.person.localeCompare(b.person) },
    num("total", t("Decisions"), (p) => p.total),
    { id: "spark", label: t("Day by day"), value: (p) => series(p.person).join(" "), cell: (p) => <Sparkline points={series(p.person)} label={t("{name}, decisions over {n} days", { name: p.person, n: int(dayRows.length) })} /> },
    num("accept", t("Accepted"), (p) => p.accept),
    num("edit", t("Edited"), (p) => p.edit),
    num("nai", t("Not an issue"), (p) => p.not_an_issue),
    num("risk", t("Risk accepted"), (p) => p.accept_risk),
    num("approve", t("Approved"), (p) => p.approve),
  ];
  const work: Col<D["workload"][number]>[] = [
    { id: "who", label: t("Assignee"), value: (w) => w.name ?? w.email ?? w.assignee_id, cell: (w) => w.name ?? w.email ?? w.assignee_id },
    num("open", t("Open"), (w) => w.open),
    num("critical", t("Critical"), (w) => w.critical),
    num("overdue", t("Overdue"), (w) => w.overdue),
  ];
  return (
    <Section q={q} title={title} meta={t("Last {n} days", { n: int(q.data?.window_days ?? 28) })} testId="wa-throughput">
      {(d) => (
        <>
          {d.people.length === 0 ? <EmptyState heading={t("No decisions were recorded in this window.")} /> : <Table title={title} route="throughput" rows={d.people} cols={people} rowKey={(p) => p.person} />}
          {d.workload.length > 0 ? <Table title={t("Open work per assignee")} route="workload" rows={d.workload} cols={work} rowKey={(w) => w.assignee_id} /> : null}
        </>
      )}
    </Section>
  );
}

function RecurrencePanel() {
  const q = useAnalytics("recurrence", getRecurrence);
  const rule = useRuleText();
  type D = NonNullable<typeof q.data>;
  const tail = <R extends { issues: number; reopened: number; reopens: number; rate_pct: number }>(): Col<R>[] => [
    num("issues", t("Issues"), (r) => r.issues),
    num("back", t("Came back"), (r) => r.reopened),
    num("reopens", t("Times reopened"), (r) => r.reopens),
    num("rate", t("Rate"), (r) => r.rate_pct, pctOf),
  ];
  const byRule: Col<D["by_check"][number]>[] = [
    {
      id: "rule", label: t("Rule"), value: (r) => `${ruleValue(r.check_id, rule(r.check_id))} (${formatModuleName(r.module)})`,
      cell: (r) => <span className="nx-wa-stack">{ruleCell(r.check_id, rule(r.check_id))}<small className="nx-sub">{formatModuleName(r.module)}</small></span>,
    },
    ...tail<D["by_check"][number]>(),
  ];
  const bySystem: Col<D["by_system"][number]>[] = [{ id: "system", label: t("System"), value: (r) => r.name, cell: (r) => r.name ?? f1(null) }, ...tail<D["by_system"][number]>()];
  return (
    <Section q={q} title={t("Issues that came back")} meta={q.data ? t("{rate} of all issues came back after they were closed", { rate: pctOf(q.data.totals.rate_pct) }) : undefined} testId="wa-recurrence">
      {(d) => d.totals.issues === 0 ? <EmptyState heading={t("No issues have been closed yet.")} /> : (
        <>
          <Table title={t("Rules whose issues come back most")} route="recurrence-rule" rows={d.by_check} cols={byRule} rowKey={(r) => r.check_id} />
          <Table title={t("Issues that came back, by system")} route="recurrence-system" rows={d.by_system} cols={bySystem} rowKey={(r) => `${r.scope}-${r.name}`} />
        </>
      )}
    </Section>
  );
}

function RootCausePanel() {
  const q = useAnalytics("root-causes", getRootCauses);
  type V = NonNullable<typeof q.data>["dimensions"][number]["top"][number];
  return (
    <Section q={q} title={t("Where the failing records sit")} meta={t("Records with an open issue, by organisational unit")} testId="wa-root-causes">
      {(d) => d.dimensions.length === 0 ? <EmptyState heading={t("The failing records carry no organisational unit.")} /> : (
        <>
          {d.dimensions.map((dim) => {
            const cols: Col<V>[] = [
              { id: "value", label: dim.label, value: (v) => v.value, cell: (v) => <Code code={v.value} text={`${dim.label} (${dim.field})`} /> },
              num("records", t("Records"), (v) => v.records),
              num("share", t("Share"), (v) => v.share_pct, pctOf),
              num("issues", t("Issues"), (v) => v.issues),
              num("open", t("Open"), (v) => v.open),
              num("critical", t("Critical"), (v) => v.critical),
            ];
            const unit = t("{unit}: {n} values", { unit: dim.label, n: int(dim.values) });
            return (
              <div key={dim.field} className="nx-wa-dim">
                <PartBar label={unit} format={int} segments={dim.top.slice(0, 6).map((v) => ({ label: v.value, value: v.records }))} />
                <Table title={unit} route={`root-causes-${dim.field.toLowerCase()}`} rows={dim.top} cols={cols} rowKey={(v) => v.value} />
              </div>
            );
          })}
        </>
      )}
    </Section>
  );
}

function ProposalPanel() {
  const q = useAnalytics("proposal-quality", getProposalQuality);
  const title = t("How good the proposals are");
  const src = (s: string) => SOURCE[s]?.() ?? s;
  type S = NonNullable<typeof q.data>["sources"][number];
  const cols: Col<S>[] = [
    { id: "source", label: t("Source"), value: (s) => src(s.source), cell: (s) => src(s.source) },
    num("proposed", t("Proposed"), (s) => s.proposed),
    num("approved", t("Approved"), (s) => s.approved),
    num("arate", t("Approval rate"), (s) => s.approval_rate_pct, pctOf),
    num("exported", t("Written to SAP"), (s) => s.exported),
    num("fixed", t("Fixed"), (s) => s.fixed),
    num("still", t("Still failing"), (s) => s.still_failing),
    num("frate", t("Fix rate"), (s) => s.fix_rate_pct, pctOf),
  ];
  return (
    <Section q={q} title={title} meta={t("Approved, and still fixed at the next run, by where the proposal came from")} testId="wa-proposals">
      {(d) => (
        <>
          <div className="nx-wa-bars">
            {d.sources.map((s) => (
              <div key={s.source} className="nx-wa-bar">
                <small>{src(s.source)}</small>
                <StackedBar label={src(s.source)} segs={[
                  { id: "fixed", label: t("Fixed"), value: s.fixed, tone: "good" },
                  { id: "still", label: t("Still failing"), value: s.still_failing, tone: "bad" },
                  { id: "open", label: t("Proposed"), value: Math.max(0, s.proposed - s.fixed - s.still_failing), tone: "mute" },
                ]} />
              </div>
            ))}
          </div>
          <Table title={title} route="proposal-quality" rows={d.sources} cols={cols} rowKey={(s) => s.source} />
        </>
      )}
    </Section>
  );
}

/** Rules stewards call wrong: false-positive verdicts per rule from the steward feedback (api/routes/rules.py /rule-feedback). */
function RuleFeedbackPanel() {
  const fixture = useFixture();
  const [open, setOpen] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["rule-feedback", fixture],
    queryFn: async () => {
      try {
        return await getRuleFeedback();
      } catch (e) {
        if (status(e) === 404) return { rules: [] };
        throw e;
      }
    },
    staleTime: 60_000,
    retry,
  });
  const why = useQuery({ queryKey: ["rule-feedback", fixture, open], queryFn: () => getRuleFeedback(open ?? undefined), enabled: open != null, staleTime: 60_000, retry });
  const rule = useRuleText();
  const title = t("Rules stewards call wrong");
  type R = NonNullable<typeof q.data>["rules"][number];
  type N = NonNullable<NonNullable<typeof why.data>["reasons"]>[number];
  const cols: Col<R>[] = [
    { id: "rule", label: t("Rule"), value: (r) => ruleValue(r.check_id, rule(r.check_id)), cell: (r) => ruleCell(r.check_id, rule(r.check_id)) },
    num("flagged", t("Verdicts"), (r) => r.flagged),
    num("fp", t("Called wrong"), (r) => r.false_positive),
    num("real", t("Confirmed real"), (r) => r.real),
    num("rate", t("False-positive rate"), (r) => r.false_positive_rate, pct1),
    {
      id: "notes", label: t("Notes"), value: () => null,
      cell: (r) => r.false_positive ? (
        <Button size={32} variant="quiet" aria-pressed={open === r.check_id} onClick={() => setOpen(open === r.check_id ? null : r.check_id)}>
          {open === r.check_id ? t("Hide why") : t("Show why")}
        </Button>
      ) : f1(null),
    },
  ];
  const noteCols: Col<N>[] = [
    { id: "note", label: t("Steward note"), value: (n) => n.reason, cell: (n) => n.reason },
    num("records", t("Records"), (n) => n.records),
    { id: "last", label: t("Last given"), value: (n) => n.last_at, cell: (n) => (n.last_at ? formatDate(n.last_at, "date") : f1(null)) },
  ];
  const openText = open ? ruleValue(open, rule(open)) : "";
  return (
    <Section q={q} title={title} meta={t("Steward verdicts on flagged records, most called wrong first")} testId="wa-rule-feedback">
      {(d) => d.rules.length === 0 ? <EmptyState heading={t("No steward has given a verdict on a flagged record yet.")} /> : (
        <>
          <Table title={title} route="rule-feedback" rows={d.rules} cols={cols.filter((c) => c.id !== "notes").concat(cols.filter((c) => c.id === "notes"))} rowKey={(r) => r.check_id} />
          {open ? (
            why.isPending ? <Skeleton lines={3} label={openText} /> : why.isError ? (
              <ErrorState sentence={t("The steward notes could not be read.")} error={why.error} onRetry={() => void why.refetch()} />
            ) : !why.data.reasons?.length ? (
              <EmptyState heading={t("No steward left a note when calling {rule} wrong.", { rule: openText })} />
            ) : (
              <Table title={t("Why stewards call {rule} wrong", { rule: openText })} route={`rule-feedback-${open.toLowerCase()}`} rows={why.data.reasons} cols={noteCols} rowKey={(n) => n.reason} />
            )
          ) : null}
        </>
      )}
    </Section>
  );
}
