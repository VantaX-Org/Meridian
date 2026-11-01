"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getValue, type ImpactCategory, type Value as ValueData } from "@/lib/api/v2/analytics";
import { getGuards, getLineageModel, type GuardStep } from "@/lib/api/v2/lineage";
import { money } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { f1, int } from "@/lib/v2/score";
import { Sparkline } from "../charts";
import { EmptyFrame, ErrorFrame, Mono, Skeleton } from "../parts";
import { CcBanner, CcPage } from "./cc-parts";
import { pctOf, retry, Section, status, Table } from "./WorkAnalytics";

/**
 * Value delivered: the latest finished run priced into eight kinds of business loss from the tenant cost model, the
 * share Meridian's fixes take off each, and the return against the subscription (api/routes/analytics.py /roi).
 * Every amount is the backend's; with no subscription in the cost model the multiple and payback show as a dash.
 */

const CATEGORY: Record<string, { name: () => string; what: () => string }> = {
  duplicate_payment: { name: () => t("Duplicate payments"), what: () => t("Records failing a uniqueness rule, priced as payments made twice") },
  warranty_miss: { name: () => t("Missed warranty claims"), what: () => t("Warranty and expiry dates left blank, priced as claims never made") },
  compliance_penalty: { name: () => t("Compliance penalties"), what: () => t("Tax, VAT and regulatory fields that fail, priced as fines") },
  inventory_write_off: { name: () => t("Inventory write-offs"), what: () => t("Incomplete material records, priced as stock written off") },
  blocked_invoice: { name: () => t("Blocked invoices"), what: () => t("Invoices blocked by bad master data, priced per invoice") },
  failed_posting: { name: () => t("Failed postings"), what: () => t("Documents that failed to post, priced per posting") },
  contract_violation: { name: () => t("Contract violations"), what: () => t("Orders that broke a contract term, priced per breach") },
  labour_displacement: { name: () => t("Steward time saved"), what: () => t("Items fixed automatically, priced as the steward hours they saved") },
};

const empty: ValueData = { roi: { subscription_annual: null, risk_mitigated: 0, roi_multiple: null, payback_months: null, currency: "" }, impacts: [], cost_avoidance_history: [] };

export function Value() {
  const fixture = useFixture();
  const q = useQuery({
    queryKey: ["value", fixture],
    queryFn: async () => {
      try {
        return await getValue();
      } catch (e) {
        if (status(e) === 404) return empty;
        throw e;
      }
    },
    staleTime: 60_000,
    retry,
  });

  if (q.isPending) return <CcPage><Skeleton width="100%" height={320} /></CcPage>;
  if (q.isError) {
    return (
      <CcPage>
        {status(q.error) === 403 ? (
          <EmptyFrame>{t("Your role cannot read the value delivered.")}</EmptyFrame>
        ) : (
          <ErrorFrame onRetry={() => void q.refetch()}>{t("The value delivered could not be read.")}</ErrorFrame>
        )}
      </CcPage>
    );
  }
  const { roi, impacts, cost_avoidance_history: months } = q.data;
  const cur = roi.currency;
  const risk = impacts.reduce((s, i) => s + i.annual_risk, 0);
  const noSub = roi.subscription_annual == null;
  const headline = !impacts.some((i) => i.finding_count)
    ? t("No priced loss in the latest run")
    : roi.roi_multiple == null
      ? t("{amount} a year taken off the risk", { amount: money(roi.risk_mitigated, cur) })
      : t("Returns {n} times its cost", { n: f1(roi.roi_multiple) });
  return (
    <CcPage>
      <CcBanner
        eyebrow={t("Value delivered")}
        verdict={roi.roi_multiple == null ? undefined : roi.roi_multiple >= 1 ? "go" : "at-risk"}
        headline={headline}
        why={t("The latest finished run is priced with your cost model: each failing record carries the unit cost of the loss it can cause, and the mitigation share is what fixing it removes.")}
        figs={[
          { label: t("Annual risk found"), value: money(risk, cur) },
          { label: t("Risk mitigated a year"), value: money(roi.risk_mitigated, cur) },
          { label: t("Return on the subscription"), value: roi.roi_multiple == null ? f1(null) : t("{n} times", { n: f1(roi.roi_multiple) }), note: noSub ? t("subscription cost is not set") : undefined },
          { label: t("Payback"), value: roi.payback_months == null ? f1(null) : t("{n} months", { n: f1(roi.payback_months) }), note: noSub ? undefined : t("on {amount} a year", { amount: money(roi.subscription_annual ?? 0, cur) }) },
        ]}
        testId="val-banner"
        label={t("Value delivered")}
      />
      <ImpactPanel rows={impacts} />
      <MonthsPanel rows={months} currency={cur} />
      <GuardsPanel />
    </CcPage>
  );
}

function ImpactPanel({ rows }: { rows: ImpactCategory[] }) {
  const title = t("Where the risk sits");
  const sorted = [...rows].sort((a, b) => b.annual_risk - a.annual_risk);
  const q = { isPending: false, isError: false, error: null, data: sorted, refetch: () => undefined };
  return (
    <Section q={q} title={title} meta={t("Each kind of loss, priced from the latest run")} testId="val-impact">
      {(d) => d.length === 0 ? <EmptyFrame>{t("No finished run has been priced yet.")}</EmptyFrame> : (
        <Table title={title} head={[t("Loss"), t("What counts"), t("Sources"), t("Annual risk"), t("Mitigated"), t("How it is priced")]}>
          {d.map((i) => {
            const c = CATEGORY[i.category];
            return (
              <tr key={i.category}>
                <th scope="row" className="m2-card-lead">{c ? c.name() : i.category}</th>
                <td data-label={t("What counts")}>{c ? c.what() : f1(null)}</td>
                <td data-label={t("Sources")} className="m2-num">{int(i.finding_count)}</td>
                <td data-label={t("Annual risk")} className="m2-num">{money(i.annual_risk, i.currency)}</td>
                <td data-label={t("Mitigated")} className="m2-num">{money(i.mitigated, i.currency)}</td>
                <td data-label={t("How it is priced")} className="m2-meta">{i.calculation_method}</td>
              </tr>
            );
          })}
        </Table>
      )}
    </Section>
  );
}

function MonthsPanel({ rows, currency }: { rows: ValueData["cost_avoidance_history"]; currency: string }) {
  const title = t("Cost avoided month by month");
  const asc = [...rows].sort((a, b) => a.period.localeCompare(b.period));
  const q = { isPending: false, isError: false, error: null, data: asc, refetch: () => undefined };
  return (
    <Section q={q} title={title} meta={t("Recorded by the monthly report, newest first")} testId="val-months">
      {(d) => d.length === 0 ? <EmptyFrame>{t("No month has been recorded yet. The monthly report records one on the first of each month.")}</EmptyFrame> : (
        <>
          {d.length > 1 ? <Sparkline values={d.map((m) => m.risk_mitigated_zar)} label={t("Risk mitigated over the last {n} months", { n: int(d.length) })} width={240} height={32} /> : null}
          <Table title={title} head={[t("Month"), t("Subscription"), t("Risk mitigated"), t("Return to date")]}>
            {[...d].reverse().map((m) => (
              <tr key={m.period}>
                <th scope="row" className="m2-card-lead">{m.period}</th>
                <td data-label={t("Subscription")} className="m2-num">{money(m.subscription_cost_zar, currency)}</td>
                <td data-label={t("Risk mitigated")} className="m2-num">{money(m.risk_mitigated_zar, currency)}</td>
                <td data-label={t("Return to date")} className="m2-num">{m.cumulative_roi_multiple == null ? f1(null) : t("{n} times", { n: f1(m.cumulative_roi_multiple) })}</td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </Section>
  );
}

/** Steps no rule guards first, then the weakest guard, so the exposed step heads the list. */
const exposure = (a: GuardStep, b: GuardStep) =>
  Number(b.guard_count === 0) - Number(a.guard_count === 0) || (a.min_pass_rate ?? 101) - (b.min_pass_rate ?? 101);

/**
 * Rules guarding a KPI or process: every process step the lineage model puts behind it, the rules reading its fields,
 * the weakest of their latest pass rates and the fields no rule reads (api/routes/lineage.py /guards).
 */
function GuardsPanel() {
  const f = useFixture();
  const model = useQuery({ queryKey: ["v2", "lineage", "model", f], queryFn: getLineageModel, staleTime: 300_000, retry });
  const [pick, setPick] = useState<string | null>(null);
  const node = pick ?? model.data?.kpis[0]?.id ?? null;
  const q = useQuery({ queryKey: ["v2", "lineage", "guards", f, node], queryFn: () => getGuards(node as string), enabled: node !== null, staleTime: 60_000, retry });
  const title = t("Rules guarding each KPI");
  const l1 = (model.data?.processes ?? []).filter((p) => !p.id.includes("-"));
  return (
    <Section q={model} title={title} meta={t("Every process step behind a KPI or process, with the rules that read its fields")} testId="val-guards">
      {(m) => m.kpis.length + l1.length === 0 ? <EmptyFrame>{t("The lineage model maps no KPI or process.")}</EmptyFrame> : (
        <>
          <label className="m2-meta">
            {t("KPI or process")}{" "}
            <select className="m2-sel" value={node ?? ""} onChange={(e) => setPick(e.target.value)}>
              <optgroup label={t("KPIs")}>{m.kpis.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}</optgroup>
              <optgroup label={t("Processes")}>{l1.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>
            </select>
          </label>
          {q.isPending ? <Skeleton width="100%" height={120} /> : q.isError ? (
            <ErrorFrame onRetry={() => void q.refetch()}>{t("The rules guarding this KPI could not be read.")}</ErrorFrame>
          ) : q.data.steps.length === 0 ? <EmptyFrame>{t("The lineage model puts no process step behind this KPI.")}</EmptyFrame> : (
            <>
              <p className="m2-meta" data-testid="val-guards-sum">
                {q.data.coverage_gaps.length
                  ? t("{gaps, plural, one {# step has} other {# steps have}} no rule guarding {n, plural, one {it} other {them}}, of {total}.", { gaps: q.data.coverage_gaps.length, n: q.data.coverage_gaps.length, total: q.data.steps.length })
                  : t("Every one of the {n, plural, one {# step} other {# steps}} has a rule guarding it.", { n: q.data.steps.length })}
              </p>
              <Table title={title} head={[t("Process step"), t("Transaction"), t("Rules"), t("Weakest pass rate"), t("Fields no rule reads")]}>
                {[...q.data.steps].sort(exposure).map((s) => (
                  <tr key={s.id} data-gap={s.guard_count === 0 ? "true" : undefined}>
                    <th scope="row" className="m2-card-lead">{s.label}{s.l2 ? <> <span className="m2-meta"><Mono>{s.l2}</Mono></span></> : null}</th>
                    <td data-label={t("Transaction")}>{s.tcode ? <Mono>{s.tcode}</Mono> : f1(null)}</td>
                    <td data-label={t("Rules")} className="m2-num">{s.guard_count ? int(s.guard_count) : t("None")}</td>
                    <td data-label={t("Weakest pass rate")} className="m2-num">{pctOf(s.min_pass_rate)}</td>
                    <td data-label={t("Fields no rule reads")}>{s.unguarded_fields.length ? <Mono>{s.unguarded_fields.join(", ")}</Mono> : t("None")}</td>
                  </tr>
                ))}
              </Table>
            </>
          )}
        </>
      )}
    </Section>
  );
}
