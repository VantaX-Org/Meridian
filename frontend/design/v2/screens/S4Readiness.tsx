"use client";

import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getS4Readiness, type S4Area, type S4Readiness as S4Data, type S4Status } from "@/lib/api/v2/s4";
import { t } from "@/lib/v2/i18n";
import { f1, int } from "@/lib/v2/score";
import { DqWord } from "../inspector/step";
import { EmptyFrame, ErrorFrame, Skeleton } from "../parts";
import { CcBanner, CcHBars, CcPage } from "./cc-parts";
import { pctOf, retry, Section, status, Table, useRuleName } from "./WorkAnalytics";

/**
 * S/4HANA readiness: the conversion-readiness pack rolled up per SAP simplification area over every object at its
 * latest run (api/services/s4_readiness.py). A failing blocking rule makes its area red; an area none of whose rules
 * ran shows as not measured, never as ready.
 */

const RANK: Record<S4Status, number> = { red: 0, amber: 1, green: 2, not_evaluated: 3 };

const empty: S4Data = {
  version_id: null, status: "not_evaluated", ready: false, rules: 0, evaluated: 0, failing: 0, failing_records: 0,
  blocking_failing: 0, warning_failing: 0, areas: [],
};

function Word({ s }: { s: S4Status }) {
  return s === "not_evaluated" ? <span className="m2-meta">{t("Not measured")}</span> : <DqWord status={s} />;
}

export function S4Readiness() {
  const fixture = useFixture();
  const q = useQuery({
    queryKey: ["s4-readiness", fixture],
    queryFn: async () => {
      try {
        return await getS4Readiness();
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
          <EmptyFrame>{t("Your role cannot read the S/4HANA readiness.")}</EmptyFrame>
        ) : (
          <ErrorFrame onRetry={() => void q.refetch()}>{t("The S/4HANA readiness could not be read.")}</ErrorFrame>
        )}
      </CcPage>
    );
  }
  const d = q.data;
  const measured = d.areas.filter((a) => a.status !== "not_evaluated");
  const headline = d.evaluated === 0
    ? t("Nothing measured yet")
    : d.ready
      ? t("Ready to convert")
      : t("{n} blocking rules stand in the way", { n: int(d.blocking_failing) });
  return (
    <CcPage>
      <CcBanner
        eyebrow={t("S/4HANA readiness")}
        verdict={d.evaluated === 0 ? undefined : d.ready ? (d.warning_failing ? "at-risk" : "go") : "no-go"}
        headline={headline}
        why={t("The conversion-readiness rules are grouped by SAP simplification area. A failing blocking rule stops the conversion; a failing warning rule needs cleansing but does not stop it.")}
        figs={[
          { label: t("Areas ready"), value: t("{a} of {b}", { a: int(measured.filter((a) => a.status === "green").length), b: int(measured.length) }), note: d.areas.length > measured.length ? t("{n} not measured", { n: int(d.areas.length - measured.length) }) : undefined },
          { label: t("Blocking rules failing"), value: int(d.blocking_failing) },
          { label: t("Warning rules failing"), value: int(d.warning_failing) },
          { label: t("Records to fix"), value: int(d.failing_records) },
        ]}
        testId="s4-banner"
        label={t("S/4HANA readiness")}
      />
      <AreaPanel rows={d.areas} />
      <BlockerPanel rows={d.areas} />
    </CcPage>
  );
}

function AreaPanel({ rows }: { rows: S4Area[] }) {
  const title = t("Simplification areas");
  const sorted = [...rows].sort((a, b) => RANK[a.status] - RANK[b.status] || b.failing_records - a.failing_records);
  const q = { isPending: false, isError: false, error: null, data: sorted, refetch: () => undefined };
  return (
    <Section q={q} title={title} meta={t("Worst first, each with the SAP simplification item it answers")} testId="s4-areas">
      {(d) => d.length === 0 ? <EmptyFrame>{t("No conversion-readiness rule has run yet.")}</EmptyFrame> : (<>
        {d.some((a) => a.failing_records > 0) ? (
          <CcHBars
            label={t("Records to fix by area")}
            testId="s4-area-bars"
            rows={d.filter((a) => a.status !== "not_evaluated").map((a) => ({
              key: a.area, label: a.label, value: a.failing_records, text: int(a.failing_records),
              tone: a.status === "red" ? "crit" : a.status === "amber" ? "warn" : "pass",
            }))}
          />
        ) : null}
        <Table title={title} head={[t("Area"), t("Simplification item"), t("Status"), t("Rules run"), t("Blocking"), t("Warnings"), t("Records to fix")]}>
          {d.map((a) => (
            <tr key={a.area}>
              <th scope="row" className="m2-card-lead">{a.label}</th>
              <td data-label={t("Simplification item")} className="m2-meta m2-wrap">{a.simplification_item ?? f1(null)}</td>
              <td data-label={t("Status")}><Word s={a.status} /></td>
              <td data-label={t("Rules run")} className="m2-num">{t("{a} of {b}", { a: int(a.evaluated), b: int(a.rules) })}</td>
              <td data-label={t("Blocking")} className="m2-num">{int(a.blocking_failing)}</td>
              <td data-label={t("Warnings")} className="m2-num">{int(a.warning_failing)}</td>
              <td data-label={t("Records to fix")} className="m2-num">{int(a.failing_records)}</td>
            </tr>
          ))}
        </Table>
      </>)}
    </Section>
  );
}

function BlockerPanel({ rows }: { rows: S4Area[] }) {
  const title = t("What stands in the way");
  const rule = useRuleName();
  const failing = rows
    .flatMap((a) => a.checks.filter((c) => c.status === "red" || c.status === "amber").map((c) => ({ ...c, label: a.label })))
    .sort((a, b) => (a.impact === b.impact ? 0 : a.impact === "blocking" ? -1 : 1) || b.affected_count - a.affected_count);
  const q = { isPending: false, isError: false, error: null, data: failing, refetch: () => undefined };
  return (
    <Section q={q} title={title} meta={t("Failing rules, blocking first, then by records affected")} testId="s4-blockers">
      {(d) => d.length === 0 ? <EmptyFrame>{t("No conversion-readiness rule is failing.")}</EmptyFrame> : (
        <Table title={title} head={[t("Rule"), t("Area"), t("Impact"), t("Records"), t("Pass rate")]}>
          {d.map((c) => (
            <tr key={`${c.label}:${c.check_id}`}>
              <th scope="row" className="m2-card-lead">{rule(c.check_id)}</th>
              <td data-label={t("Area")}>{c.label}</td>
              <td data-label={t("Impact")}>{c.impact === "blocking" ? t("Blocks the conversion") : t("Needs cleansing")}</td>
              <td data-label={t("Records")} className="m2-num">{int(c.affected_count)}</td>
              <td data-label={t("Pass rate")} className="m2-num">{pctOf(c.pass_rate)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Section>
  );
}
