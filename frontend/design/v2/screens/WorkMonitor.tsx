"use client";

import { useQuery } from "@tanstack/react-query";
import { getBackAfterClean, getMonitor, type BackAfterClean, type MonitorItem } from "@/lib/api/remediation";
import { queryKeys } from "@/lib/query-keys";
import { formatDate } from "@/lib/format";
import { int, f1 } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { Consequence, FixHead, FlowSteps, MoreDetail, RunById } from "../FixParts";
import { Coded, EmptyFrame, ErrorFrame, Mono, PageTitle, Skeleton, V2Link } from "../parts";
import { batchLabel } from "@/lib/v2/batches";
import { ChartFrame, ChartTable, DeltaBar, TrendChart, niceTicks } from "../charts";
import { WorkTabs } from "./WorkTabs";
import { ObjectsMonitor } from "./ObjectMonitors";
import { CcBanner, CcPage } from "./cc-parts";
import { Panel } from "./Mining";
import { ScrollFrame } from "./object/ScrollFrame";
import "../approvals.css";
import { TableExport } from "@/design/v2/TableExport";

/** Post-clean monitoring: per system, the records that failed a rule they passed at the last run, and what has been fixed since. */
export function WorkMonitor() {
  const q = useQuery({ queryKey: queryKeys.remediationMonitor(), queryFn: getMonitor, staleTime: 30_000 });
  const items = q.data?.items ?? [];
  const back = items.reduce((n, i) => n + (i.monitor?.new_records ?? 0), 0);
  const fixed = items.reduce((n, i) => n + (i.monitor?.resolved_records ?? 0), 0);
  return (
    <CcPage>
      <div data-testid="work-monitor">
        <PageTitle sub={t("Monitor")}>{t("Work")}</PageTitle>
        <WorkTabs current="monitor" />
        {q.isPending ? (
          <Skeleton width={420} height={16} />
        ) : q.isError ? (
          <ErrorFrame onRetry={() => void q.refetch()}>{t("The monitor could not be read.")}</ErrorFrame>
        ) : items.length === 0 ? (
          <EmptyFrame action={<V2Link href="/cleansing" className="m2-btn">{t("Open cleansing")}</V2Link>}>{t("Nothing to monitor yet. Once a run follows a cleaning batch, records that fail again show here.")}</EmptyFrame>
        ) : (
          <>
            <CcBanner
              testId="monitor-banner"
              label={t("Monitor")}
              eyebrow={t("Monitor")}
              verdict={back > 0 ? "at-risk" : "go"}
              headline={t("{back} records failed a rule again since the last run.", { back: int(back) })}
              why={t("{fixed} records were fixed in the same period.", { fixed: int(fixed) })}
              figs={[
                { label: t("Failing again"), value: int(back) },
                { label: t("Fixed since"), value: int(fixed) },
              ]}
              action={
                <>
                  {back > 0 ? <V2Link href="/work" className="m2-btn m2-strong" data-testid="monitor-primary">{t("Open the work list")}</V2Link> : null}
                  <V2Link href="/cleansing" className="m2-btn">{t("Open cleansing")}</V2Link>
                </>
              }
            />
            <FixHead
              lede={t("After a cleaning batch, the next run checks the same records again. This page shows the ones that fail again and the ones that stayed fixed, per system, current run against the run before the clean.")}
              means={[
                [t("Failing again"), t("Records a batch fixed that fail a rule in the later run.")],
                [t("Fixed since"), t("Records that failed before and pass now.")],
                [t("Score then"), t("The data quality score of the earlier run, out of 100.")],
                [t("Score now"), t("The data quality score of the latest run, out of 100.")],
              ]}
            />
            <FlowSteps
              label={t("Monitor steps")}
              current={back > 0 ? 1 : 2}
              steps={[
                { label: t("Read what failed again"), count: int(back), hint: t("The table below lists each system, the rules failing again and the batch that fixed them.") },
                { label: t("Open the work list"), hint: t("Fix the records that failed again.") },
                { label: t("Check the next run"), hint: t("The next run shows whether the fixes held.") },
              ]}
            />
            {back > 0 ? <Consequence>{t("Opening the work list changes nothing. It shows the records to fix.")}</Consequence> : null}
            <ScrollFrame label={t("Monitor")}>
            <TableExport><table className="m2-tbl" data-testid="monitor-table">
              <thead>
                <tr>
                  <th>{t("System")}</th>
                  <th scope="col" className="m2-r">{t("Score then")}</th>
                  <th scope="col" className="m2-r">{t("Score now")}</th>
                  <th scope="col" className="m2-r">{t("Failing again")}</th>
                  <th scope="col" className="m2-r">{t("Fixed since")}</th>
                  <th>{t("Rules failing again")}</th>
                  <th>{t("Batch")}</th>
                  <th>{t("Schedules and alerts")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <Row key={i.lineage ?? i.scope} i={i} />
                ))}
              </tbody>
            </table></TableExport>
            </ScrollFrame>
            <MoreDetail title={t("Weekly trend, drift by rule and still clean by batch")}>
              <Trend />
            </MoreDetail>
          </>
        )}
        <ObjectsMonitor />
      </div>
    </CcPage>
  );
}

const score = (n: number | null) => (n == null ? "—" : f1(n));

function Row({ i }: { i: MonitorItem }) {
  const m = i.monitor;
  return (
    <tr>
      <td>
        {i.system_name ?? i.scope}
        <div className="m2-meta">{t("Compared with")} <RunById id={i.baseline.id} systemId={i.scope} system={i.system_name} /></div>
        <div className="m2-meta">{t("Latest")} <RunById id={i.latest.id} systemId={i.scope} system={i.system_name} /></div>
      </td>
      <td className="m2-r">{score(i.baseline.dqs)}</td>
      <td className="m2-r">{score(i.latest.dqs)}</td>
      <td className="m2-r">{m ? int(m.new_records) : "—"}</td>
      <td className="m2-r">{m ? int(m.resolved_records) : "—"}</td>
      <td>
        {m?.regressed_checks.length
          ? m.regressed_checks.slice(0, 4).map((c) => (
              <div key={c.check_id}>
                <V2Link href={`/r/${encodeURIComponent(c.check_id)}`}>
                  <Mono>{c.check_id}</Mono>
                </V2Link>{" "}
                {c.name ? <span>{c.name}</span> : null}{" "}
                <span className="m2-meta">{t("{n} records", { n: int(c.new) })}</span>
              </div>
            ))
          : "—"}
        {m && m.regressed_check_count > 4 ? <div className="m2-meta">{t("and {n} more", { n: int(m.regressed_check_count - 4) })}</div> : null}
      </td>
      <td>
        <V2Link href={`/s/${encodeURIComponent(i.scope)}?tab=schedules`}>{t("Schedules and alerts")}</V2Link>
      </td>
      <td>{m?.batch_id ? <V2Link href={`/work?batch=${encodeURIComponent(m.batch_id)}`}>{batchLabel(m.batch_id)}</V2Link> : "—"}</td>
    </tr>
  );
}

/** The weekly series: records that failed again after a clean, with the fixed count in the table; drift by rule; still clean by batch. */
function Trend() {
  const q = useQuery({ queryKey: queryKeys.backAfterClean(), queryFn: () => getBackAfterClean(12), staleTime: 30_000 });
  const d: BackAfterClean | undefined = q.data;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{t("The weekly series could not be read.")}</ErrorFrame>;
  const weeks = d?.weeks ?? [];
  const top = Math.max(1, ...weeks.map((w) => w.back));
  const ticks = niceTicks(0, top, 4);
  const points = weeks.map((w) => {
    const label = formatDate(w.week, "date");
    return { id: w.week, label, title: t("Week of {label}: {back} failed again, {fixed} fixed", { label, back: int(w.back), fixed: int(w.fixed) }), value: w.back };
  });
  const rules = (d?.rules ?? []).filter((r) => r.back_recent !== r.back_before);
  return (
    <>
      <ChartFrame
        title={t("Failing again after a clean, by week")}
        height={180}
        state={q.isPending ? "loading" : weeks.length === 0 ? "empty" : "ready"}
        empty={t("No record has failed again after a clean yet.")}
        testId="back-weekly"
        table={
          <ChartTable
            caption={t("Failing again and fixed, by week")}
            head={[t("Week"), t("Failing again"), t("Fixed")]}
            rows={weeks.map((w) => [formatDate(w.week, "date"), int(w.back), int(w.fixed)])}
          />
        }
      >
        <TrendChart points={points} domain={[0, ticks[ticks.length - 1]]} ticks={ticks} label={t("Records failing again after a clean, by week")} yLabel={t("records")} format={int} />
      </ChartFrame>
      {rules.length ? (
        <Panel title={t("Drift by rule")} meta={t("Records failing again, before and after the last clean")} testId="drift-panel">
        <ScrollFrame label={t("Drift by rule")}>
        <TableExport><table className="m2-tbl" data-testid="drift-table">
          <caption className="m2-sr">{t("Drift by rule")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("Rule")}</th>
              <th scope="col" className="m2-r">{t("Before")}</th>
              <th scope="col" className="m2-r">{t("Now")}</th>
              <th scope="col" className="m2-r">{t("Change")}</th>
              <th scope="col" aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {rules.map((r) => {
              const c = r.back_recent - r.back_before;
              return (
                <tr key={r.check_id}>
                  <td>
                    <V2Link href={`/r/${encodeURIComponent(r.check_id)}`}>
                      <Coded code={r.check_id} text={r.message} />
                    </V2Link>
                  </td>
                  <td className="m2-r">{int(r.back_before)}</td>
                  <td className="m2-r">{int(r.back_recent)}</td>
                  <td className="m2-r">{(c > 0 ? "+" : "") + int(c)}</td>
                  <td><DeltaBar d={c} scale={2} /></td>
                </tr>
              );
            })}
          </tbody>
        </table></TableExport>
        </ScrollFrame>
        </Panel>
      ) : null}
      {d?.batches.length ? (
        <Panel title={t("Still clean, by batch")} meta={t("Of the records each batch fixed, the share that has not failed again")} testId="cohort-panel">
        <ScrollFrame label={t("Still clean, by batch")}>
        <TableExport><table className="m2-tbl" data-testid="cohort-table">
          <caption className="m2-sr">{t("Still clean, by batch")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("Batch")}</th>
              <th scope="col" className="m2-r">{t("Fixed")}</th>
              <th scope="col" className="m2-r">{t("Failing again")}</th>
              <th scope="col" className="m2-r">{t("Still clean")}</th>
            </tr>
          </thead>
          <tbody>
            {d.batches.map((b) => (
              <tr key={b.id}>
                <td><V2Link href={`/work?batch=${encodeURIComponent(b.id)}`}>{batchLabel(b.id)}</V2Link></td>
                <td className="m2-r">{int(b.fixed)}</td>
                <td className="m2-r">{int(b.back)}</td>
                <td className="m2-r">{Math.round(((b.fixed - b.back) / b.fixed) * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table></TableExport>
        </ScrollFrame>
        </Panel>
      ) : null}
    </>
  );
}
