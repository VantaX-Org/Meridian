"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useFixture } from "@/lib/api/v2/fixture";
import { getBurndown, getProposalQuality, getRecurrence, getRootCauses, getRunChange, getThroughput, getTimeToFix, type FixStat } from "@/lib/api/v2/work-analytics";
import { formatDate, formatModuleName } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { f1, int, pct1 } from "@/lib/v2/score";
import { useRuleList } from "@/lib/v2/sys-queries";
import { ChartFrame, ChartTable, niceTicks, Sparkline, TrendChart } from "../charts";
import { Sev } from "../inspector/rule";
import { Coded, EmptyFrame, ErrorFrame, Skeleton } from "../parts";
import { CcBanner, CcPage } from "./cc-parts";
import { Panel } from "./Mining";
import { ScrollFrame } from "./object/ScrollFrame";
import { WorkTabs } from "./WorkTabs";

/**
 * Work analytics: how fast the steward work list is being worked down (api/routes/work_analytics.py). Every figure is
 * read from the backend; a figure it has not computed shows as a dash.
 */

export const status = (e: unknown) => (e as { response?: { status?: number }; status?: number } | null)?.response?.status ?? (e as { status?: number } | null)?.status;
export const retry = (n: number, e: unknown) => { const s = status(e); return s !== 403 && s !== 404 && n < 2; };
/** The backend gives shares as percentages; pct1 takes a share of one. */
export const pctOf = (n: number | null | undefined) => (n == null ? pct1(null) : pct1(n / 100));
const days = (n: number | null | undefined) => (n == null ? f1(null) : t("{n} days", { n: f1(n) }));

const SOURCE: Record<string, () => string> = {
  rule: () => t("Rule fixes"),
  steward: () => t("Steward edits"),
  cleaning: () => t("Cleaning engine"),
  simulation: () => t("Simulations"),
  manual: () => t("Manual entries"),
};

function useAnalytics<T>(key: string, fn: () => Promise<T>) {
  const fixture = useFixture();
  return useQuery({ queryKey: ["work-analytics", key, fixture], queryFn: fn, staleTime: 60_000, retry });
}

/** The rule name beside a check id, from the rule library. */
export function useRuleName() {
  const rules = useRuleList();
  const names = new Map((rules.data?.rules ?? []).map((r) => [r.id, r.name]));
  return function RuleName(id: string) {
    return <Coded code={id} text={names.get(id)} first />;
  };
}

export function WorkAnalytics() {
  const burn = useAnalytics("burndown", getBurndown);

  if (burn.isPending) return <CcPage><WorkTabs current="analytics" /><Skeleton width="100%" height={320} /></CcPage>;
  if (burn.isError) {
    return (
      <CcPage>
        <WorkTabs current="analytics" />
        {status(burn.error) === 403 ? (
          <EmptyFrame>{t("Your role cannot read the work analytics.")}</EmptyFrame>
        ) : (
          <ErrorFrame onRetry={() => void burn.refetch()}>{t("The work analytics could not be read.")}</ErrorFrame>
        )}
      </CcPage>
    );
  }
  const b = burn.data;
  const pts = b.days.map((d) => {
    const label = formatDate(d.day, "date");
    return { id: d.day, label, title: t("{day}: {open} open, {opened} found, {closed} closed", { day: label, open: int(d.open), opened: int(d.opened), closed: int(d.closed) }), value: d.open };
  });
  const ticks = niceTicks(0, Math.max(1, ...pts.map((p) => p.value)), 4);
  const title = t("Open issues, day by day");
  return (
    <CcPage>
      <WorkTabs current="analytics" />
      <CcBanner
        eyebrow={t("Work analytics on {date}", { date: formatDate(b.today, "date") })}
        headline={t("{n} issues open", { n: int(b.open_now) })}
        why={
          b.projected_finish
            ? t("At {pace} closed a day over the last {n} days, the list is clear by {date}.", { pace: f1(b.pace_per_day), n: int(b.pace_window_days), date: formatDate(b.projected_finish, "date") })
            : t("At the pace of the last {n} days the list is not getting shorter, so there is no finish date.", { n: int(b.pace_window_days) })
        }
        figs={[
          { label: t("Records with an open issue"), value: int(b.open_records) },
          { label: t("Closed in 7 days"), value: int(b.fixed_7d) },
          { label: t("Closed a day"), value: f1(b.pace_per_day), note: t("Over {n} days", { n: int(b.pace_window_days) }) },
        ]}
        testId="wa-banner"
        label={t("Work analytics")}
      />
      <ChartFrame
        title={title}
        sub={t("Open at the end of each day")}
        height={180}
        level={2}
        state={pts.length < 2 ? "empty" : "ready"}
        empty={t("Two days of history are needed to draw a trend.")}
        testId="wa-burndown"
        table={<ChartTable caption={title} head={[t("Day"), t("Open"), t("Found"), t("Closed")]} rows={b.days.map((d) => [formatDate(d.day, "date"), int(d.open), int(d.opened), int(d.closed)])} />}
      >
        <TrendChart points={pts} domain={[ticks[0], ticks[ticks.length - 1]] as const} ticks={ticks} height={180} label={title} yLabel={t("issues")} format={int} />
      </ChartFrame>
      <RunChangePanel />
      <TimeToFixPanel />
      <ThroughputPanel />
      <RecurrencePanel />
      <RootCausePanel />
      <ProposalPanel />
    </CcPage>
  );
}

/** A panel that reads its own endpoint, with a dash state for a role that cannot read it. */
export function Section<T>({ q, title, meta, testId, children }: { q: { isPending: boolean; isError: boolean; error: unknown; data: T | undefined; refetch: () => unknown }; title: string; meta?: string; testId: string; children: (d: T) => ReactNode }) {
  return (
    <Panel title={title} meta={meta} testId={testId}>
      {q.isPending ? (
        <Skeleton width="100%" height={120} />
      ) : q.isError || q.data === undefined ? (
        status(q.error) === 403 ? <EmptyFrame>{t("Your role cannot read this list.")}</EmptyFrame> : <ErrorFrame onRetry={() => void q.refetch()}>{t("This list could not be read.")}</ErrorFrame>
      ) : (
        children(q.data)
      )}
    </Panel>
  );
}

export function Table({ title, head, children }: { title: string; head: string[]; children: ReactNode }) {
  return (
    <ScrollFrame label={title}>
      <table className="m2-tbl m2-cards">
        <caption className="m2-sr">{title}</caption>
        <thead>
          <tr>{head.map((h) => <th key={h} scope="col">{h}</th>)}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </ScrollFrame>
  );
}

function RunChangePanel() {
  const q = useAnalytics("run-change", getRunChange);
  const rule = useRuleName();
  const title = t("What the latest run changed");
  return (
    <Section q={q} title={title} meta={t("Each object at its latest run against the run before")} testId="wa-run-change">
      {(d) => d.objects.length === 0 ? <EmptyFrame>{t("No object has two runs to compare yet.")}</EmptyFrame> : (
        <Table title={title} head={[t("Object"), t("New"), t("Fixed"), t("Still failing"), t("Rules newly failing"), t("Rules recovered")]}>
          {d.objects.map((o) => (
            <tr key={o.module}>
              <th scope="row" className="m2-card-lead">{formatModuleName(o.module)}</th>
              <td data-label={t("New")} className="m2-num">{int(o.new)}</td>
              <td data-label={t("Fixed")} className="m2-num">{int(o.fixed)}</td>
              <td data-label={t("Still failing")} className="m2-num">{int(o.still_failing)}</td>
              <td data-label={t("Rules newly failing")}>
                {o.rules.newly_failing.length === 0 ? f1(null) : (
                  <ul className="m2-plain">
                    {o.rules.newly_failing.map((r) => <li key={r.check_id}>{rule(r.check_id)} <Sev severity={r.severity} /> <span className="m2-meta">{t("{n} records", { n: int(r.new) })}</span></li>)}
                  </ul>
                )}
              </td>
              <td data-label={t("Rules recovered")}>
                {o.rules.recovered.length === 0 ? f1(null) : (
                  <ul className="m2-plain">{o.rules.recovered.map((r) => <li key={r.check_id}>{rule(r.check_id)}</li>)}</ul>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}

const statCells = (s: FixStat) => (
  <>
    <td data-label={t("Fixed")} className="m2-num">{int(s.fixed)}</td>
    <td data-label={t("Median")} className="m2-num">{days(s.median_days)}</td>
    <td data-label={t("Slowest tenth")} className="m2-num">{days(s.p90_days)}</td>
  </>
);

function TimeToFixPanel() {
  const q = useAnalytics("time-to-fix", () => getTimeToFix(180));
  const rule = useRuleName();
  const title = t("Time to fix");
  const head = (first: string) => [first, t("Fixed"), t("Median"), t("Slowest tenth")];
  return (
    <Section q={q} title={title} meta={t("From found to fixed, last {n} days", { n: int(180) })} testId="wa-time-to-fix">
      {(d) => d.overall.fixed === 0 ? <EmptyFrame>{t("Nothing was fixed in this window.")}</EmptyFrame> : (
        <>
          <p className="m2-meta">{t("Half of all issues are fixed within {m}; nine in ten within {p}.", { m: days(d.overall.median_days), p: days(d.overall.p90_days) })}</p>
          <Table title={t("Time to fix by severity")} head={head(t("Severity"))}>
            {d.by_severity.map((s) => <tr key={s.severity}><th scope="row" className="m2-card-lead"><Sev severity={s.severity} /></th>{statCells(s)}</tr>)}
          </Table>
          <Table title={t("Time to fix by object")} head={head(t("Object"))}>
            {d.by_object.map((s) => <tr key={s.module}><th scope="row" className="m2-card-lead">{formatModuleName(s.module)}</th>{statCells(s)}</tr>)}
          </Table>
          <Table title={t("Slowest rules to fix")} head={head(t("Rule"))}>
            {d.by_check.map((s) => <tr key={s.check_id}><th scope="row" className="m2-card-lead">{rule(s.check_id)}</th>{statCells(s)}</tr>)}
          </Table>
        </>
      )}
    </Section>
  );
}

function ThroughputPanel() {
  const q = useAnalytics("throughput", getThroughput);
  const title = t("Decisions per person");
  return (
    <Section q={q} title={title} meta={t("Last {n} days", { n: int(q.data?.window_days ?? 28) })} testId="wa-throughput">
      {(d) => (
        <>
          {d.people.length === 0 ? <EmptyFrame>{t("No decisions were recorded in this window.")}</EmptyFrame> : (
            <Table title={title} head={[t("Person"), t("Decisions"), t("Day by day"), t("Accepted"), t("Edited"), t("Not an issue"), t("Risk accepted"), t("Approved")]}>
              {d.people.map((p) => (
                <tr key={p.person}>
                  <th scope="row" className="m2-card-lead">{p.person}</th>
                  <td data-label={t("Decisions")} className="m2-num">{int(p.total)}</td>
                  <td data-label={t("Day by day")}>
                    <Sparkline values={d.days.map((x) => x.by_person[p.person] ?? 0)} label={t("{name}, decisions over {n} days", { name: p.person, n: int(d.days.length) })} width={96} height={20} />
                  </td>
                  <td data-label={t("Accepted")} className="m2-num">{int(p.accept)}</td>
                  <td data-label={t("Edited")} className="m2-num">{int(p.edit)}</td>
                  <td data-label={t("Not an issue")} className="m2-num">{int(p.not_an_issue)}</td>
                  <td data-label={t("Risk accepted")} className="m2-num">{int(p.accept_risk)}</td>
                  <td data-label={t("Approved")} className="m2-num">{int(p.approve)}</td>
                </tr>
              ))}
            </Table>
          )}
          {d.workload.length > 0 ? (
            <Table title={t("Open work per assignee")} head={[t("Assignee"), t("Open"), t("Critical"), t("Overdue")]}>
              {d.workload.map((w) => (
                <tr key={w.assignee_id}>
                  <th scope="row" className="m2-card-lead">{w.name ?? w.email ?? w.assignee_id}</th>
                  <td data-label={t("Open")} className="m2-num">{int(w.open)}</td>
                  <td data-label={t("Critical")} className="m2-num">{int(w.critical)}</td>
                  <td data-label={t("Overdue")} className="m2-num">{int(w.overdue)}</td>
                </tr>
              ))}
            </Table>
          ) : null}
        </>
      )}
    </Section>
  );
}

function RecurrencePanel() {
  const q = useAnalytics("recurrence", getRecurrence);
  const rule = useRuleName();
  const title = t("Issues that came back");
  const head = (first: string) => [first, t("Issues"), t("Came back"), t("Times reopened"), t("Rate")];
  return (
    <Section q={q} title={title} meta={q.data ? t("{rate} of all issues came back after they were closed", { rate: pctOf(q.data.totals.rate_pct) }) : undefined} testId="wa-recurrence">
      {(d) => d.totals.issues === 0 ? <EmptyFrame>{t("No issues have been closed yet.")}</EmptyFrame> : (
        <>
          <Table title={t("Rules whose issues come back most")} head={head(t("Rule"))}>
            {d.by_check.map((r) => (
              <tr key={r.check_id}>
                <th scope="row" className="m2-card-lead">{rule(r.check_id)} <span className="m2-meta">{formatModuleName(r.module)}</span></th>
                <td data-label={t("Issues")} className="m2-num">{int(r.issues)}</td>
                <td data-label={t("Came back")} className="m2-num">{int(r.reopened)}</td>
                <td data-label={t("Times reopened")} className="m2-num">{int(r.reopens)}</td>
                <td data-label={t("Rate")} className="m2-num">{pctOf(r.rate_pct)}</td>
              </tr>
            ))}
          </Table>
          <Table title={t("Issues that came back, by system")} head={head(t("System"))}>
            {d.by_system.map((r) => (
              <tr key={`${r.scope}-${r.name}`}>
                <th scope="row" className="m2-card-lead">{r.name ?? f1(null)}</th>
                <td data-label={t("Issues")} className="m2-num">{int(r.issues)}</td>
                <td data-label={t("Came back")} className="m2-num">{int(r.reopened)}</td>
                <td data-label={t("Times reopened")} className="m2-num">{int(r.reopens)}</td>
                <td data-label={t("Rate")} className="m2-num">{pctOf(r.rate_pct)}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Section>
  );
}

function RootCausePanel() {
  const q = useAnalytics("root-causes", getRootCauses);
  const title = t("Where the failing records sit");
  return (
    <Section q={q} title={title} meta={t("Records with an open issue, by organisational unit")} testId="wa-root-causes">
      {(d) => d.dimensions.length === 0 ? <EmptyFrame>{t("The failing records carry no organisational unit.")}</EmptyFrame> : (
        <>
          {d.dimensions.map((dim) => (
            <Table key={dim.field} title={t("{unit}: {n} values", { unit: dim.label, n: int(dim.values) })} head={[dim.label, t("Records"), t("Share"), t("Issues"), t("Open"), t("Critical")]}>
              {dim.top.map((v) => (
                <tr key={v.value}>
                  <th scope="row" className="m2-card-lead"><Coded code={v.value} text={null} /> <span className="m2-meta">{dim.label} ({dim.field})</span></th>
                  <td data-label={t("Records")} className="m2-num">{int(v.records)}</td>
                  <td data-label={t("Share")} className="m2-num">{pctOf(v.share_pct)}</td>
                  <td data-label={t("Issues")} className="m2-num">{int(v.issues)}</td>
                  <td data-label={t("Open")} className="m2-num">{int(v.open)}</td>
                  <td data-label={t("Critical")} className="m2-num">{int(v.critical)}</td>
                </tr>
              ))}
            </Table>
          ))}
        </>
      )}
    </Section>
  );
}

function ProposalPanel() {
  const q = useAnalytics("proposal-quality", getProposalQuality);
  const title = t("How good the proposals are");
  return (
    <Section q={q} title={title} meta={t("Approved, and still fixed at the next run, by where the proposal came from")} testId="wa-proposals">
      {(d) => (
        <Table title={title} head={[t("Source"), t("Proposed"), t("Approved"), t("Approval rate"), t("Written to SAP"), t("Fixed"), t("Still failing"), t("Fix rate")]}>
          {d.sources.map((s) => (
            <tr key={s.source}>
              <th scope="row" className="m2-card-lead">{SOURCE[s.source]?.() ?? s.source}</th>
              <td data-label={t("Proposed")} className="m2-num">{int(s.proposed)}</td>
              <td data-label={t("Approved")} className="m2-num">{int(s.approved)}</td>
              <td data-label={t("Approval rate")} className="m2-num">{pctOf(s.approval_rate_pct)}</td>
              <td data-label={t("Written to SAP")} className="m2-num">{int(s.exported)}</td>
              <td data-label={t("Fixed")} className="m2-num">{int(s.fixed)}</td>
              <td data-label={t("Still failing")} className="m2-num">{int(s.still_failing)}</td>
              <td data-label={t("Fix rate")} className="m2-num">{pctOf(s.fix_rate_pct)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}
