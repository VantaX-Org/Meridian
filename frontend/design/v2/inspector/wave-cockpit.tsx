"use client";

import { useState } from "react";
import type { DestScoreContributor, MigrationWave, WaveBlocker, WaveForecast, WaveVerdict } from "@/types/api";
import type { GateCheck } from "@/lib/api/v2/roles";
import { useWaveGates } from "@/lib/v2/roles-queries";
import * as rep from "@/lib/api/v2/reports";
import { useWaveCockpit } from "@/lib/v2/admin-queries";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { f1, int } from "@/lib/v2/score";
import { cockpitVerdict } from "@/lib/v2/waves";
import { VerdictMark } from "../marks";
import { Coded, Dash, EmptyFrame, ErrorFrame, Skeleton, V2Link } from "../parts";
import { gapText } from "../screens/Migration";
import { Sev } from "./rule";
import { ResultFrame, useOutcome } from "./shared";
import "../roles.css";

const VERDICT_WORD: Record<WaveVerdict, () => string> = {
  go: () => t("Ready"),
  at_risk: () => t("At risk"),
  no_go: () => t("Blocked"),
};

const MOVE_WORD: Record<DestScoreContributor["kind"], () => string> = {
  dropped: () => t("Field not migrated"),
  target: () => t("Target rule"),
  gap: () => t("Migration gap"),
};

const GATE_WORD: Record<GateCheck["key"], () => string> = {
  min_score: () => t("Lowest object score"),
  zero_criticals: () => t("Critical rules failing"),
  contracts_met: () => t("Contracts met"),
};

/** One gate criterion as actual against threshold, with the evidence behind it (governance.py /waves/gates). */
function GateEvidenceRow({ c }: { c: GateCheck }) {
  const items = c.items ?? [];
  const max = c.key === "min_score" ? 100 : c.key === "contracts_met" ? Math.max(c.threshold ?? 0, 1) : Math.max(c.actual ?? 0, 1);
  return (
    <li data-testid={`gate-evidence-${c.key}`}>
      <VerdictMark verdict={c.passed ? "go" : "no-go"} />
      <span>
        {GATE_WORD[c.key]()}{" "}
        <span className="m2-meta">
          {t("{actual} against {threshold}", { actual: c.actual == null ? "—" : c.key === "min_score" ? f1(c.actual) : int(c.actual), threshold: c.threshold == null ? "—" : c.key === "min_score" ? f1(c.threshold) : int(c.threshold) })}
        </span>
      </span>
      {c.key !== "zero_criticals" ? (
        <meter min={0} max={max} value={c.actual ?? 0} low={c.key === "min_score" ? (c.threshold ?? 0) : undefined} optimum={max} aria-label={GATE_WORD[c.key]()} />
      ) : null}
      {c.key === "min_score" && items.length ? (
        <ul className="m2-gate-ev-items">
          {items.map((i) => (
            <li key={i.module}>
              <span>{i.module ? moduleText(i.module) : <Dash />}</span>
              <meter min={0} max={100} value={i.actual ?? 0} low={i.threshold} optimum={100} aria-label={t("{name}: score against the gate", { name: i.module ? moduleText(i.module) : "" })} />
              <span className="m2-meta">{i.actual == null ? t("not measured") : f1(i.actual)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {c.key === "zero_criticals" && items.length ? (
        <ul className="m2-gate-ev-items" aria-label={t("Top failing critical rules")}>
          {items.map((i) => (
            <li key={`${i.module}:${i.check_id}`}>
              <Coded code={i.check_id ?? ""} text={i.message} first />
              <span>{i.field ? <Coded code={i.field} text={i.field_description} first /> : <Dash />}</span>
              <span className="m2-meta">{t("{n, plural, one {# system} other {# systems}}", { n: i.cells ?? 0 })}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {c.key === "contracts_met" && items.length ? (
        <ul className="m2-gate-ev-items">
          {items.map((i) => (
            <li key={i.name}>
              <VerdictMark verdict={i.passed ? "go" : "no-go"} />
              <span>{i.name}</span>
              <span className="m2-meta">{i.passed ? t("Met") : t("Not met or never checked")}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function forecastText(f: WaveForecast): string {
  if (f.status === "passing") return t("No blocking findings in the latest run, so the gate's blocking criterion is met.");
  if (f.status === "no_trend") return t("No trend yet: two analysed runs are needed to project when the gate passes.");
  if (f.status === "not_converging")
    return t("Not converging: blocking findings are not falling across the last {n, plural, one {# run} other {# runs}}, so no pass date can be projected.", { n: f.runs_used });
  return t("At the current pace the blocking findings reach zero by {date}, a straight line fitted to {n, plural, one {# run} other {# runs}} ({latest} in the latest).", {
    date: f.projected_date ?? "—",
    n: f.runs_used,
    latest: int(f.latest ?? 0),
  });
}

/** The gate's criteria as actual against threshold, and when the wave is projected to pass. */
function GateEvidence({ waveId, forecast }: { waveId: string; forecast?: WaveForecast }) {
  const gates = useWaveGates();
  const g = gates.data?.gates.find((x) => x.wave_id === waveId);
  return (
    <div data-testid="gate-evidence">
      <h4>{t("Gate evidence")}</h4>
      {g && g.gate.configured && g.status.checks.length ? (
        <ul className="m2-gate-list m2-gate-ev">
          {g.status.checks.map((c) => (
            <GateEvidenceRow key={c.key} c={c} />
          ))}
        </ul>
      ) : (
        <p className="m2-meta">{t("No gate yet: a wave without one moves on its verdict alone.")}</p>
      )}
      {forecast ? (
        <p className="m2-prov" data-testid="gate-forecast" data-status={forecast.status}>
          {forecastText(forecast)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A wave's readiness cockpit, inside the wave inspector: analyse the whole wave, read each object's verdict and the
 * blockers holding it, download the report, draft a fix batch for a blocker (migration.py /waves/{id}/...).
 */
export function WaveCockpitBlock({ wave }: { wave: MigrationWave }) {
  const session = useV2Session();
  const { outcome, pending, run } = useOutcome();
  const cockpit = useWaveCockpit(wave.id);
  const canAnalyse = session.can("analyse") && !session.shared && !session.viewAs;
  const analyse = () =>
    void run("analyse", async () => {
      const r = await rep.runWave(wave.id);
      setBatch(null);
      return {
        tone: "ok",
        title: t("Analysis of {name} queued", { name: wave.name }),
        detail: t("{n, plural, one {# object is} other {# objects are}} being analysed. The verdicts update when it finishes.", { n: r.modules.length }),
      };
    });
  const c = cockpit.data;
  const moves = (c?.objects ?? []).flatMap((o) => (o.dest_contributors ?? []).map((x) => ({ module: o.module, x })));
  const canExport = session.can("export");
  const canFix = session.can("apply") && !session.shared && !session.viewAs;
  const { hrefFor } = useOpenItem();
  const [batch, setBatch] = useState<string | null>(null);
  const draft = (b: WaveBlocker) =>
    void run(`fix:${b.module}:${b.gap_type}:${b.field ?? ""}`, async () => {
      const r = await rep.draftBlockerFixBatch(wave.id, { module: b.module, gap_type: b.gap_type, field: b.field });
      setBatch(r.id);
      return {
        tone: "ok",
        title: t("Fix batch drafted for {gap}", { gap: gapText(b.gap_type) }),
        detail: t("{n, plural, one {# record is} other {# records are}} in the batch, {p} with a proposed fix. Review it before anything is changed.", { n: r.items, p: r.with_proposal }),
      };
    });
  const download = (fmt: rep.WaveReportFormat) =>
    void run(`report:${fmt}`, async () => {
      const name = await rep.downloadWaveReport(wave.id, fmt);
      return { tone: "ok", title: t("Readiness report saved"), detail: name };
    });
  return (
    <div data-testid="wave-cockpit">
      {canAnalyse ? (
        <button type="button" className="m2-btn m2-sm" disabled={pending !== null || wave.modules.length === 0 || !wave.source_system_id} onClick={analyse}>
          {pending === "analyse" ? t("Queuing…") : t("Analyse the whole wave")}
        </button>
      ) : null}
      {canExport && c?.run_id
        ? (["xlsx", "pdf"] as const).map((fmt) => (
            <button key={fmt} type="button" className="m2-btn m2-sm" disabled={pending !== null} onClick={() => download(fmt)}>
              {pending === `report:${fmt}` ? t("Preparing…") : fmt === "xlsx" ? t("Download the report as Excel") : t("Download the report as PDF")}
            </button>
          ))
        : null}
      {outcome ? (
        <ResultFrame outcome={outcome}>
          <span>
            {batch ? <V2Link href={hrefFor({ kind: "batch", id: batch })}>{t("Open the fix batch")}</V2Link> : <V2Link href="/migration">{t("Open the migration analyses")}</V2Link>}
          </span>
        </ResultFrame>
      ) : null}
      {cockpit.isLoading ? <Skeleton width="100%" height={60} /> : null}
      {cockpit.isError ? <ErrorFrame onRetry={() => void cockpit.refetch()}>{t("The wave cockpit could not be read.")}</ErrorFrame> : null}
      {c && !c.run_id ? <EmptyFrame>{t("This wave has not been analysed yet. Analyse the whole wave to see each object's verdict.")}</EmptyFrame> : null}
      {c && c.run_id ? (
        <>
          <p className="m2-prov">
            {t("Readiness {score} against a threshold of {threshold}. {blocked} of {total} records are blocked.", {
              score: c.score == null ? "—" : f1(c.score),
              threshold: c.threshold == null ? "—" : f1(c.threshold),
              blocked: int(c.records_blocked),
              total: int(c.records_total),
            })}
          </p>
          <GateEvidence waveId={wave.id} forecast={c.forecast} />
          <div className="m2-frame" tabIndex={0} style={{ maxHeight: 240 }}>
            <table className="m2-tbl" aria-label={t("Readiness by object")}>
              <thead>
                <tr>
                  <th scope="col">{t("Object")}</th>
                  <th scope="col">{t("Verdict")}</th>
                  <th scope="col">{t("Readiness")}</th>
                  <th scope="col">{t("Quality score at source")}</th>
                  <th scope="col">{t("Projected in target")}</th>
                  <th scope="col">{t("Measured in target")}</th>
                  <th scope="col">{t("Records")}</th>
                  <th scope="col">{t("Blocked")}</th>
                  <th scope="col">{t("Blockers")}</th>
                </tr>
              </thead>
              <tbody>
                {c.objects.map((o) => {
                  const v = cockpitVerdict(o.verdict);
                  return (
                    <tr key={o.module}>
                      <th scope="row">{moduleText(o.module)}</th>
                      <td className="m2-ck-heat" data-band={v.band}>
                        <VerdictMark verdict={v.verdict} /> {VERDICT_WORD[o.verdict]()}
                      </td>
                      <td>{o.score == null ? <Dash /> : f1(o.score)}</td>
                      <td>{o.dqs == null ? <Dash /> : f1(o.dqs)}</td>
                      <td>{o.dest_dqs_projected == null ? <Dash /> : f1(o.dest_dqs_projected)}</td>
                      <td>{o.dest_dqs_actual == null ? <Dash /> : f1(o.dest_dqs_actual)}</td>
                      <td>{int(o.records)}</td>
                      <td>{int(o.records_blocked)}</td>
                      <td>{int(o.blocker_count)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <h4>{t("What moves the quality score in the target")}</h4>
          {moves.length === 0 ? (
            <EmptyFrame>
              {c.objects.some((o) => o.dest_dqs_projected != null)
                ? t("No rule or gap moves the quality score between source and target.")
                : t("The quality score in the target shape is projected on the next analysis of the wave.")}
            </EmptyFrame>
          ) : (
            <div className="m2-frame" tabIndex={0} style={{ maxHeight: 240 }}>
              <table className="m2-tbl" aria-label={t("Rules and gaps that move the quality score in the target")}>
                <thead>
                  <tr>
                    <th scope="col">{t("Object")}</th>
                    <th scope="col">{t("Rule")}</th>
                    <th scope="col">{t("Field")}</th>
                    <th scope="col">{t("Severity")}</th>
                    <th scope="col">{t("Change")}</th>
                    <th scope="col">{t("Records")}</th>
                  </tr>
                </thead>
                <tbody>
                  {moves.map(({ module, x }) => (
                    <tr key={`${module}:${x.check_id}`}>
                      <th scope="row">{moduleText(module)}</th>
                      <td>
                        <Coded code={x.check_id.split(":")[0]} text={x.description} first />
                      </td>
                      <td>{x.field ? <Coded code={x.field} text={x.field_description} first /> : <Dash />}</td>
                      <td>
                        <Sev severity={x.severity} />
                      </td>
                      <td>{MOVE_WORD[x.kind]()}</td>
                      <td>{int(x.dest_affected ?? x.source_affected ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h4>{t("Blockers")}</h4>
          {c.blockers.length === 0 ? (
            <EmptyFrame>{t("Nothing blocks this wave.")}</EmptyFrame>
          ) : (
            <div className="m2-frame" tabIndex={0} style={{ maxHeight: 240 }}>
              <table className="m2-tbl" aria-label={t("Blockers of the wave")}>
                <thead>
                  <tr>
                    <th scope="col">{t("Object")}</th>
                    <th scope="col">{t("Gap")}</th>
                    <th scope="col">{t("Field")}</th>
                    <th scope="col">{t("Severity")}</th>
                    <th scope="col">{t("Records")}</th>
                    <th scope="col">{t("Gaps")}</th>
                    {canFix ? <th scope="col">{t("Fix")}</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {c.blockers.map((b) => (
                    <tr key={`${b.module}:${b.gap_type}:${b.field ?? ""}`}>
                      <th scope="row">{moduleText(b.module)}</th>
                      <td>{gapText(b.gap_type)}</td>
                      <td>{b.field ? <Coded code={b.field} /> : <Dash />}</td>
                      <td>
                        <Sev severity={b.severity} />
                      </td>
                      <td>{int(b.records)}</td>
                      <td>{int(b.gaps)}</td>
                      {canFix ? (
                        <td>
                          <button type="button" className="m2-btn m2-sm" disabled={pending !== null} onClick={() => draft(b)}>
                            {pending === `fix:${b.module}:${b.gap_type}:${b.field ?? ""}` ? t("Drafting…") : t("Draft a fix batch")}
                          </button>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
