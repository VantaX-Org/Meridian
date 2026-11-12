"use client";
/**
 * Panels for routes that had no screen: the portfolio impact (GET /analytics/impact), the sprint planner
 * (/analytics/sprints), the MDM health scorecard (/analytics/mdm-health), the executive read, cleansing pipeline and
 * owner digests (/insights/overview, /exec, /cleansing, /owners), and the duplicate cluster of one record
 * (/insights/duplicates/{object}/{record_id}). Each reads its own endpoint and says so when the role cannot read it.
 * A field the backend leaves null is a dash; the Aletheia projection is shown only when the role may see it.
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useFixture } from "@/lib/api/v2/fixture";
import { getImpactPortfolio, getMdmHealthSeries, getSprintPlan } from "@/lib/api/v2/analytics";
import { getCleansing, getDuplicateCluster, getExec, getOverview, getOwners } from "@/lib/api/v2/insights";
import { formatDate, formatModuleName, labelOf } from "@/lib/format";
import { money } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { f1, int, pct1 } from "@/lib/v2/score";
import { Sparkline } from "../charts";
import { getRecordFindings, getRecordSheet } from "@/lib/api/v2/object-records";
import { describeField, sapField } from "@/lib/v2/sap-fields";
import { EmptyFrame, Mono } from "../parts";
import { CcHBars } from "./cc-parts";
import { retry, Section, status, Table, useRuleName } from "./WorkAnalytics";

/** One read per panel; a 404 is "nothing yet" and the panel decides what to say. */
function useRead<T>(key: string, fn: () => Promise<T>, extra: readonly unknown[] = []) {
  const fixture = useFixture();
  return useQuery({ queryKey: ["extra", key, fixture, ...extra], queryFn: fn, staleTime: 60_000, retry });
}

const dash = f1(null);

/* ---------------------------------------------------------------- impact */

export function ImpactPortfolio({ categoryName }: { categoryName: (key: string) => string | undefined }) {
  const q = useRead("impact", getImpactPortfolio);
  const title = t("Impact of the latest run");
  return (
    <Section q={q} title={title} meta={t("What each kind of loss costs a year and how much is already mitigated")} testId="val-portfolio">
      {(d) => d.impacts.length === 0 ? <EmptyFrame>{t("No finished run has been priced yet.")}</EmptyFrame> : (
        <Table title={title} head={[t("Loss"), t("Annual risk"), t("Mitigated"), t("Share mitigated"), t("Findings")]}>
          {[...d.impacts].sort((a, b) => b.annual_risk - a.annual_risk).map((i) => (
            <tr key={i.category}>
              <th scope="row" className="m2-card-lead">{categoryName(i.category) ?? i.category}</th>
              <td data-label={t("Annual risk")} className="m2-num">{money(i.annual_risk, i.currency)}</td>
              <td data-label={t("Mitigated")} className="m2-num">{money(i.mitigated, i.currency)}</td>
              <td data-label={t("Share mitigated")} className="m2-num">{i.annual_risk > 0 ? pct1(i.mitigated / i.annual_risk) : dash}</td>
              <td data-label={t("Findings")} className="m2-num">{int(i.finding_count)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}

/* ---------------------------------------------------------------- sprints */

const HOURS = [16, 40, 80];

export function SprintPlanner() {
  const [hours, setHours] = useState(40);
  const q = useRead("sprints", () => getSprintPlan(hours), [hours]);
  const title = t("Sprint planner");
  return (
    <Section q={q} title={title} meta={t("The plan cut into sprints of a set length")} testId="fc-sprint-planner">
      {(d) => (<>
        <label className="m2-meta">
          {t("Hours in a sprint")}{" "}
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} data-testid="fc-sprint-hours">
            {HOURS.map((h) => <option key={h} value={h}>{int(h)}</option>)}
          </select>
        </label>
        {d.sprints.length === 0 ? <EmptyFrame>{t("No actions are waiting, so there is nothing to plan.")}</EmptyFrame> : (<>
          <p className="m2-meta">
            {t("{n} actions in {s} sprints", { n: int(d.total_actions), s: int(d.sprints.length) })}{" "}
            <Sparkline values={d.sprints.map((s) => s.dqs_projected)} label={t("Projected score after each sprint")} width={96} height={20} />
          </p>
          <Table title={title} head={[t("Sprint"), t("Actions"), t("Hours"), t("Records fixed"), t("Critical cleared"), t("Cost"), t("Score now"), t("Score after")]}>
            {d.sprints.map((s) => (
              <tr key={s.sprint_number}>
                <th scope="row" className="m2-card-lead">{int(s.sprint_number)}</th>
                <td data-label={t("Actions")} className="m2-num">{int(s.actions.length)}</td>
                <td data-label={t("Hours")} className="m2-num">{f1(s.total_effort_hours)}</td>
                <td data-label={t("Records fixed")} className="m2-num">{int(s.records_fixed)}</td>
                <td data-label={t("Critical cleared")} className="m2-num">{int(s.critical_cleared)}</td>
                <td data-label={t("Cost")} className="m2-num">{s.estimated_cost == null ? dash : money(s.estimated_cost, s.currency)}</td>
                <td data-label={t("Score now")} className="m2-num">{f1(s.dqs_now)}</td>
                <td data-label={t("Score after")} className="m2-num">{f1(s.dqs_projected)}</td>
              </tr>
            ))}
          </Table>
        </>)}
      </>)}
    </Section>
  );
}

/* ---------------------------------------------------------------- MDM health */

export function MdmHealthScorecard() {
  const q = useRead("mdm-health", () => getMdmHealthSeries(56));
  return (
    <Section q={q} title={t("Scorecard")} meta={t("The latest day against the last eight weeks")} testId="mdm-scorecard">
      {(d) => {
        const days = d.data;
        const last = days[days.length - 1];
        if (!last) return <EmptyFrame>{t("No daily health snapshot has been taken yet.")}</EmptyFrame>;
        const tiles: { label: string; value: string; series: (number | null)[]; scale: number }[] = [
          { label: t("Health score"), value: f1(last.mdm_health_score), series: days.map((x) => x.mdm_health_score), scale: 1 },
          { label: t("Golden record coverage"), value: last.golden_record_coverage_pct == null ? dash : pct1(last.golden_record_coverage_pct / 100), series: days.map((x) => x.golden_record_coverage_pct), scale: 1 },
          { label: t("Match confidence"), value: f1(last.avg_match_confidence), series: days.map((x) => x.avg_match_confidence), scale: 1 },
          { label: t("Steward SLA met"), value: last.steward_sla_compliance_pct == null ? dash : pct1(last.steward_sla_compliance_pct / 100), series: days.map((x) => x.steward_sla_compliance_pct), scale: 1 },
          { label: t("Source consistency"), value: last.source_consistency_pct == null ? dash : pct1(last.source_consistency_pct / 100), series: days.map((x) => x.source_consistency_pct), scale: 1 },
        ];
        const flags = (last.ai_risk_flags ?? []).map((x) => (typeof x === "string" ? x : JSON.stringify(x)));
        const projected = last.ai_projected_score != null || last.ai_narrative != null || flags.length > 0;
        return (<>
          <p className="m2-meta">{t("Snapshot of {day}", { day: formatDate(last.snapshot_date, "date") })}</p>
          <Table title={t("Scorecard")} head={[t("Measure"), t("Latest"), t("Trend")]}>
            {tiles.map((x) => (
              <tr key={x.label}>
                <th scope="row" className="m2-card-lead">{x.label}</th>
                <td data-label={t("Latest")} className="m2-num">{x.value}</td>
                <td data-label={t("Trend")}><Sparkline values={x.series} label={t("{name} over {n} days", { name: x.label, n: int(days.length) })} width={96} height={20} /></td>
              </tr>
            ))}
          </Table>
          {projected ? (
            <div data-testid="mdm-aletheia">
              <p>{t("Projected score")} <span className="m2-num">{f1(last.ai_projected_score)}</span></p>
              {last.ai_narrative ? <p>{last.ai_narrative}</p> : null}
              {flags.length > 0 ? <ul>{flags.map((f) => <li key={f}>{f}</li>)}</ul> : null}
            </div>
          ) : <p className="m2-meta" data-testid="mdm-aletheia">{t("The Aletheia projection is not available to your role or has not been computed.")}</p>}
        </>);
      }}
    </Section>
  );
}

/* ---------------------------------------------------------------- executive read */

export function ExecRead({ area }: { area: (l1: string | null) => string }) {
  const overview = useRead("overview", getOverview);
  const exec = useRead("exec", getExec);
  const owners = useRead("owners", getOwners);
  return (<>
    <Section q={overview} title={t("Executive read")} meta={t("The headline of the latest run")} testId="ins-exec">
      {(o) => !o.dqs ? <EmptyFrame>{t("No finished run has been read yet.")}</EmptyFrame> : (<>
        <Table title={t("Executive read")} head={[t("Measure"), t("Value"), t("Before")]}>
          <tr>
            <th scope="row" className="m2-card-lead">{t("Data quality score")}</th>
            <td data-label={t("Value")} className="m2-num">{f1(o.dqs.composite)}{o.dqs.tier ? <span className="m2-meta"> {labelOf(o.dqs.tier)}</span> : null}</td>
            <td data-label={t("Before")} className="m2-num">{f1(o.dqs.previous)}</td>
          </tr>
          {o.blockers ? (
            <tr>
              <th scope="row" className="m2-card-lead">{t("Migration blockers")}</th>
              <td data-label={t("Value")} className="m2-num">{int(o.blockers.count)}</td>
              <td data-label={t("Before")} className="m2-num">{o.blockers.previous == null ? dash : int(o.blockers.previous)}</td>
            </tr>
          ) : null}
          {o.auto_fixable ? (
            <tr>
              <th scope="row" className="m2-card-lead">{t("Records with a suggested fix")}</th>
              <td data-label={t("Value")} className="m2-num">{int(o.auto_fixable.records)} / {int(o.auto_fixable.failing_records)}</td>
              <td data-label={t("Before")} className="m2-num">{dash}</td>
            </tr>
          ) : null}
        </Table>
        {o.dqs.capped && o.dqs.cap_reason ? <p className="m2-meta">{t("The score is capped: {reason}", { reason: o.dqs.cap_reason })}</p> : null}
        {o.value_at_risk?.worst_l1 && o.value_at_risk.worst_l1_amount != null && o.value_at_risk.currency ? (
          <p>{t("Largest value at risk")}: {area(o.value_at_risk.worst_l1)} <span className="m2-num">{money(o.value_at_risk.worst_l1_amount, o.value_at_risk.currency)}</span></p>
        ) : null}
        {o.narrative ? <p>{o.narrative}</p> : null}
      </>)}
    </Section>
    <Section q={exec} title={t("Where the score loses points")} meta={t("Points lost per business area")} testId="ins-exec-waterfall">
      {(e) => e.waterfall.length === 0 ? <EmptyFrame>{t("No score has been broken down yet.")}</EmptyFrame> : (<>
        <CcHBars
          label={t("Points lost per business area")}
          testId="ins-exec-bars"
          rows={e.waterfall.map((w) => ({ key: w.x, label: w.l1 ? area(w.l1) : w.x, value: Math.abs(w.y), text: f1(w.y), tone: "warn" as const }))}
        />
        {e.narrative ? <p>{e.narrative}</p> : null}
      </>)}
    </Section>
    <Section q={owners} title={t("Owners")} meta={t("Each owner's score and the digest they get")} testId="ins-owners">
      {(d) => d.owners.length === 0 ? <EmptyFrame>{t("No owner has been named for a failing rule yet.")}</EmptyFrame> : (
        <Table title={t("Owners")} head={[t("Owner"), t("Score"), t("Change"), t("Open items"), t("Fixed"), t("Oldest item"), t("Digest")]}>
          {d.owners.map((o) => (
            <tr key={o.owner}>
              <th scope="row" className="m2-card-lead">{o.owner}</th>
              <td data-label={t("Score")} className="m2-num">{f1(o.score)}</td>
              <td data-label={t("Change")} className="m2-num">{f1(o.delta)}</td>
              <td data-label={t("Open items")} className="m2-num">{int(Object.values(o.open_by_severity).reduce((a, b) => a + b, 0))}</td>
              <td data-label={t("Fixed")} className="m2-num">{o.fixed_since_baseline == null ? dash : int(o.fixed_since_baseline)}</td>
              <td data-label={t("Oldest item")} className="m2-num">{o.oldest_item_age_days == null ? dash : t("{n} days", { n: int(o.oldest_item_age_days) })}</td>
              <td data-label={t("Digest")} className="m2-wrap">
                {o.schedule ?? dash}
                <div className="m2-meta">{o.last_sent ? t("Last sent {day}", { day: formatDate(o.last_sent, "date") }) : t("Not sent yet")}</div>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  </>);
}

/* ---------------------------------------------------------------- cleansing */

export function CleansingPipeline() {
  const q = useRead("cleansing", getCleansing);
  const rule = useRuleName();
  return (
    <Section q={q} title={t("Cleansing pipeline")} meta={t("From failing records to fixes applied")} testId="ins-cleansing">
      {(d) => d.steps.length === 0 ? <EmptyFrame>{t("No cleansing has started, because no run has failing records.")}</EmptyFrame> : (<>
        <CcHBars
          label={t("Records at each step")}
          testId="ins-cleansing-bars"
          rows={d.steps.map((s) => ({ key: s.key, label: s.label, value: s.records, text: int(s.records), tone: s.key === "applied" ? "pass" as const : "data" as const }))}
        />
        {d.by_module.length > 0 ? (
          <Table title={t("Cleansing by object")} head={[t("Object"), t("Failing"), t("Fix proposed"), t("High confidence")]}>
            {d.by_module.map((m) => (
              <tr key={m.module}>
                <th scope="row" className="m2-card-lead">{formatModuleName(m.module)}</th>
                <td data-label={t("Failing")} className="m2-num">{int(m.failing)}</td>
                <td data-label={t("Fix proposed")} className="m2-num">{int(m.proposed)}</td>
                <td data-label={t("High confidence")} className="m2-num">{int(m.high)}</td>
              </tr>
            ))}
          </Table>
        ) : null}
        {d.by_rule.length > 0 ? (
          <Table title={t("Cleansing by rule")} head={[t("Rule"), t("Fix proposed"), t("High confidence"), t("Automatic")]}>
            {d.by_rule.map((r) => (
              <tr key={r.check_id}>
                <th scope="row" className="m2-card-lead">{rule(r.check_id)}</th>
                <td data-label={t("Fix proposed")} className="m2-num">{int(r.proposed)}</td>
                <td data-label={t("High confidence")} className="m2-num">{int(r.high)}</td>
                <td data-label={t("Automatic")} className="m2-num">{int(r.auto)}</td>
              </tr>
            ))}
          </Table>
        ) : null}
      </>)}
    </Section>
  );
}

/* ---------------------------------------------------------------- duplicates */

/** The cluster around a golden record: its keys, the pairs with their match score, and the merge thresholds. */
export function DuplicateCluster({ object, recordId }: { object: string; recordId: string }) {
  const q = useRead("duplicates", () => getDuplicateCluster(object, recordId), [object, recordId]);
  if (q.isError && status(q.error) === 404) return null;
  const title = t("Duplicate cluster");
  return (
    <Section q={q} title={title} meta={t("Records that match this one and how closely")} testId="record-cluster">
      {(d) => d.edges.length === 0 ? <EmptyFrame>{t("No matching pair is recorded for this record.")}</EmptyFrame> : (<>
        <p className="m2-meta">{t("Merged automatically from {auto}, reviewed from {floor}", { auto: f1(d.thresholds.auto_merge), floor: f1(d.thresholds.review_floor) })}</p>
        <Table title={title} head={[t("Record"), t("Matches"), t("Match score")]}>
          {d.edges.map((e) => (
            <tr key={`${e.source}|${e.target}`}>
              <th scope="row" className="m2-card-lead"><Mono>{e.source}</Mono></th>
              <td data-label={t("Matches")}><Mono>{e.target}</Mono></td>
              <td data-label={t("Match score")} className="m2-num">{e.label || dash}</td>
            </tr>
          ))}
        </Table>
      </>)}
    </Section>
  );
}

/* ---------------------------------------------------------------- record sheet */

/**
 * The record read straight from the run's data (GET /objects/{object}/records/{key}), for a record the work queue has no
 * row for because it passes every rule. Shows the not-found text when the sheet is missing too.
 */
export function RecordSheetFallback({ object, recordKey, notFound }: { object: string; recordKey: string; notFound: string }) {
  const sheet = useRead("record-sheet", () => getRecordSheet(object, recordKey), [object, recordKey]);
  const found = useRead("record-findings", () => getRecordFindings(object, recordKey), [object, recordKey]);
  if (sheet.isPending) return null;
  if (sheet.isError || !sheet.data) return <EmptyFrame>{notFound}</EmptyFrame>;
  const rows = Object.entries(sheet.data.mara).filter(([, v]) => v !== null && v !== "");
  const failing = found.data?.failing ?? [];
  return (
    <div data-testid="record-sheet">
      <section className="m2-sec" aria-label={t("Record fields")}>
        <div className="m2-sechead"><h2 className="m2-h2">{t("Record fields")}</h2></div>
        {sheet.data.description ? <p className="m2-meta">{sheet.data.description}</p> : null}
        {rows.length === 0 ? <EmptyFrame>{t("The run holds no values for this record.")}</EmptyFrame> : (
          <dl className="m2-facts">
            {rows.map(([field, value]) => (
              <div className="m2-fact" key={field}>
                <dt>{describeField(field)} <Mono className="m2-fid">{sapField(field)}</Mono></dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      <section className="m2-sec" aria-label={t("Rules this record fails")}>
        <div className="m2-sechead"><h2 className="m2-h2">{t("Rules this record fails")}</h2></div>
        {failing.length === 0 ? <EmptyFrame>{t("No rule fails this record in this run.")}</EmptyFrame> : (
          <Table title={t("Rules this record fails")} head={[t("Rule"), t("Severity"), t("Field")]}>
            {failing.map((f) => (
              <tr key={f.check_id}>
                <th scope="row" className="m2-card-lead"><Mono>{f.check_id}</Mono> {f.message ?? ""}</th>
                <td data-label={t("Severity")}>{labelOf(f.severity)}</td>
                <td data-label={t("Field")}>{f.field ? <Mono>{f.field}</Mono> : dash}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}
