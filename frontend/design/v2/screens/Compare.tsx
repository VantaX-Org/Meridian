"use client";

import { DeltaBar } from "../charts";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/format";
import type { ChangeKind, CompareObject, CompareSummary } from "@/lib/api/v2/runs";
import { useOpenItem, useUrlParam, useV2Href } from "@/lib/v2/hooks";
import { runLabel } from "@/lib/v2/run-label";
import { useCompareSummary, useTimeline, useVersionChanges, useVersionHead } from "@/lib/v2/runs-queries";
import { f1, int, moduleSlug, pct1 } from "@/lib/v2/score";
import { useLandscape } from "@/lib/v2/queries";
import { systemSlug } from "@/lib/v2/score";
import { VerdictMark } from "../marks";
import { RunChip } from "../RunChip";
import { Lede, PrimaryAction } from "../RunParts";
import { Coded, Dash, EmptyFrame, ErrorFrame, PageTitle, Skeleton, V2Link } from "../parts";
import { t as tr } from "@/lib/v2/i18n";
import { CcBanner, CcDelta, CcPage } from "./cc-parts";
import { CompareRecords } from "./CompareRecords";
import { ScoreDeltaPanel } from "./ScoreDeltaPanel";
import { TableExport } from "@/design/v2/TableExport";

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

/** Objects up and down, counted from the measured scores as the bars are, so the sentence and the chart agree. */
export function changeCounts(S: CompareSummary): { up: number; dn: number } {
  const deltas = S.objects.map(measuredChange);
  return { up: deltas.filter((d) => d != null && d > 0).length, dn: deltas.filter((d) => d != null && d < 0).length };
}

/** The one sentence a run gives about the run before it. */
export function changeSentence(S: CompareSummary): string {
  const { up, dn } = changeCounts(S);
  return tr("{up} {up, plural, one {object scored} other {objects scored}} higher and {dn} lower. {newly} rules started failing and {fixed} stopped.", { up, dn, newly: int(S.totals.newly_failing), fixed: int(S.totals.fixed) });
}

/** Run numbers restart per system, so two runs compare only within one system. An unknown system is not refused. This is the only guard: GET /versions/compare accepts any two runs of the tenant. */
export function sameSystem(a: string | null | undefined, b: string | null | undefined): boolean {
  return !a || !b || a === b;
}

/** The object that lost the most, the one "Open what got worse" lands on; null when no object scored lower. */
export function worstObject(S: CompareSummary): CompareObject | null {
  let worst: CompareObject | null = null;
  let low = 0;
  for (const o of S.objects) {
    const d = measuredChange(o);
    if (d != null && d < low) {
      low = d;
      worst = o;
    }
  }
  return worst;
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
                  <p className="m2-meta">{tr("None.")}</p>
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
 * `/run/{a}/vs/{b}`: run b (after) against run a (before), both of one system. Both run chips, one sentence, the one next
 * step, a row per object, and the rules and the records behind the counts on two tabs. Two runs of different systems are
 * refused before any figure is drawn.
 *
 * The table has no Verified column: CompareObject carries no per-object verified figure (Verified exists per run only),
 * so it shows the measured score. "Open what got worse" opens Work as of run b for the system and the object that lost
 * the most: Work has no filter for "new in run b" yet, so the list is everything open then, not only what is new.
 */
export function CompareCanvas({ a, b }: { a: string; b: string }) {
  const router = useRouter();
  const v2Href = useV2Href();
  const sum = useCompareSummary(a, b);
  const headA = useVersionHead(a);
  const headB = useVersionHead(b);
  const timeline = useTimeline(null, 50);
  const land = useLandscape(null);
  const [view] = useUrlParam("view", "changes", ["changes", "records"] as const);
  const runs = timeline.data?.runs ?? [];
  const S = sum.data;
  const rows = useMemo(() => (S?.objects ?? []).map((o) => ({ o, d: measuredChange(o) })), [S]);
  const labelOf = (m: string) => land.data?.objects.find((o) => o.module === m)?.label ?? S?.objects.find((o) => o.module === m)?.label ?? m;
  const metaA = runs.find((r) => r.id === a);
  const metaB = runs.find((r) => r.id === b);
  const sysA = metaA?.system_id ?? headA.data?.metadata?.system_id ?? null;
  const sysB = metaB?.system_id ?? headB.data?.metadata?.system_id ?? null;
  const nameOf = (id: string | null) => land.data?.systems.find((x) => x.id === id)?.name ?? null;
  const systemName = nameOf(sysB) ?? "";
  const chipOf = (meta: typeof metaA, head: typeof headA.data) => (meta ?? (head ? { run_number: head.run_number, run_at: head.run_at, status: head.status, baseline: head.metadata?.baseline ?? false } : null));
  const chipA = chipOf(metaA, headA.data);
  const chipB = chipOf(metaB, headB.data);
  const nameA = runLabel(nameOf(sysA), chipA?.run_number);
  const nameB = runLabel(nameOf(sysB), chipB?.run_number);

  const swapTo = (nextA: string, nextB: string) => router.push(v2Href(`/run/${nextA}/vs/${nextB}`));
  // Only runs of the same system: the swap can never make a pair the page would refuse.
  const options = [...runs].reverse().filter((r) => sameSystem(r.system_id, sysB));

  if (!sameSystem(sysA, sysB)) {
    return (
      <CcPage>
        <PageTitle>{tr("Compare runs")}</PageTitle>
        <div className="m2-sec" data-testid="compare-guard">
          <EmptyFrame action={<V2Link href={`/run/${b}`} className="m2-btn m2-strong">{tr("Open {name}", { name: nameB })}</V2Link>}>
            {tr("Compare runs of the same system. {a} and {b} belong to different systems, and run numbers restart per system.", { a: nameA, b: nameB })}
          </EmptyFrame>
        </div>
      </CcPage>
    );
  }

  if (sum.isError) {
    return (
      <CcPage>
        <PageTitle>{tr("Compare runs")}</PageTitle>
        <div className="m2-sec">
          <ErrorFrame onRetry={() => void sum.refetch()}>
            {tr("These two runs could not be compared. Both must exist and belong to the same system.")} <V2Link href="/runs">{tr("Choose runs from the list")}</V2Link>
          </ErrorFrame>
        </div>
      </CcPage>
    );
  }

  const { up, dn } = S ? changeCounts(S) : { up: 0, dn: 0 };
  const held = (S?.objects ?? []).filter((o) => o.after?.capped).length;
  const t = S?.totals;
  const title = chipA && chipB ? tr("{b} vs {a}", { b: nameB, a: nameA }) : tr("Compare runs");
  const worst = S ? worstObject(S) : null;
  const workQuery = new URLSearchParams({ version_id: b, since: a, filter: "open" });
  if (sysB) workQuery.set("system", sysB);
  if (worst) workQuery.set("module", worst.module);

  const verdict = up >= dn && (t?.newly_failing ?? 0) === 0 ? "go" : up > dn ? "at-risk" : "no-go";
  return (
    <CcPage>
      <PageTitle>{title}</PageTitle>
      <div className="m2-cta" data-testid="compare-chips">
        {chipB ? <RunChip run={chipB} system={nameOf(sysB)} /> : null}
        <span className="m2-meta">{tr("compared with")}</span>
        {chipA ? <RunChip run={chipA} system={nameOf(sysA)} /> : null}
        {options.length > 1 ? (
          <span className="m2-pop-cmp">
            <label htmlFor="cmp-from" className="m2-meta">
              {tr("Earlier run")}
            </label>
            <select id="cmp-from" className="m2-sel" aria-label={tr("From run")} value={a} onChange={(e) => swapTo(e.target.value, b)}>
              {options.map((r) => (
                <option key={r.id} value={r.id}>
                  {runLabel(nameOf(r.system_id), r.run_number)}, {formatDate(r.run_at, "date")}
                </option>
              ))}
            </select>
            <label htmlFor="cmp-to" className="m2-meta">
              {tr("Later run")}
            </label>
            <select id="cmp-to" className="m2-sel" aria-label={tr("To run")} value={b} onChange={(e) => swapTo(a, e.target.value)}>
              {options.map((r) => (
                <option key={r.id} value={r.id}>
                  {runLabel(nameOf(r.system_id), r.run_number)}, {formatDate(r.run_at, "date")}
                </option>
              ))}
            </select>
          </span>
        ) : null}
      </div>
      <Lede>{tr("What changed between {a} and {b}, object by object. Scores are out of 100 and positive changes are better. The Records tab lists the records behind the rules.", { a: nameA, b: nameB })}</Lede>
      {S && t ? (
        <>
          <PrimaryAction
            action={
              worst || t.newly_failing > 0 ? (
                <V2Link href={`/work?${workQuery.toString()}`} className="m2-btn m2-strong" data-testid="compare-worse">
                  {tr("Open what got worse")}
                </V2Link>
              ) : (
                <V2Link href={`/run/${b}`} className="m2-btn m2-strong">
                  {tr("Open run details")}
                </V2Link>
              )
            }
            why={
              worst
                ? tr("{label} lost the most, {n} points. This opens its open records as they stood at {name}.", { label: worst.label, n: signed(measuredChange(worst)), name: nameB })
                : t.newly_failing > 0
                  ? tr("{n} rules started failing. This opens the open records as they stood at {name}.", { n: int(t.newly_failing), name: nameB })
                  : tr("Nothing got worse, so the next step is to read the run itself.")
            }
          />
          <CcBanner
            testId="compare-banner"
            label={tr("What changed")}
            eyebrow={tr("Compared with {name}, {run_at}", { name: nameA, run_at: formatDate(S.a.run_at, "date") })}
            verdict={verdict}
            headline={up > dn ? tr("Data quality improved") : up < dn ? tr("Data quality got worse") : tr("Data quality is about the same")}
            why={
              <span data-testid="compare-sentence">
                {tr("{up} of {rowsCount} objects scored higher and {dn} lower. {newly_failing} rules started failing and {fixed} stopped.", { up, rowsCount: rows.length, dn, newly_failing: int(t.newly_failing), fixed: int(t.fixed) })}
                {held > 0 ? tr(" {held} {held, plural, one {object is} other {objects are}} held down by a critical rule, so the score shown hides part of the problem.", { held }) : ""}
              </span>
            }
            figs={[
              { label: tr("Rules newly failing"), value: int(t.newly_failing), note: tr("{n} stopped failing", { n: int(t.fixed) }), hint: tr("Rules that passed in the earlier run and fail in the later run.") },
              { label: tr("Objects higher"), value: int(up), note: tr("of {n}", { n: int(rows.length) }), hint: tr("Objects whose measured score rose between the two runs.") },
              { label: tr("Objects lower"), value: int(dn), note: tr("of {n}", { n: int(rows.length) }), hint: tr("Objects whose measured score fell between the two runs.") },
            ]}
          />
          <p className="m2-prov" data-testid="compare-method">
            {S.method}{" "}{tr("Coverage is the share of records a rule could evaluate.")}
          </p>
        </>
      ) : (
        <Skeleton width={520} height={16} />
      )}
      <nav className="m2-tabs" aria-label={tr("Views of this comparison")}>
        <V2Link href={`/run/${a}/vs/${b}`} className="m2-tab" aria-current={view === "changes" ? "page" : undefined}>
          {tr("Scores and rules")}
        </V2Link>
        <V2Link href={`/run/${a}/vs/${b}?view=records`} className="m2-tab" aria-current={view === "records" ? "page" : undefined}>
          {tr("Records")}
        </V2Link>
      </nav>
      {view === "records" ? (
        S && t ? <CompareRecords a={a} b={b} labelOf={labelOf} /> : <Skeleton width="100%" height={200} />
      ) : (
        <>
      {S && t ? (
        <section className="m2-cc-card" aria-label={tr("Change in score by object")}>
          <h3>{tr("Change in score by object")}</h3>
          <p className="m2-meta">{tr("Measured points, {a} to {b}. The table below has the same figures.", { a: nameA, b: nameB })}</p>
          <ObjectChangeBars S={S} />
        </section>
      ) : null}

      <section className="m2-sec" aria-label={tr("By object")}>
        <div className="m2-sechead">
          <h2 className="m2-h2">{tr("By object")}</h2>
          <span className="m2-sub">{tr("Measured score, then the score shown after the cap")}</span>
        </div>
        {!S ? (
          <Skeleton width="100%" height={200} />
        ) : rows.length === 0 ? (
          <EmptyFrame action={<V2Link href="/runs" className="m2-btn">{tr("Choose other runs")}</V2Link>}>{tr("Neither run scored an object, so there is nothing to compare.")}</EmptyFrame>
        ) : (
          <>
            <div className="m2-frame m2-only-wide">
              <TableExport><table className="m2-tbl" data-testid="compare-table" style={{ minWidth: 1040 }}>
                <thead>
                  <tr>
                    <th scope="col">{tr("Object")}</th>
                    <th scope="col" className="m2-r" title={tr("Measured score out of 100 in {name}", { name: nameA })}>
                      {tr("Before")}
                    </th>
                    <th scope="col" className="m2-r" title={tr("Measured score out of 100 in {name}", { name: nameB })}>
                      {tr("After")}
                    </th>
                    <th scope="col" style={{ width: 120 }} title={tr("Change in measured score, in points")}>
                      {tr("Change")}
                    </th>
                    <th scope="col" className="m2-r">
                      <span className="m2-sr">{tr("Change in points")}</span>
                    </th>
                    <th scope="col" className="m2-r" title={tr("The score after the critical cap, before to after")}>
                      {tr("Shown")}
                    </th>
                    <th scope="col" className="m2-r" title={tr("Records the rules looked at, before to after")}>
                      {tr("Records checked")}
                    </th>
                    <th scope="col" className="m2-r" title={tr("Share of records a rule could evaluate in the later run")}>
                      {tr("Coverage")}
                    </th>
                    <th scope="col" className="m2-r" title={tr("Rules newly failing")}>
                      {tr("New")}
                    </th>
                    <th scope="col" className="m2-r" title={tr("Rules fixed")}>
                      {tr("Closed")}
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
                      <td className="m2-r">{f1(o.before?.raw_score)}</td>
                      <td className="m2-r">{f1(o.after?.raw_score)}</td>
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
              </table></TableExport>
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
                    {tr("{raw_score} to {raw_score2} measured, shown {score} to {score2}, {records_checked} to {records_checked2} records checked, coverage {coverage} to {coverage2}. {newly_failing} new, {fixed} fixed, {worse} worse, {better} better.", { coverage: pct1(o.before?.coverage), coverage2: pct1(o.after?.coverage), raw_score: f1(o.before?.raw_score), raw_score2: f1(o.after?.raw_score), score: f1(o.before?.score), score2: f1(o.after?.score), records_checked: int(o.before?.records_checked), records_checked2: int(o.after?.records_checked), newly_failing: o.newly_failing, fixed: o.fixed, worse: o.worse, better: o.better })}
                  </div>
                </V2Link>
              ))}
              <p className="m2-prov" data-testid="compare-list-totals">{tr("All {rowsCount} objects: {newly_failing} new, {fixed} fixed, {worse} worse, {better} better.", { rowsCount: rows.length, newly_failing: int(t?.newly_failing), fixed: int(t?.fixed), worse: int(t?.worse), better: int(t?.better) })}</p>
            </div>
          </>
        )}
      </section>

      {S && t ? <ScoreDeltaPanel a={a} b={b} S={S} /> : null}

      {S && t ? (
        <WhatChanged
          a={a}
          b={b}
          totals={{ newly_failing: t.newly_failing, fixed: t.fixed, worse: t.worse, better: t.better }}
          labelOf={labelOf}
        />
      ) : null}
        </>
      )}
    </CcPage>
  );
}
