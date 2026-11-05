"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { acknowledgeBreak, expectBreak, explainBreak, getLearnedMonitors, snoozeBreak, type BreakKind, type BreakMetric, type LearnedBreak, type MonitorThreshold } from "@/lib/api/v2/learned-monitors";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { relTime } from "@/lib/v2/format";
import { f1, int } from "@/lib/v2/score";
import { Sev } from "../inspector/rule";
import { Dash, EmptyFrame, ErrorFrame, Mono, Skeleton } from "../parts";
import { useToast } from "../Toast";
import { CcBanner, CcPage } from "./cc-parts";
import { Panel } from "./Mining";
import { ScrollFrame } from "./object/ScrollFrame";

/**
 * Learned monitors: for every licensed object Meridian learns what a run normally looks like from its own earlier
 * runs (median and spread, weekday-aware once there is a month of runs) and flags the run that breaks it. An object
 * with too few earlier runs is learning and raises nothing. A steward acknowledges, marks a break expected (it then
 * leaves the baseline, or becomes the new normal) or snoozes it. The explanation uses aggregate figures only.
 */

const KIND: Record<BreakKind, () => string> = {
  volume_drop: () => t("Volume drop"),
  volume_spike: () => t("Volume spike"),
  fail_rate_jump: () => t("Fail rate jump"),
  score_drop: () => t("Score drop"),
  field_emptied: () => t("Field emptied"),
  cardinality_shift: () => t("Distinct values shifted"),
  pattern_shift: () => t("Value shapes shifted"),
  format_break: () => t("Format broke"),
  range_shift: () => t("Range shifted"),
};

const METRIC: Record<BreakMetric, () => string> = {
  records: () => t("Records checked"),
  score: () => t("Score"),
  fail_rate: () => t("Fail rate"),
  blank_pct: () => t("Empty share"),
  distinct_pct: () => t("Distinct share"),
  pattern_pct: () => t("Share outside the usual shapes"),
  unparse_pct: () => t("Share not parseable"),
  num_mean: () => t("Mean"),
  num_max: () => t("Largest value"),
  num_min: () => t("Smallest value"),
  date_max: () => t("Latest date"),
  date_min: () => t("Earliest date"),
};

/** Metrics that hold a value of the field (a number or a day). The screen shows how far it moved, never the value. */
const RANGE = new Set<BreakMetric>(["num_mean", "num_max", "num_min", "date_max", "date_min"]);
const isDate = (m: BreakMetric) => m === "date_max" || m === "date_min";

const STATUS = { open: () => t("Open"), acknowledged: () => t("Acknowledged"), expected: () => t("Expected"), snoozed: () => t("Snoozed"), below_minimum: () => t("Below the minimum") };

const fmt = (m: BreakMetric, n: number | null) => (n == null ? <Dash /> : m === "records" ? int(n) : m === "score" ? f1(n) : `${f1(n)}%`);

/** An effect in its own unit: records and numeric ranges as a share of the median, dates as days, score as points, the rest as percentage points. */
const eff = (m: MonitorThreshold["metric"], n: number) =>
  m === "records" ? `${f1(n * 100)}%` : RANGE.has(m) ? (isDate(m) ? t("{n, plural, one {# day} other {# days}}", { n: Math.round(n) }) : `${f1(n)}%`) : m === "score" ? t("{n} points", { n: f1(n) }) : t("{n} percentage points", { n: f1(n) });

/** How far a range metric moved from its usual level, in the unit of eff(): percent of the median, or days. */
const moved = (b: LearnedBreak) => {
  const m = b.median ?? 0;
  return eff(b.metric, isDate(b.metric) ? Math.abs(b.observed - m) : m === 0 ? 0 : (Math.abs(b.observed - m) / Math.abs(m)) * 100);
};

/** Usual range and observed cells: a range metric shows how far it moved, never a value of the field. */
const Usual = ({ b }: { b: LearnedBreak }) => RANGE.has(b.metric) ? <Dash why={t("Only the size of the move is shown, not a value of the field.")} /> : <>{fmt(b.metric, b.expected_low)} {t("to")} {fmt(b.metric, b.expected_high)}</>;
const Seen = ({ b }: { b: LearnedBreak }) => RANGE.has(b.metric) ? <>{t("{effect} from the usual level", { effect: moved(b) })}</> : <>{fmt(b.metric, b.observed)}</>;
/** The break kind with, for a range, which figure moved. */
const Kind = ({ b }: { b: LearnedBreak }) => <>{KIND[b.kind]()}{b.kind === "range_shift" ? <span className="m2-meta"> {METRIC[b.metric]()}</span> : null}</>;

function Thresholds({ rows }: { rows: MonitorThreshold[] }) {
  return (
    <Panel title={t("Learned minimum effect")} meta={t("How big a break must be before it is raised. Stewards' decisions move it between the fixed floor and the ceiling.")} testId="monitors-thresholds">
      {rows.length === 0 ? <EmptyFrame>{t("No decision has moved a minimum yet. Every monitor uses its fixed floor.")}</EmptyFrame> : (
        <ScrollFrame label={t("Learned minimum effects table, scrollable")}>
          <table className="m2-tbl m2-cards">
            <thead>
              <tr>
                <th scope="col">{t("Object")}</th>
                <th scope="col">{t("Figure")}</th>
                <th scope="col">{t("Rule or field")}</th>
                <th scope="col">{t("Minimum now")}</th>
                <th scope="col">{t("Fixed floor")}</th>
                <th scope="col">{t("Ceiling")}</th>
                <th scope="col">{t("Decisions that moved it")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.module}|${r.metric}|${r.subject_code}`} data-testid={`threshold-${r.module}-${r.metric}-${r.subject_code || "all"}`}>
                  <td data-label={t("Object")}>{moduleText(r.module)}</td>
                  <th scope="row" className="m2-card-lead">{METRIC[r.metric]()}</th>
                  <td data-label={t("Rule or field")}>{r.subject_code ? <>{r.subject_description ? <>{r.subject_description} </> : null}<span className="m2-meta"><Mono>{r.subject_code}</Mono></span></> : <Dash />}</td>
                  <td data-label={t("Minimum now")} className="m2-num">{eff(r.metric, r.min_effect)}</td>
                  <td data-label={t("Fixed floor")} className="m2-num">{eff(r.metric, r.floor)}</td>
                  <td data-label={t("Ceiling")} className="m2-num">{eff(r.metric, r.ceiling)}</td>
                  <td data-label={t("Decisions that moved it")}>
                    <ul className="m2-cl-changes">
                      {r.moves.map((m) => (
                        <li key={m.break_id}>
                          {(m.decision === "expected" ? t("Run {n}: marked expected by {who} at {effect}, minimum now {min}", { n: m.run_number ?? "-", who: m.decided_by ?? "-", effect: eff(r.metric, m.effect), min: eff(r.metric, m.min_effect_after) })
                            : t("Run {n}: confirmed real by {who} at {effect}, minimum now {min}", { n: m.run_number ?? "-", who: m.decided_by ?? "-", effect: eff(r.metric, m.effect), min: eff(r.metric, m.min_effect_after) }))}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      )}
    </Panel>
  );
}

const Subject = ({ b }: { b: LearnedBreak }) =>
  b.subject_code ? (
    <>{b.subject_description ? <>{b.subject_description} </> : null}<span className="m2-meta"><Mono>{b.subject_code}</Mono></span></>
  ) : <Dash />;

/** The usual range as a band with the observed value as a mark; the axis runs from the lower of the three to the higher. */
function Strip({ b }: { b: LearnedBreak }) {
  if (RANGE.has(b.metric)) return <Dash />;
  const lo = b.expected_low ?? b.observed, hi = b.expected_high ?? b.observed;
  const min = Math.min(lo, b.observed), max = Math.max(hi, b.observed);
  const span = max - min || 1;
  const x = (v: number) => 4 + ((v - min) / span) * 112;
  return (
    <svg width="120" height="16" viewBox="0 0 120 16" role="img" aria-label={t("Usual range {lo} to {hi}, observed {o}", { lo: String(b.expected_low ?? "-"), hi: String(b.expected_high ?? "-"), o: String(b.observed) })}>
      <rect x={x(lo)} y="5" width={Math.max(x(hi) - x(lo), 2)} height="6" fill="var(--m2-pass-bg)" stroke="var(--m2-pass)" />
      <line x1={x(b.observed)} x2={x(b.observed)} y1="1" y2="15" stroke="var(--m2-crit)" strokeWidth="2" />
    </svg>
  );
}

export function LearnedMonitors() {
  const fixture = useFixture();
  const { can } = useV2Session();
  const qc = useQueryClient();
  const key = ["learned-monitors", fixture];
  const q = useQuery({ queryKey: key, queryFn: getLearnedMonitors, staleTime: 30_000 });
  const [picked, setPicked] = useState<string | null>(null);
  const title = t("Learned monitors");

  if (q.isPending) return <CcPage title={title}><Skeleton width="100%" height={320} /></CcPage>;
  if (q.isError) return <CcPage title={title}><ErrorFrame onRetry={() => void q.refetch()}>{t("The monitors could not be read.")}</ErrorFrame></CcPage>;

  const { coverage, breaks, min_runs: minRuns } = q.data;
  const interim = q.data.interim ?? [];
  const quiet = q.data.below_minimum ?? [];
  const open = [...breaks, ...interim].filter((b) => b.status === "open").length;
  const sel = [...interim, ...breaks].find((b) => b.id === picked) ?? breaks[0] ?? interim[0] ?? null;
  const allowed = can("mdm.write");

  return (
    <CcPage title={title}>
      <CcBanner
        testId="monitors"
        label={title}
        eyebrow={title}
        headline={t("{n, plural, =0 {No open break against the learned baseline} one {# open break against the learned baseline} other {# open breaks against the learned baseline}}", { n: open })}
        why={t("Each object is compared with its own earlier runs. With fewer than {n} earlier runs it only learns and raises nothing.", { n: minRuns })}
      />

      <Panel title={t("What is learned")} meta={t("Earlier runs of the same system used for each object.")} testId="monitors-coverage">
        {coverage.length === 0 ? <EmptyFrame>{t("No finished run yet.")}</EmptyFrame> : (
          <ScrollFrame label={t("Learned objects table, scrollable")}>
            <table className="m2-tbl m2-cards">
              <thead>
                <tr>
                  <th scope="col">{t("Object")}</th>
                  <th scope="col">{t("Latest run")}</th>
                  <th scope="col">{t("Earlier runs used")}</th>
                  <th scope="col">{t("State")}</th>
                  <th scope="col">{t("Breaks")}</th>
                </tr>
              </thead>
              <tbody>
                {coverage.map((c) => (
                  <tr key={c.module} data-testid={`monitor-object-${c.module}`}>
                    <th scope="row" className="m2-card-lead">{moduleText(c.module)}</th>
                    <td data-label={t("Latest run")}>{c.run_number == null ? <Dash /> : t("Run {n}", { n: c.run_number })}</td>
                    <td data-label={t("Earlier runs used")} className="m2-num">{t("{n} of {min} needed", { n: int(c.baseline_runs), min: int(c.min_runs) })}</td>
                    <td data-label={t("State")}>{c.state === "active" ? t("Watching") : t("Learning")}</td>
                    <td data-label={t("Breaks")} className="m2-num">{c.state === "active" ? int(c.breaks) : <Dash why={t("Raises nothing until it has enough earlier runs.")} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollFrame>
        )}
      </Panel>

      <Panel title={t("Breaks in the latest run")} meta={t("Most severe first.")} testId="monitors-breaks">
        {breaks.length === 0 ? <EmptyFrame>{t("No break. Every watched figure is inside its usual range.")}</EmptyFrame> : (
          <ScrollFrame label={t("Breaks table, scrollable")}>
            <table className="m2-tbl m2-cards">
              <thead>
                <tr>
                  <th scope="col">{t("Object")}</th>
                  <th scope="col">{t("Break")}</th>
                  <th scope="col">{t("Rule or field")}</th>
                  <th scope="col">{t("Usual range")}</th>
                  <th scope="col">{t("Observed")}</th>
                  <th scope="col"><span className="m2-sr">{t("Range chart")}</span></th>
                  <th scope="col">{t("Earlier runs used")}</th>
                  <th scope="col">{t("Severity")}</th>
                  <th scope="col">{t("Status")}</th>
                </tr>
              </thead>
              <tbody>
                {breaks.map((b) => (
                  <tr key={b.id} data-testid={`break-${b.id}`} aria-selected={sel?.id === b.id} onClick={() => setPicked(b.id)}>
                    <td data-label={t("Object")}>{moduleText(b.module)}</td>
                    <th scope="row" className="m2-card-lead">
                      <button type="button" className="m2-linkbtn" onClick={() => setPicked(b.id)}><Kind b={b} /></button>
                    </th>
                    <td data-label={t("Rule or field")}><Subject b={b} /></td>
                    <td data-label={t("Usual range")} className="m2-num"><Usual b={b} /></td>
                    <td data-label={t("Observed")} className="m2-num"><Seen b={b} /></td>
                    <td><Strip b={b} /></td>
                    <td data-label={t("Earlier runs used")} className="m2-num">{int(b.baseline_runs)}</td>
                    <td data-label={t("Severity")}><Sev severity={b.severity} /></td>
                    <td data-label={t("Status")}>{STATUS[b.status]()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollFrame>
        )}
      </Panel>

      <Panel title={t("Between full runs")} meta={t("Volume only. An extraction that landed after the latest finished run, whose analysis has not finished, compared with the rows of earlier syncs. Score, fail rate and empty share exist only after the checks run.")} testId="monitors-interim">
        {interim.length === 0 ? <EmptyFrame>{t("No break between full runs. No pending extraction is outside its usual size.")}</EmptyFrame> : (
          <ScrollFrame label={t("Breaks between full runs table, scrollable")}>
            <table className="m2-tbl m2-cards">
              <thead>
                <tr>
                  <th scope="col">{t("Object")}</th>
                  <th scope="col">{t("Break")}</th>
                  <th scope="col">{t("Usual range")}</th>
                  <th scope="col">{t("Rows extracted")}</th>
                  <th scope="col"><span className="m2-sr">{t("Range chart")}</span></th>
                  <th scope="col">{t("Earlier syncs used")}</th>
                  <th scope="col">{t("Severity")}</th>
                  <th scope="col">{t("Status")}</th>
                  <th scope="col">{t("Detected")}</th>
                </tr>
              </thead>
              <tbody>
                {interim.map((b) => (
                  <tr key={b.id} data-testid={`interim-${b.id}`} aria-selected={sel?.id === b.id} onClick={() => setPicked(b.id)}>
                    <td data-label={t("Object")}>{moduleText(b.module)}</td>
                    <th scope="row" className="m2-card-lead">
                      <button type="button" className="m2-linkbtn" onClick={() => setPicked(b.id)}><Kind b={b} /></button>
                    </th>
                    <td data-label={t("Usual range")} className="m2-num"><Usual b={b} /></td>
                    <td data-label={t("Rows extracted")} className="m2-num"><Seen b={b} /></td>
                    <td><Strip b={b} /></td>
                    <td data-label={t("Earlier syncs used")} className="m2-num">{int(b.baseline_runs)}</td>
                    <td data-label={t("Severity")}><Sev severity={b.severity} /></td>
                    <td data-label={t("Status")}>{b.status === "open" ? t("Analysis pending") : STATUS[b.status]()}</td>
                    <td data-label={t("Detected")}>{relTime(b.detected_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollFrame>
        )}
      </Panel>

      <BelowMinimum rows={quiet} thresholds={q.data.thresholds ?? []} allowed={allowed} onChanged={() => void qc.invalidateQueries({ queryKey: key })} />

      <Thresholds rows={q.data.thresholds ?? []} />

      {sel ? <Detail b={sel} allowed={allowed} onChanged={() => void qc.invalidateQueries({ queryKey: key })} /> : null}
    </CcPage>
  );
}

/** Breaks outside the usual range that are smaller than a raised minimum: stored, never alerted. Confirming one is a decision that it is real. */
function BelowMinimum({ rows, thresholds, allowed, onChanged }: { rows: LearnedBreak[]; thresholds: MonitorThreshold[]; allowed: boolean; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useMutation({
    mutationFn: (id: string) => acknowledgeBreak(id),
    onSuccess: onChanged,
    onError: (e: unknown) => toast.show(errorSentence(e, t("The decision could not be saved.")), "error"),
  });
  const minimum = (b: LearnedBreak) => thresholds.find((x) => x.module === b.module && x.metric === b.metric && x.subject_code === b.subject_code);
  return (
    <Panel title={t("Below the learned minimum")} meta={t("Outside the usual range but smaller than the minimum a steward raised. Nothing is alerted. Confirm one that is real and the minimum drops.")} testId="monitors-below-minimum">
      {rows.length === 0 ? <EmptyFrame>{t("No break sits below a raised minimum.")}</EmptyFrame> : (
        <ScrollFrame label={t("Breaks below the learned minimum table, scrollable")}>
          <table className="m2-tbl m2-cards">
            <thead>
              <tr>
                <th scope="col">{t("Object")}</th>
                <th scope="col">{t("Break")}</th>
                <th scope="col">{t("Rule or field")}</th>
                <th scope="col">{t("Usual range")}</th>
                <th scope="col">{t("Observed")}</th>
                <th scope="col">{t("Minimum now")}</th>
                <th scope="col"><span className="m2-sr">{t("Actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => {
                const m = minimum(b);
                return (
                  <tr key={b.id} data-testid={`quiet-${b.id}`}>
                    <td data-label={t("Object")}>{moduleText(b.module)}</td>
                    <th scope="row" className="m2-card-lead"><Kind b={b} /></th>
                    <td data-label={t("Rule or field")}><Subject b={b} /></td>
                    <td data-label={t("Usual range")} className="m2-num"><Usual b={b} /></td>
                    <td data-label={t("Observed")} className="m2-num"><Seen b={b} /></td>
                    <td data-label={t("Minimum now")} className="m2-num">{m ? eff(m.metric, m.min_effect) : <Dash />}</td>
                    <td>{allowed ? <button type="button" className="m2-btn m2-sm" disabled={confirm.isPending} onClick={() => confirm.mutate(b.id)}>{t("Confirm as real")}</button> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollFrame>
      )}
    </Panel>
  );
}

/** One break: Aletheia's explanation with the runs it rests on, and the steward's decisions. */
function Detail({ b, allowed, onChanged }: { b: LearnedBreak; allowed: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [effect, setEffect] = useState<"exclude" | "accept">("exclude");
  const [days, setDays] = useState(7);
  const done = { onSuccess: onChanged, onError: (e: unknown) => toast.show(errorSentence(e, t("The decision could not be saved.")), "error") };
  const ack = useMutation({ mutationFn: () => acknowledgeBreak(b.id), ...done });
  const exp = useMutation({ mutationFn: () => expectBreak(b.id, effect), ...done });
  const snz = useMutation({ mutationFn: () => snoozeBreak(b.id, days), ...done });
  const why = useMutation({ mutationFn: () => explainBreak(b.id), ...done });
  const busy = ack.isPending || exp.isPending || snz.isPending;
  const e = b.explanation;
  return (
    <Panel title={t("Why Aletheia flagged this")} meta={KIND[b.kind]()} testId="monitors-detail">
      <p data-testid="monitors-explanation">{e.sentences.join(" ")}</p>
      <ul className="m2-cl-changes">
        <li>{e.source === "ai" ? t("Worded by Aletheia from the figures only. It saw no record.") : t("Worded from the figures by a fixed template. No AI was used.")}</li>
        <li>{METRIC[b.metric]()}: {b.median == null || RANGE.has(b.metric) ? <Dash /> : t("baseline median {m} over {n} earlier runs", { m: b.metric === "records" ? int(b.median) : f1(b.median), n: int(b.baseline_runs) })}</li>
        <li data-testid="monitors-cites">
          {t("Runs behind it")}: {b.citations.map((c) => (
            <span key={c.run_id}>{c.run_number == null ? <Dash /> : <Mono>{c.role === "current" ? t("Run {n} (this run)", { n: c.run_number }) : t("Run {n}", { n: c.run_number })}</Mono>}{" "}</span>
          ))}
        </li>
        {b.status !== "open" && b.decided_by ? <li>{t("{status} by {who}", { status: STATUS[b.status](), who: b.decided_by })}{b.baseline_effect ? ` ${b.baseline_effect === "exclude" ? t("This run is left out of later baselines.") : t("The baseline restarts at this run.")}` : ""}</li> : null}
      </ul>
      <div className="m2-gtools">
        <button type="button" className="m2-btn m2-sm" disabled={why.isPending} onClick={() => why.mutate()} data-testid="monitors-explain">{t("Ask Aletheia to explain")}</button>
      </div>
      {allowed ? (
        <div className="m2-gtools" data-testid="monitors-actions">
          <button type="button" className="m2-btn m2-sm" disabled={busy} onClick={() => ack.mutate()}>{t("Acknowledge")}</button>
          <label>
            <span className="m2-sr">{t("Effect on the baseline")}</span>
            <select value={effect} onChange={(ev) => setEffect(ev.target.value as "exclude" | "accept")}>
              <option value="exclude">{t("Leave this run out of the baseline")}</option>
              <option value="accept">{t("Accept as the new normal")}</option>
            </select>
          </label>
          <button type="button" className="m2-btn m2-sm" disabled={busy} onClick={() => exp.mutate()}>{t("Mark expected")}</button>
          <label>
            <span className="m2-sr">{t("Snooze for")}</span>
            <select value={days} onChange={(ev) => setDays(Number(ev.target.value))}>
              {[1, 7, 30].map((d) => <option key={d} value={d}>{t("{n, plural, one {# day} other {# days}}", { n: d })}</option>)}
            </select>
          </label>
          <button type="button" className="m2-btn m2-sm" disabled={busy} onClick={() => snz.mutate()}>{t("Snooze")}</button>
        </div>
      ) : null}
    </Panel>
  );
}
