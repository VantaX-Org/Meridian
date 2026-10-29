"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/format";
import type { ChangeKind, CompareObject } from "@/lib/api/v2/runs";
import { useOpenItem, useV2Href } from "@/lib/v2/hooks";
import { useCompareSummary, useTimeline, useVersionChanges } from "@/lib/v2/runs-queries";
import { f1, int, moduleSlug, pct1 } from "@/lib/v2/score";
import { useLandscape } from "@/lib/v2/queries";
import { systemSlug } from "@/lib/v2/score";
import { VerdictMark } from "../marks";
import { Dash, EmptyFrame, ErrorFrame, Mono, PageTitle, Skeleton, V2Link } from "../parts";

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

/** A bar either side of a zero line: green to the right for a rise, red to the left for a fall. Never colour alone: the sign sits beside it. */
export function DivergingBar({ d, width = 110, scale = 17 }: { d: number | null; width?: number; scale?: number }) {
  const mid = width / 2;
  const len = d == null ? 0 : Math.min(Math.abs(d) * scale, mid - 2);
  const x = d != null && d >= 0 ? mid : mid - len;
  return (
    <svg className="m2-dbar" width={width} height={12} viewBox={`0 0 ${width} 12`} aria-hidden="true" data-testid="dbar">
      <line className="m2-z" x1={mid} x2={mid} y1={0} y2={12} />
      {d != null && d !== 0 ? <rect className={d > 0 ? "m2-up" : "m2-dn"} x={x} y={3} width={len} height={6} /> : null}
    </svg>
  );
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
  { kind: "newly_failing", title: "Newly failing rules" },
  { kind: "fixed", title: "Fixed rules" },
  { kind: "worse", title: "Worse" },
  { kind: "better", title: "Better" },
];
const SHOWN = 5;

function WhatChanged({ a, b, totals, labelOf }: { a: string; b: string; totals: Record<ChangeKind, number>; labelOf: (m: string) => string }) {
  const q = useVersionChanges(a, b);
  const { hrefFor } = useOpenItem();
  const [all, setAll] = useState<Partial<Record<ChangeKind, boolean>>>({});
  return (
    <section className="m2-sec" aria-label="What changed">
      <div className="m2-sechead">
        <h2 className="m2-h2">What changed</h2>
        <span className="m2-sub">Rule counts match the table above</span>
      </div>
      {q.isLoading ? (
        <Skeleton width="100%" height={160} />
      ) : q.isError || !q.data ? (
        <ErrorFrame onRetry={() => void q.refetch()}>The rules that changed could not be read.</ErrorFrame>
      ) : (
        <div className="m2-chg" data-testid="what-changed">
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
                            <Mono>{c.check_id}</Mono>
                          </V2Link>{" "}
                          {c.message ?? ""}
                        </span>
                        <span className="m2-s">{`${labelOf(c.module)}, ${int(c.v1_affected)} to ${int(c.v2_affected)} records failing`}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {rest > 0 ? (
                  <div className="m2-more">
                    <button type="button" className="m2-linkbtn" onClick={() => setAll((s) => ({ ...s, [kind]: true }))}>
                      {`and ${int(rest)} more`}
                    </button>
                  </div>
                ) : open && list.length > SHOWN ? (
                  <div className="m2-more">
                    <button type="button" className="m2-linkbtn" onClick={() => setAll((s) => ({ ...s, [kind]: false }))}>
                      Show fewer
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
 * `/v2/run/{a}/vs/{b}`: run b (after) against run a (before). One sentence, a row per object with the measured score
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

  const swapTo = (nextA: string, nextB: string) => router.push(v2Href(`/v2/run/${nextA}/vs/${nextB}`));
  const options = [...runs].reverse();

  if (sum.isError) {
    return (
      <>
        <PageTitle>Compare runs</PageTitle>
        <div className="m2-sec">
          <ErrorFrame onRetry={() => void sum.refetch()}>These two runs could not be compared. Both must exist and belong to the same system.</ErrorFrame>
        </div>
      </>
    );
  }

  const up = rows.filter((r) => r.d != null && r.d > 0).length;
  const dn = rows.filter((r) => r.d != null && r.d < 0).length;
  const held = (S?.objects ?? []).filter((o) => o.after?.capped).length;
  const t = S?.totals;
  const title = S ? `Run ${formatDate(S.b.run_at, "datetime")} vs ${baselineA ? "baseline " : ""}${formatDate(S.a.run_at, "date")}` : "Compare runs";

  return (
    <>
      <PageTitle>{title}</PageTitle>
      {S && t ? (
        <>
          <p className="m2-finding" data-testid="compare-sentence">
            {`${up} of ${rows.length} objects scored higher and ${dn} lower. ${int(t.newly_failing)} rules started failing and ${int(t.fixed)} stopped.`}
            {held > 0 ? ` ${held} ${held === 1 ? "object is" : "objects are"} still capped by a critical rule, so the shown score hides part of it.` : ""}
          </p>
          <p className="m2-prov" data-testid="compare-method">
            {S.method} Coverage is the share of records a rule could evaluate.
          </p>
        </>
      ) : (
        <Skeleton width={520} height={16} />
      )}
      <div className="m2-cta">
        <V2Link href={`/v2/run/${b}`} className="m2-btn">
          Open run details
        </V2Link>
        {options.length > 1 ? (
          <span className="m2-pop-cmp">
            <label htmlFor="cmp-from" className="m2-meta">
              Compare
            </label>
            <select id="cmp-from" className="m2-sel" aria-label="From run" value={a} onChange={(e) => swapTo(e.target.value, b)}>
              {options.map((r) => (
                <option key={r.id} value={r.id}>
                  {formatDate(r.run_at, "datetime")}
                </option>
              ))}
            </select>
            <label htmlFor="cmp-to" className="m2-meta">
              with
            </label>
            <select id="cmp-to" className="m2-sel" aria-label="To run" value={b} onChange={(e) => swapTo(a, e.target.value)}>
              {options.map((r) => (
                <option key={r.id} value={r.id}>
                  {formatDate(r.run_at, "datetime")}
                </option>
              ))}
            </select>
          </span>
        ) : null}
      </div>

      <section className="m2-sec" aria-label="By object">
        <div className="m2-sechead">
          <h2 className="m2-h2">By object</h2>
          <span className="m2-sub">Measured score, then the score shown after the cap</span>
        </div>
        {!S ? (
          <Skeleton width="100%" height={200} />
        ) : rows.length === 0 ? (
          <EmptyFrame>Neither run scored an object, so there is nothing to compare.</EmptyFrame>
        ) : (
          <>
            <div className="m2-frame m2-only-wide">
              <table className="m2-tbl" data-testid="compare-table" style={{ minWidth: 960 }}>
                <thead>
                  <tr>
                    <th scope="col">Object</th>
                    <th scope="col" className="m2-r">
                      Measured
                    </th>
                    <th scope="col" style={{ width: 120 }}>
                      Change
                    </th>
                    <th scope="col" className="m2-r">
                      <span className="m2-sr">Change in points</span>
                    </th>
                    <th scope="col" className="m2-r">
                      Shown
                    </th>
                    <th scope="col" className="m2-r">
                      Records checked
                    </th>
                    <th scope="col" className="m2-r">
                      Coverage
                    </th>
                    <th scope="col" className="m2-r" title="Rules newly failing">
                      New
                    </th>
                    <th scope="col" className="m2-r" title="Rules fixed">
                      Fixed
                    </th>
                    <th scope="col" className="m2-r" title="Rules with more failing rows">
                      Worse
                    </th>
                    <th scope="col" className="m2-r" title="Rules with fewer failing rows">
                      Better
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ o, d }) => (
                    <tr key={o.module} data-testid="compare-row">
                      <th scope="row">
                        <V2Link href={`/v2/o/${systemSlug(systemName)}/${moduleSlug(o.module)}?run=${b}`}>{o.label}</V2Link>
                      </th>
                      <td className="m2-r">
                        {f1(o.before?.raw_score)} <span className="m2-u">to</span> {f1(o.after?.raw_score)}
                      </td>
                      <td>
                        <DivergingBar d={d} />
                      </td>
                      <td className={`m2-r ${d != null && d > 0 ? "m2-up" : d != null && d < 0 ? "m2-dn" : ""}`}>
                        <Change d={d} />
                      </td>
                      <td className="m2-r">
                        {f1(o.before?.score)} <span className="m2-u">to</span> {f1(o.after?.score)}
                      </td>
                      <td className="m2-r">
                        {o.before?.records_checked == null && o.after?.records_checked == null ? (
                          <Dash />
                        ) : (
                          <>
                            {int(o.before?.records_checked)} <span className="m2-u">to</span> {int(o.after?.records_checked)}
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
                    <th scope="row">{`All ${rows.length} objects`}</th>
                    <td />
                    <td />
                    <td />
                    <td />
                    <td className="m2-r">
                      {int(t?.records_checked_before)} <span className="m2-u">to</span> {int(t?.records_checked_after)}
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
                <V2Link key={o.module} href={`/v2/o/${systemSlug(systemName)}/${moduleSlug(o.module)}?run=${b}`} className="m2-lrow" style={{ gridTemplateColumns: "1fr auto" }}>
                  <div className="m2-nm" style={{ gridColumn: 1 }}>
                    {o.label}
                  </div>
                  <div style={{ gridColumn: 2, display: "flex", gap: 8, alignItems: "center" }}>
                    <DivergingBar d={d} width={72} scale={12} />
                    <Change d={d} />
                  </div>
                  <div className="m2-c">
                    {`${f1(o.before?.raw_score)} to ${f1(o.after?.raw_score)} measured, shown ${f1(o.before?.score)} to ${f1(o.after?.score)}, ${int(o.before?.records_checked)} to ${int(o.after?.records_checked)} records checked. ${o.newly_failing} new, ${o.fixed} fixed, ${o.worse} worse, ${o.better} better.`}
                  </div>
                </V2Link>
              ))}
              <p className="m2-prov" data-testid="compare-list-totals">{`All ${rows.length} objects: ${int(t?.newly_failing)} new, ${int(t?.fixed)} fixed, ${int(t?.worse)} worse, ${int(t?.better)} better.`}</p>
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
    </>
  );
}
