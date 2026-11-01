"use client";

import { DeltaBar } from "../charts";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/format";
import type { ChangeKind, CompareObject, CompareSummary } from "@/lib/api/v2/runs";
import { useOpenItem, useV2Href } from "@/lib/v2/hooks";
import { useCompareSummary, useTimeline, useVersionChanges } from "@/lib/v2/runs-queries";
import { f1, int, moduleSlug, pct1 } from "@/lib/v2/score";
import { useLandscape } from "@/lib/v2/queries";
import { systemSlug } from "@/lib/v2/score";
import { VerdictMark } from "../marks";
import { Coded, Dash, EmptyFrame, ErrorFrame, PageTitle, Skeleton, V2Link } from "../parts";
import { t as tr } from "@/lib/v2/i18n";
import { CcBanner, CcDelta, CcPage } from "./cc-parts";

const r1 = (n: number) => Math.round(n * 10) / 10;

/** "+1.2", "−0.4" (a true minus), "0.0": the sign always shown. */
export function signed(d: number | null): string {
  if (d == null) return "—";
  if (d === 0) return "0.0";
  return `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}`;
}

/** The change of the measured score between two runs, one decimal; null when either side did not measure it. */
export function measuredChange(o: Pick<CompareObject, "before" | "after">): number | null {
  const b = o.before?.raw_score;
  const a = o.after?.raw_score;
  return b == null || a == null ? null : r1(a - b);
}

/** The change bar of a compare row: the chart grammar's DeltaBar (design/v2/charts). */
export const DivergingBar = DeltaBar;

/** Every object's change in measured score as one diverging bar, the worst first, so what moved is seen before it is read. */
export function ObjectChangeBars({ S }: { S: CompareSummary }) {
  const rows = S.objects
    .map((o) => ({ key: o.module, label: o.label, delta: measuredChange(o) }))
    .sort((x, y) => (x.delta ?? 0) - (y.delta ?? 0))
    .map((r) => ({ ...r, text: r.delta == null ? "—" : tr("{n} points", { n: signed(r.delta) }) }));
  return <CcDelta rows={rows} label={tr("Change in score by object")} testId="compare-bars" />;
}

function Change({ d }: { d: number | null }) {
  return (
    <span className="m2-chg-v" data-testid="change">
      {d != null && d !== 0 ? <VerdictMark verdict={d > 0 ? "go" : "no-go"} /> : null}
      {signed(d)}
    </span>
  );
}

const GROUPS: { kind: ChangeKind; title: string }[] = [
  { kind: "newly_failing", get title() { return tr("Newly failing rules"); } },
  { kind: "fixed", get title() { return tr("Fixed rules"); } },
  { kind: "worse", get title() { return tr("Worse"); } },
  { kind: "better", get title() { return tr("Better"); } },
];
const SHOWN = 5;

function WhatChanged({ a, b, totals, labelOf }: { a: string; b: string; totals: Record<ChangeKind, number>; labelOf: (m: string) => string }) {
  const q = useVersionChanges(a, b);
  const { hrefFor } = useOpenItem();
  const [all, setAll] = useState<Partial<Record<ChangeKind, boolean>>>({});
  return (
    <section className="m2-sec" aria-label={tr("What changed")}>
      <div className="m2-sechead">
        <h2 className="m2-h2">{tr("What changed")}</h2>
        <span className="m2-sub">{tr("Rule counts match the table above")}</span>
      </div>
      {q.isLoading ? (
        <Skeleton width="100%" height={160} />
      ) : q.isError || !q.data ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{tr("The rules that changed could not be read.")}</ErrorFrame>
      ) : (
        <div className="m2-cchg" data-testid="what-changed">
          {GROUPS.map(({ kind, title }) => {
            const list = q.data.checks[kind] ?? [];
            const open = all[kind] ?? false;
            const shown = open ? list : list.slice(0, SHOWN);
            const rest = Math.max(0, totals[kind] - shown.length);
            return (
              <div key={kind} data-kind={kind}>
                <h3>
                  <span>{title}</span>
                  <span className="m2-n">{int(totals[kind])}</span>
                </h3>
                {shown.length === 0 ? (
                  <p className="m2-meta">None.</p>
                ) : (
                  <ul>
                    {shown.map((c) => (
                      <li key={c.check_id}>
                        <span>
                          <V2Link href={hrefFor({ kind: "rule", id: c.check_id })}>
                            <Coded code={c.check_id} text={c.message} />
                          </V2Link>
                        </span>
                        <span className="m2-s">{tr("{module}, {v1_affected} to {v2_affected} records failing", { module: labelOf(c.module), v1_affected: int(c.v1_affected), v2_affected: int(c.v2_affected) })}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {rest > 0 ? (
                  <div className="m2-more">
                    <button type="button" className="m2-linkbtn" onClick={() => setAll((s) => ({ ...s, [kind]: true }))}>
                      {tr("and {rest} more", { rest: int(rest) })}
                    </button>
                  </div>
                ) : open && list.length > SHOWN ? (
                  <div className="m2-more">
                    <button type="button" className="m2-linkbtn" onClick={() => setAll((s) => ({ ...s, [kind]: false }))}>
                      {tr("Show fewer")}
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * `/run/{a}/vs/{b}`: run b (after) against run a (before). One sentence, a row per object with the measured score
 * before and after, the change, the shown score and the rules that moved; a totals row that adds up the rows; the
 * method in one line; and the lists of rules behind the counts, each a link to the rule inspector.
 */
export function CompareCanvas({ a, b }: { a: string; b: string }) {
  const router = useRouter();
  const v2Href = useV2Href();
  const sum = useCompareSummary(a, b);
  const timeline = useTimeline(null, 50);
  const land = useLandscape(null);
  const runs = timeline.data?.runs ?? [];
  const S = sum.data;
  const rows = useMemo(() => (S?.objects ?? []).map((o) => ({ o, d: measuredChange(o) })), [S]);
  const labelOf = (m: string) => land.data?.objects.find((o) => o.module === m)?.label ?? S?.objects.find((o) => o.module === m)?.label ?? m;
  const sysId = runs.find((r) => r.id === b)?.system_id ?? null;
  const systemName = land.data?.systems.find((x) => x.id === sysId)?.name ?? land.data?.systems[0]?.name ?? "";
  const baselineA = runs.find((r) => r.id === a)?.baseline ?? false;

  const swapTo = (nextA: string, nextB: string) => router.push(v2Href(`/run/${nextA}/vs/${nextB}`));
  const options = [...runs].reverse();

  if (sum.isError) {
    return (
      <CcPage>
        <PageTitle>{tr("Compare runs")}</PageTitle>
        <div className="m2-sec">
          <ErrorFrame onRetry={() => void sum.refetch()}>{tr("These two runs could not be compared. Both must exist and belong to the same system.")}</ErrorFrame>
        </div>
      </CcPage>
    );
  }

  const up = rows.filter((r) => r.d != null && r.d > 0).length;
  const dn = rows.filter((r) => r.d != null && r.d < 0).length;
  const held = (S?.objects ?? []).filter((o) => o.after?.capped).length;
  const t = S?.totals;
  const title = S ? tr("Run {run_at} vs {value}{run_at2}", { run_at: formatDate(S.b.run_at, "datetime"), value: baselineA ? "baseline " : "", run_at2: formatDate(S.a.run_at, "date") }) : tr("Compare runs");

  const verdict = up >= dn && (t?.newly_failing ?? 0) === 0 ? "go" : up > dn ? "at-risk" : "no-go";
  return (
    <CcPage>
      <PageTitle>{title}</PageTitle>
      {S && t ? (
        <>
          <CcBanner
            testId="compare-banner"
            label={tr("What changed")}
            eyebrow={tr("Compared with {run_at}", { run_at: formatDate(S.a.run_at, "date") })}
            verdict={verdict}
            headline={up > dn ? tr("Data quality improved") : up < dn ? tr("Data quality got worse") : tr("Data quality is about the same")}
            why={
              <span data-testid="compare-sentence">
                {tr("{up} of {rowsCount} objects scored higher and {dn} lower. {newly_failing} rules started failing and {fixed} stopped.", { up, rowsCount: rows.length, dn, newly_failing: int(t.newly_failing), fixed: int(t.fixed) })}
                {held > 0 ? tr(" {held} {held, plural, one {object is} other {objects are}} held down by a critical rule, so the score shown hides part of the problem.", { held }) : ""}
              </span>
            }
            figs={[
              { label: tr("Rules newly failing"), value: int(t.newly_failing), note: tr("{n} stopped failing", { n: int(t.fixed) }) },
              { label: tr("Objects higher"), value: int(up), note: tr("of {n}", { n: int(rows.length) }) },
              { label: tr("Objects lower"), value: int(dn), note: tr("of {n}", { n: int(rows.length) }) },
            ]}
            action={
              <V2Link href={`/run/${b}`} className="m2-btn m2-next">
                {tr("Open run details")}
              </V2Link>
            }
          />
          <p className="m2-prov" data-testid="compare-method">
            {S.method}{" "}{tr("Coverage is the share of records a rule could evaluate.")}
          </p>
          <section className="m2-cc-card" aria-label={tr("Change in score by object")}>
            <h3>{tr("Change in score by object")}</h3>
            <ObjectChangeBars S={S} />
          </section>
        </>
      ) : (
        <Skeleton width={520} height={16} />
      )}
      <div className="m2-cta">
        {options.length > 1 ? (
          <span className="m2-pop-cmp">
            <label htmlFor="cmp-from" className="m2-meta">
              {tr("Compare")}
            </label>
            <select id="cmp-from" className="m2-sel" aria-label={tr("From run")} value={a} onChange={(e) => swapTo(e.target.value, b)}>
              {options.map((r) => (
                <option key={r.id} value={r.id}>
                  {formatDate(r.run_at, "datetime")}
                </option>
              ))}
            </select>
            <label htmlFor="cmp-to" className="m2-meta">
              {tr("with")}
            </label>
            <select id="cmp-to" className="m2-sel" aria-label={tr("To run")} value={b} onChange={(e) => swapTo(a, e.target.value)}>
              {options.map((r) => (
                <option key={r.id} value={r.id}>
                  {formatDate(r.run_at, "datetime")}
                </option>
              ))}
            </select>
          </span>
        ) : null}
      </div>

      <section className="m2-sec" aria-label={tr("By object")}>
        <div className="m2-sechead">
          <h2 className="m2-h2">{tr("By object")}</h2>
          <span className="m2-sub">{tr("Measured score, then the score shown after the cap")}</span>
        </div>
        {!S ? (
          <Skeleton width="100%" height={200} />
        ) : rows.length === 0 ? (
          <EmptyFrame>{tr("Neither run scored an object, so there is nothing to compare.")}</EmptyFrame>
        ) : (
          <>
            <div className="m2-frame m2-only-wide">
              <table className="m2-tbl" data-testid="compare-table" style={{ minWidth: 960 }}>
                <thead>
                  <tr>
                    <th scope="col">{tr("Object")}</th>
                    <th scope="col" className="m2-r">
                      {tr("Measured")}
                    </th>
                    <th scope="col" style={{ width: 120 }}>
                      {tr("Change")}
                    </th>
                    <th scope="col" className="m2-r">
                      <span className="m2-sr">{tr("Change in points")}</span>
                    </th>
                    <th scope="col" className="m2-r">
                      {tr("Shown")}
                    </th>
                    <th scope="col" className="m2-r">
                      {tr("Records checked")}
                    </th>
                    <th scope="col" className="m2-r">
                      {tr("Coverage")}
                    </th>
                    <th scope="col" className="m2-r" title={tr("Rules newly failing")}>
                      {tr("New")}
                    </th>
                    <th scope="col" className="m2-r" title={tr("Rules fixed")}>
                      {tr("Fixed")}
                    </th>
                    <th scope="col" className="m2-r" title={tr("Rules with more failing rows")}>
                      {tr("Worse")}
                    </th>
                    <th scope="col" className="m2-r" title={tr("Rules with fewer failing rows")}>
                      {tr("Better")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ o, d }) => (
                    <tr key={o.module} data-testid="compare-row">
                      <th scope="row">
                        <V2Link href={`/o/${systemSlug(systemName)}/${moduleSlug(o.module)}?run=${b}`}>{o.label}</V2Link>
                      </th>
                      <td className="m2-r">
                        {f1(o.before?.raw_score)} <span className="m2-u">{tr("to")}</span> {f1(o.after?.raw_score)}
                      </td>
                      <td>
                        <DivergingBar d={d} />
                      </td>
                      <td className={`m2-r ${d != null && d > 0 ? "m2-up" : d != null && d < 0 ? "m2-dn" : ""}`}>
                        <Change d={d} />
                      </td>
                      <td className="m2-r">
                        {f1(o.before?.score)} <span className="m2-u">{tr("to")}</span> {f1(o.after?.score)}
                      </td>
                      <td className="m2-r">
                        {o.before?.records_checked == null && o.after?.records_checked == null ? (
                          <Dash />
                        ) : (
                          <>
                            {int(o.before?.records_checked)} <span className="m2-u">{tr("to")}</span> {int(o.after?.records_checked)}
                          </>
                        )}
                      </td>
                      <td className="m2-r">{pct1(o.after?.coverage)}</td>
                      <td className="m2-r">{o.newly_failing}</td>
                      <td className="m2-r">{o.fixed}</td>
                      <td className="m2-r">{o.worse}</td>
                      <td className="m2-r">{o.better}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr data-testid="compare-totals">
                    <th scope="row">{tr("All {rowsCount} objects", { rowsCount: rows.length })}</th>
                    <td />
                    <td />
                    <td />
                    <td />
                    <td className="m2-r">
                      {int(t?.records_checked_before)} <span className="m2-u">{tr("to")}</span> {int(t?.records_checked_after)}
                    </td>
                    <td />
                    <td className="m2-r">{int(t?.newly_failing)}</td>
                    <td className="m2-r">{int(t?.fixed)}</td>
                    <td className="m2-r">{int(t?.worse)}</td>
                    <td className="m2-r">{int(t?.better)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="m2-only-narrow" data-testid="compare-list">
              {rows.map(({ o, d }) => (
                <V2Link key={o.module} href={`/o/${systemSlug(systemName)}/${moduleSlug(o.module)}?run=${b}`} className="m2-lrow" style={{ gridTemplateColumns: "1fr auto" }}>
                  <div className="m2-nm" style={{ gridColumn: 1 }}>
                    {o.label}
                  </div>
                  <div style={{ gridColumn: 2, display: "flex", gap: "var(--m2-s2)", alignItems: "center" }}>
                    <DivergingBar d={d} width={72} scale={12} />
                    <Change d={d} />
                  </div>
                  <div className="m2-c">
                    {tr("{raw_score} to {raw_score2} measured, shown {score} to {score2}, {records_checked} to {records_checked2} records checked. {newly_failing} new, {fixed} fixed, {worse} worse, {better} better.", { raw_score: f1(o.before?.raw_score), raw_score2: f1(o.after?.raw_score), score: f1(o.before?.score), score2: f1(o.after?.score), records_checked: int(o.before?.records_checked), records_checked2: int(o.after?.records_checked), newly_failing: o.newly_failing, fixed: o.fixed, worse: o.worse, better: o.better })}
                  </div>
                </V2Link>
              ))}
              <p className="m2-prov" data-testid="compare-list-totals">{tr("All {rowsCount} objects: {newly_failing} new, {fixed} fixed, {worse} worse, {better} better.", { rowsCount: rows.length, newly_failing: int(t?.newly_failing), fixed: int(t?.fixed), worse: int(t?.worse), better: int(t?.better) })}</p>
            </div>
          </>
        )}
      </section>

      {S && t ? (
        <WhatChanged
          a={a}
          b={b}
          totals={{ newly_failing: t.newly_failing, fixed: t.fixed, worse: t.worse, better: t.better }}
          labelOf={labelOf}
        />
      ) : null}
    </CcPage>
  );
}
