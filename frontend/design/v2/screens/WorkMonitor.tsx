"use client";

import { useQuery } from "@tanstack/react-query";
import { getBackAfterClean, getMonitor, type BackAfterClean, type MonitorItem } from "@/lib/api/remediation";
import { queryKeys } from "@/lib/query-keys";
import { formatDate } from "@/lib/format";
import { int, f1 } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { Coded, EmptyFrame, ErrorFrame, Mono, PageTitle, Skeleton, V2Link } from "../parts";
import { batchLabel } from "@/lib/v2/batches";
import { ChartFrame, ChartTable, DeltaBar, TrendChart, niceTicks } from "../charts";
import { WorkTabs } from "./WorkTabs";
import "../approvals.css";

/** Post-clean monitoring: per system, the records that failed a rule they passed at the last run, and what has been fixed since. */
export function WorkMonitor() {
  const q = useQuery({ queryKey: queryKeys.remediationMonitor(), queryFn: getMonitor, staleTime: 30_000 });
  const items = q.data?.items ?? [];
  const back = items.reduce((n, i) => n + (i.monitor?.new_records ?? 0), 0);
  const fixed = items.reduce((n, i) => n + (i.monitor?.resolved_records ?? 0), 0);
  return (
    <div data-testid="work-monitor">
      <PageTitle>{t("Work")}</PageTitle>
      <WorkTabs current="monitor" />
      {q.isPending ? (
        <Skeleton width={420} height={16} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The monitor could not be read.")}</ErrorFrame>
      ) : items.length === 0 ? (
        <EmptyFrame>{t("Nothing to monitor yet. Once a run follows a cleaning batch, records that fail again show here.")}</EmptyFrame>
      ) : (
        <>
          <p className="m2-finding">
            {t("{back} records failed a rule again since the last run, {fixed} were fixed.", { back: int(back), fixed: int(fixed) })}
          </p>
          <table className="m2-tbl" data-testid="monitor-table">
            <thead>
              <tr>
                <th>{t("System")}</th>
                <th scope="col" className="m2-r">{t("Score then")}</th>
                <th scope="col" className="m2-r">{t("Score now")}</th>
                <th scope="col" className="m2-r">{t("Failing again")}</th>
                <th scope="col" className="m2-r">{t("Fixed since")}</th>
                <th>{t("Rules failing again")}</th>
                <th>{t("Batch")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <Row key={i.lineage ?? i.scope} i={i} />
              ))}
            </tbody>
          </table>
          <Trend />
        </>
      )}
    </div>
  );
}

const score = (n: number | null) => (n == null ? "—" : f1(n));

function Row({ i }: { i: MonitorItem }) {
  const m = i.monitor;
  return (
    <tr>
      <td>
        {i.system_name ?? i.scope}
        <div className="m2-meta">{t("Compared with {when}", { when: i.baseline.run_at ? formatDate(i.baseline.run_at, "date") : "—" })}</div>
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
                <span className="m2-meta">{int(c.new)}</span>
              </div>
            ))
          : "—"}
        {m && m.regressed_check_count > 4 ? <div className="m2-meta">{t("and {n} more", { n: int(m.regressed_check_count - 4) })}</div> : null}
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
        <table className="m2-tbl" data-testid="drift-table">
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
        </table>
      ) : null}
      {d?.batches.length ? (
        <table className="m2-tbl" data-testid="cohort-table">
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
        </table>
      ) : null}
    </>
  );
}
