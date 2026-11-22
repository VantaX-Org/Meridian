"use client";

/**
 * The top of the compare route: two runs of one object, the scores side by side on the ruler, the six dimensions and the
 * rules that moved. Read from GET /runs/compare; a figure that endpoint cannot supply is left out.
 */
import { useMultiCompare } from "@/lib/api/next/runs";
import { DIMENSIONS } from "@/lib/api/v2/types";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { Card, FieldChip, ScoreRuler, Skeleton, StatTile, useAletheiaScope } from "@/ui/kit";
import { compactCount, score, signed } from "../object/format";
import { answer } from "./answers";
import { moduleText } from "@/lib/v2/labels";
import "./runsboard.css";

const GATE = 85;
const labels = () => ({ atRisk: t("At risk"), go: t("Go"), cap70: t("Cap at 70"), cap85: t("Cap at 85"), measured: (n: number) => t("Measured {n}", { n }) });

export function CompareBoard({ a, b, module }: { a: string; b: string; module: string | null }) {
  useInterfaceLang();
  const q = useMultiCompare([a, b], module);
  const d = q.data;
  const [ra, rb] = d?.runs ?? [];
  const name = (r?: { run_number: number | null }) => (r?.run_number != null ? t("Run {n}", { n: r.run_number }) : t("Run"));
  const failing = (i: number) => (d?.rules ?? []).reduce((n, r) => n + (r.failing[i] ?? 0), 0);
  const moved = (d?.rules ?? []).map((r) => ({ r, delta: (r.failing[1] ?? 0) - (r.failing[0] ?? 0), ok: r.failing[0] != null && r.failing[1] != null }))
    .filter((x) => x.ok && x.delta !== 0).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)).slice(0, 8);
  const biggest = Math.max(1, ...moved.map((x) => Math.abs(x.delta)));
  const net = moved.reduce((n, x) => n + x.delta, 0);

  useAletheiaScope({
    key: `compare-board:${a}:${b}`, label: t("Asking about these runs"),
    suggestions: ra && rb ? [t("What changed in {run}?", { run: name(rb) })] : [],
    answer: (prompt) => {
      if (!rb || prompt !== t("What changed in {run}?", { run: name(rb) })) return null;
      const top = moved[0];
      return answer(top ? t("{rule} moved most: {change} failing records.", { rule: top.r.check_id, change: signed(top.delta) }) : t("No rule moved between these two runs."), moved.slice(0, 3).map((x) => `${x.r.check_id}: ${signed(x.delta)}`));
    },
  });

  if (!module) return null;
  if (q.isLoading) return <Skeleton lines={5} label={t("Loading the comparison")} />;
  if (!d || !ra || !rb) return null;

  const dimRows = DIMENSIONS.map((dim) => ({ dim, x: ra.dimension_scores[dim.key], y: rb.dimension_scores[dim.key] })).filter((r) => r.x != null && r.y != null);
  const mark = (r: typeof ra, id: string) => ({ id, label: name(r), shown: r.score ?? r.raw_score ?? 0, measured: r.raw_score });
  const recDelta = ra.records_checked != null && rb.records_checked != null ? rb.records_checked - ra.records_checked : null;
  const shownA = ra.score ?? ra.raw_score, shownB = rb.score ?? rb.raw_score;

  return (
    <section className="rn-cmp" aria-label={t("Comparing {a} to {b}", { a: name(ra), b: name(rb) })} data-testid="compare-board">
      <dl className="mx-tiles">
        {shownA != null && shownB != null && <StatTile label={t("Shown score")} value={`${score(shownA)} ${t("to")} ${score(shownB)}`} />}
        {ra.raw_score != null && rb.raw_score != null && <StatTile label={t("Measured score")} value={`${score(ra.raw_score)} ${t("to")} ${score(rb.raw_score)}`} note={signed(rb.raw_score - ra.raw_score)} />}
        {recDelta !== null && <StatTile label={t("Records")} value={`${compactCount(ra.records_checked as number)} ${t("to")} ${compactCount(rb.records_checked as number)}`} note={signed(recDelta)} />}
        {d.rules.length > 0 && <StatTile label={t("Failing records")} value={`${compactCount(failing(0))} ${t("to")} ${compactCount(failing(1))}`} note={signed(failing(1) - failing(0))} />}
      </dl>
      {ra.score != null || ra.raw_score != null ? (
        <Card title={t("{object}: {a} and {b}", { object: moduleText(module), a: name(ra), b: name(rb) })} sub={t("Solid is the shown score, hollow the measured score.")}>
          <ScoreRuler marks={[mark(ra, "a"), mark(rb, "b")]} labels={labels()} ariaLabel={t("Score of {a} and {b} on the ruler", { a: name(ra), b: name(rb) })} showName />
        </Card>
      ) : null}
      {dimRows.length > 0 && (
        <Card title={t("Six dimensions")} sub={t("{a} above the line, {b} below. The 85 gate is the line.", { a: name(ra), b: name(rb) })}>
          <ul className="rn-cmp-dims">
            {dimRows.map(({ dim, x, y }) => (
              <li key={dim.key} className="rn-cmp-dim" data-testid="compare-dim">
                <span>{dim.label}</span>
                <span className="rn-cmp-track" role="img" aria-label={t("{dim}: {x} to {y}", { dim: dim.label, x: score(x), y: score(y) })}>
                  <i data-side="a" style={{ inset: "0 auto 50% 0", inlineSize: `${x}%` }} />
                  <i data-side="b" style={{ inset: "50% auto 0 0", inlineSize: `${y}%` }} />
                  <b style={{ insetInlineStart: `${GATE}%` }} />
                </span>
                <span className="mx-num">{score(x)} {t("to")} {score(y)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title={t("Rules that moved")} sub={t("Failing records, fewer left, more right")}>
        {moved.length === 0 ? <p className="mx-muted">{t("No rule moved between these two runs.")}</p> : (
          <>
            <ul className="rn-cmp-rules">
              {moved.map(({ r, delta }) => (
                <li key={r.check_id} className="rn-cmp-rule" data-testid="compare-moved">
                  <FieldChip code={r.check_id} description={r.title ?? ""} />
                  <span className="rn-cmp-axis" aria-hidden="true">
                    <i className="rn-cmp-bar" data-dir={delta > 0 ? "up" : "down"} style={delta > 0 ? { insetInlineStart: "50%", inlineSize: `${(delta / biggest) * 50}%` } : { insetInlineEnd: "50%", inlineSize: `${(-delta / biggest) * 50}%` }} />
                  </span>
                  <span className="mx-num">{signed(delta)}</span>
                </li>
              ))}
            </ul>
            <p className="mx-muted" data-testid="compare-net">{net <= 0 ? t("Net {n, plural, one {# failing record} other {# failing records}} fewer.", { n: -net }) : t("Net {n, plural, one {# failing record} other {# failing records}} more.", { n: net })}</p>
          </>
        )}
      </Card>
    </section>
  );
}
