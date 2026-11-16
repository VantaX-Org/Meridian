"use client";

/**
 * Post-clean monitoring, as the v2 Work monitor had it: per system, the records a cleaning batch fixed that fail a rule
 * again in the later run (GET /remediation/monitor), the weekly series with drift by rule and still clean by batch
 * (GET /work/back-after-clean), and every measured object's cadence, freshness and drift (GET /objects/monitor).
 */
import { useQuery } from "@tanstack/react-query";
import { Code, EmptyState, ErrorState, NxLink, Skeleton, StatCard } from "../kit";
import { DeltaBar } from "../kit/viz";
import { useObjectsMonitor, freshnessWord, cadenceText, triggerText, baselineText } from "@/design/v2/screens/ObjectMonitors";
import { getBackAfterClean, getMonitor, type MonitorItem } from "@/lib/api/remediation";
import { formatDate } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import { batchLabel } from "@/lib/v2/batches";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { useLandscape } from "@/lib/v2/queries";
import { f1, int } from "@/lib/v2/score";
import "../runs/runs.css";
import "./monitor.css";

const score = (x: number | null | undefined) => (x == null ? "" : f1(x));

export function PostClean() {
  const q = useQuery({ queryKey: queryKeys.remediationMonitor(), queryFn: getMonitor, staleTime: 30_000, retry: false });
  const items = q.data?.items ?? [];
  const back = items.reduce((s, i) => s + (i.monitor?.new_records ?? 0), 0);
  const fixed = items.reduce((s, i) => s + (i.monitor?.resolved_records ?? 0), 0);
  return (
    <section className="nx-mon" aria-label={t("After cleaning")} data-testid="post-clean">
      <p className="nx-mon-lede">{t("After a cleaning batch, the next run checks the same records again. This page shows the ones that fail again and the ones that stayed fixed, per system, current run against the run before the clean.")}</p>
      {q.isLoading ? (
        <Skeleton lines={5} label={t("After cleaning")} />
      ) : q.isError ? (
        <ErrorState error={q.error} fallback={t("The monitor could not be read.")} onRetry={() => void q.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon="info" heading={t("Nothing to monitor yet. Once a run follows a cleaning batch, records that fail again show here.")}>
          <NxLink className="nx-rn-link" href="/cleansing">{t("Open cleansing")}</NxLink>
        </EmptyState>
      ) : (
        <>
          <div className="nx-card" data-testid="monitor-banner">
            <h2 className="nx-rn-h3">{t("{back} records failed a rule again since the last run.", { back: int(back) })}</h2>
            <p className="nx-rn-sub">{t("{fixed} records were fixed in the same period.", { fixed: int(fixed) })}</p>
            <div className="nx-mon-filters">
              <StatCard label={t("Failing again")} value={back} />
              <StatCard label={t("Fixed since")} value={fixed} />
            </div>
            <p className="nx-rn-pager">
              {back > 0 ? <NxLink className="nx-rn-link" href="/work" data-testid="monitor-primary">{t("Open the work list")}</NxLink> : null}
              <NxLink className="nx-rn-link" href="/cleansing">{t("Open cleansing")}</NxLink>
            </p>
          </div>
          <dl className="nx-rn-sub">
            <dt>{t("Failing again")}</dt><dd>{t("Records a batch fixed that fail a rule in the later run.")}</dd>
            <dt>{t("Fixed since")}</dt><dd>{t("Records that failed before and pass now.")}</dd>
            <dt>{t("Score then")}</dt><dd>{t("The data quality score of the earlier run, out of 100.")}</dd>
            <dt>{t("Score now")}</dt><dd>{t("The data quality score of the latest run, out of 100.")}</dd>
          </dl>
          <table className="nx-rn-table" data-testid="monitor-table">
            <caption className="nx-rn-sr">{t("After cleaning")}</caption>
            <thead>
              <tr>
                <th scope="col">{t("System")}</th><th scope="col">{t("Score then")}</th><th scope="col">{t("Score now")}</th>
                <th scope="col">{t("Failing again")}</th><th scope="col">{t("Fixed since")}</th><th scope="col">{t("Rules failing again")}</th>
                <th scope="col">{t("Batch")}</th><th scope="col">{t("Schedules and alerts")}</th>
              </tr>
            </thead>
            <tbody>{items.map((i) => <Row key={i.lineage ?? i.scope} i={i} />)}</tbody>
          </table>
        </>
      )}
      <Trend />
    </section>
  );
}

function Row({ i }: { i: MonitorItem }) {
  const m = i.monitor;
  return (
    <tr data-testid="monitor-row">
      <th scope="row">
        {i.system_name ?? i.scope}
        <div className="nx-rn-sub">{t("Compared with")} <NxLink className="nx-rn-link" href={`/next/run/${i.baseline.id}`}><Code code={i.baseline.id.slice(0, 8)} /></NxLink></div>
        <div className="nx-rn-sub">{t("Latest")} <NxLink className="nx-rn-link" href={`/next/run/${i.latest.id}`}><Code code={i.latest.id.slice(0, 8)} /></NxLink></div>
      </th>
      <td>{score(i.baseline.dqs)}</td>
      <td>{score(i.latest.dqs)}</td>
      <td>{m ? int(m.new_records) : ""}</td>
      <td>{m ? int(m.resolved_records) : ""}</td>
      <td>
        {m?.regressed_checks.slice(0, 4).map((c) => (
          <div key={c.check_id}>
            <NxLink className="nx-rn-link" href={`/more/rules?rule=${encodeURIComponent(c.check_id)}`}><Code code={c.check_id} text={c.name ?? undefined} /></NxLink>{" "}
            <span className="nx-rn-sub">{t("{n} records", { n: int(c.new) })}</span>
          </div>
        ))}
        {m && m.regressed_check_count > 4 ? <div className="nx-rn-sub">{t("and {n} more", { n: int(m.regressed_check_count - 4) })}</div> : null}
      </td>
      <td>{m?.batch_id ? <NxLink className="nx-rn-link" href={`/work?batch=${encodeURIComponent(m.batch_id)}`}><Code code={batchLabel(m.batch_id)} /></NxLink> : ""}</td>
      <td><NxLink className="nx-rn-link" href={`/s/${encodeURIComponent(i.scope)}?tab=schedules`}>{t("Schedules and alerts")}</NxLink></td>
    </tr>
  );
}

function Trend() {
  const q = useQuery({ queryKey: queryKeys.backAfterClean(), queryFn: () => getBackAfterClean(12), staleTime: 60_000, retry: false });
  if (q.isLoading) return <Skeleton lines={4} label={t("Failing again after a clean, by week")} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} fallback={t("The weekly series could not be read.")} onRetry={() => void q.refetch()} />;
  const { weeks, batches } = q.data;
  const rules = q.data.rules.filter((r) => r.back_recent !== r.back_before);
  return (
    <section aria-label={t("Weekly trend, drift by rule and still clean by batch")}>
      <h2 className="nx-rn-h3">{t("Weekly trend, drift by rule and still clean by batch")}</h2>
      <div className="nx-card" data-testid="back-weekly">
        <h3 className="nx-rn-h3">{t("Failing again after a clean, by week")}</h3>
        {weeks.every((w) => w.back === 0) ? (
          <EmptyState icon="info" heading={t("No record has failed again after a clean yet.")} />
        ) : (
          <>
            <StatCard label={t("Failing again")} value={weeks.reduce((s, w) => s + w.back, 0)} spark={weeks.map((w) => w.back)} sparkLabel={t("Records failing again after a clean, by week")} />
            <table className="nx-rn-table">
              <caption className="nx-rn-sr">{t("Failing again and fixed, by week")}</caption>
              <thead><tr><th scope="col">{t("Week")}</th><th scope="col">{t("Failing again")}</th><th scope="col">{t("Fixed")}</th></tr></thead>
              <tbody>
                {weeks.map((w) => (
                  <tr key={w.week} title={t("Week of {label}: {back} failed again, {fixed} fixed", { label: formatDate(w.week, "date"), back: int(w.back), fixed: int(w.fixed) })}>
                    <th scope="row">{formatDate(w.week, "date")}</th><td>{int(w.back)}</td><td>{int(w.fixed)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
      {rules.length ? (
        <div className="nx-card" data-testid="drift-table">
          <h3 className="nx-rn-h3">{t("Drift by rule")}</h3>
          <p className="nx-rn-sub">{t("Records failing again, before and after the last clean")}</p>
          <table className="nx-rn-table">
            <caption className="nx-rn-sr">{t("Drift by rule")}</caption>
            <thead><tr><th scope="col">{t("Rule")}</th><th scope="col">{t("Before")}</th><th scope="col">{t("Now")}</th><th scope="col">{t("Change")}</th><th scope="col"><span className="nx-rn-sr">{t("Change")}</span></th></tr></thead>
            <tbody>
              {rules.map((r) => {
                const c = r.back_recent - r.back_before;
                return (
                  <tr key={r.check_id}>
                    <th scope="row"><NxLink className="nx-rn-link" href={`/more/rules?rule=${encodeURIComponent(r.check_id)}`}><Code code={r.check_id} text={r.message ?? undefined} /></NxLink></th>
                    <td>{int(r.back_before)}</td><td>{int(r.back_recent)}</td><td>{c > 0 ? `+${int(c)}` : int(c)}</td>
                    <td><DeltaBar d={c} scale={2} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      {batches.length ? (
        <div className="nx-card" data-testid="cohort-table">
          <h3 className="nx-rn-h3">{t("Still clean, by batch")}</h3>
          <p className="nx-rn-sub">{t("Of the records each batch fixed, the share that has not failed again")}</p>
          <table className="nx-rn-table">
            <caption className="nx-rn-sr">{t("Still clean, by batch")}</caption>
            <thead><tr><th scope="col">{t("Batch")}</th><th scope="col">{t("Fixed")}</th><th scope="col">{t("Failing again")}</th><th scope="col">{t("Still clean")}</th></tr></thead>
            <tbody>
              {batches.map((b) => (
                <tr key={b.id}>
                  <th scope="row"><NxLink className="nx-rn-link" href={`/work?batch=${encodeURIComponent(b.id)}`}><Code code={batchLabel(b.id)} /></NxLink></th>
                  <td>{int(b.fixed)}</td><td>{int(b.back)}</td>
                  <td>{b.fixed > 0 ? `${Math.round(((b.fixed - b.back) / b.fixed) * 100)}%` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

/** Every measured object: how often it runs, how fresh it is, and what changed since its baseline. */
export function WatchedObjects() {
  const q = useObjectsMonitor();
  const land = useLandscape(null);
  const labelOf = (module: string) => land.data?.objects?.find((o) => o.module === module)?.label ?? moduleText(module);
  return (
    <section className="nx-mon" aria-label={t("Objects")} data-testid="objects-monitor">
      <h2 className="nx-rn-h3">{t("Objects")}</h2>
      <p className="nx-mon-lede">{t("How often each object is measured, how fresh it is, and what changed since its baseline")}</p>
      {q.isLoading ? (
        <Skeleton lines={5} label={t("Objects")} />
      ) : q.isError ? (
        <ErrorState error={q.error} fallback={t("The object monitor could not be read.")} onRetry={() => void q.refetch()} />
      ) : !q.data?.objects.length ? (
        <EmptyState icon="info" heading={t("No object has been measured yet.")} />
      ) : (
        <table className="nx-rn-table" data-testid="objects-monitor-table">
          <caption className="nx-rn-sr">{t("Objects")}</caption>
          <thead>
            <tr>
              <th scope="col">{t("Object")}</th><th scope="col">{t("Freshness")}</th><th scope="col">{t("Cadence")}</th>
              <th scope="col">{t("Last run")}</th><th scope="col">{t("Started by")}</th><th scope="col">{t("Baseline")}</th>
              <th scope="col">{t("Newly failing")}</th><th scope="col">{t("Recovered")}</th><th scope="col">{t("Rules that changed")}</th>
            </tr>
          </thead>
          <tbody>
            {q.data.objects.map((m) => {
              const d = m.drift;
              const by = [triggerText(m), m.requested_by_label].filter(Boolean).join(", ");
              return (
                <tr key={`${m.system_id ?? ""}:${m.module}`} data-testid="objects-monitor-row" data-freshness={m.freshness}>
                  <th scope="row"><Code code={m.module} text={labelOf(m.module)} /></th>
                  <td><Code code={m.freshness} text={freshnessWord(m.freshness)} /></td>
                  <td>
                    {cadenceText(m) ?? ""}
                    {m.next_run_at ? <div className="nx-rn-sub">{t("Next {when}", { when: formatDate(m.next_run_at, "datetime") })}</div> : null}
                  </td>
                  <td>{m.last_run_at ? (m.last_version_id ? <NxLink className="nx-rn-link" href={`/next/run/${m.last_version_id}`}>{formatDate(m.last_run_at, "datetime")}</NxLink> : formatDate(m.last_run_at, "datetime")) : t("No run yet")}</td>
                  <td>{by || t("Not recorded")}</td>
                  <td>{baselineText(m) ?? t("No baseline yet")}</td>
                  <td>{int(d.new_failing)}</td>
                  <td>{int(d.recovered)}</td>
                  <td>
                    {d.newly_failing_rules.length === 0 && d.recovered_rules.length === 0 ? <span className="nx-rn-sub">{t("No rule changed since the baseline")}</span> : null}
                    {d.newly_failing_rules.slice(0, 3).map((r) => (
                      <div key={r.check_id}><Code code={r.check_id} /> <span className="nx-rn-sub">{t("{n} records now failing", { n: int(r.new) })}</span></div>
                    ))}
                    {d.newly_failing_rule_count > 3 ? <div className="nx-rn-sub">{t("and {n} more", { n: int(d.newly_failing_rule_count - 3) })}</div> : null}
                    {d.recovered_rules.slice(0, 3).map((r) => (
                      <div key={r.check_id}><Code code={r.check_id} /> <span className="nx-rn-sub">{t("recovered")}</span></div>
                    ))}
                    {d.recovered_rule_count > 3 ? <div className="nx-rn-sub">{t("and {n} more", { n: int(d.recovered_rule_count - 3) })}</div> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
