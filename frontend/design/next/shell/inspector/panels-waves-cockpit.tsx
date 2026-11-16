"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { DestScoreContributor, MigrationWave, WaveBlocker, WaveForecast, WaveVerdict } from "@/types/api";
import { putWaveGate, type GateCheck, type WaveGate } from "@/lib/api/v2/roles";
import * as rep from "@/lib/api/v2/reports";
import { useWaveCockpit } from "@/lib/v2/admin-queries";
import { failureText } from "@/lib/v2/errors";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { gapText, moduleText } from "@/lib/v2/labels";
import { notFound, refreshRoles, useWaveGates } from "@/lib/v2/roles-queries";
import { useCertificates } from "@/lib/v2/step9-queries";
import { f1, int } from "@/lib/v2/score";
import { cockpitVerdict } from "@/lib/v2/waves";
import { SeverityMark, type SeverityKey } from "@/design/v2/marks";
import { V2Link } from "@/design/v2/parts";
import { Button, Chip, Code, EmptyState, ErrorState, Skeleton } from "../../kit";
import { Dash, Result, useOutcome } from "./panels-kit";

/** Go or no-go as a chip: shape and word, never colour alone (replaces the v2 VerdictMark). */
function Verdict({ passed, word }: { passed: boolean; word?: string }) {
  return <Chip tone={passed ? "good" : "bad"}>{word ?? (passed ? t("Met") : t("Not met"))}</Chip>;
}

const SEV_WORD: Record<string, () => string> = { critical: () => t("Critical"), high: () => t("High"), medium: () => t("Medium"), low: () => t("Low"), info: () => t("Info") };

function Sev({ severity }: { severity: string | null | undefined }) {
  if (!severity) return <Dash why={t("No severity")} />;
  return (
    <span className="nx-pn-row">
      <SeverityMark severity={severity as SeverityKey} />
      {SEV_WORD[severity]?.() ?? severity}
    </span>
  );
}

// ── the wave gate (v2 governance WaveGateEditor) ───────────────────────────────

export function WaveGateEditor({ waveId }: { waveId: string }) {
  const q = useWaveGates();
  const g = q.data?.gates.find((x) => x.wave_id === waveId);
  if (q.isError) return notFound(q.error) ? <Dash why={t("Wave gates are not available on this server yet")} /> : <p className="nx-pn-meta">{t("The gate could not be read.")}</p>;
  if (!g) return null;
  return <GateForm key={g.gate.updated_at ?? "none"} g={g} />;
}

function GateForm({ g }: { g: WaveGate }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const { hrefFor } = useOpenItem();
  const [min, setMin] = useState<string>(g.gate.min_score === null ? "" : String(g.gate.min_score));
  const [zero, setZero] = useState(g.gate.zero_criticals);
  const [contracts, setContracts] = useState(g.gate.contracts_met);
  const [error, setError] = useState<string | null>(null);
  const cert = useCertificates(g.wave_id).data;
  const latest = cert?.versions[0];
  const canEdit = session.can("analyse") && !session.shared && !session.viewAs;
  const save = async () => {
    setError(null);
    try {
      await putWaveGate(g.wave_id, { min_score: min === "" ? null : Number(min), zero_criticals: zero, contracts_met: contracts });
      await refreshRoles(qc, "gates");
    } catch (e) {
      setError(failureText(e));
    }
  };
  return (
    <div className="nx-pn-form" data-testid="wave-gate">
      <span className="nx-pn-meta">{t("Gate")}</span>
      {g.gate.configured ? (
        <ul className="nx-ib-list" data-testid="gate-checks">
          {g.status.checks.map((c) => (
            <li key={c.key} className="nx-pn-row">
              <Verdict passed={c.passed} />
              <span>{c.label}</span>
              <span className="nx-pn-meta">{c.detail}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="nx-pn-meta">{t("No gate yet: a wave without one moves on its verdict alone.")}</p>
      )}
      {canEdit ? (
        <span className="nx-pn-row">
          <label className="nx-pn-row">
            <span className="nx-pn-meta">{t("Min score")}</span>
            <input type="number" min={0} max={100} value={min} onChange={(e) => setMin(e.target.value)} aria-label={t("{name}: minimum score", { name: g.name })} />
          </label>
          <label className="nx-pn-opt">
            <input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} />
            <span>{t("Zero criticals")}</span>
          </label>
          <label className="nx-pn-opt">
            <input type="checkbox" checked={contracts} onChange={(e) => setContracts(e.target.checked)} />
            <span>{t("Contracts met")}</span>
          </label>
          <Button variant="secondary" size={32} onClick={() => void save()}>
            {t("Save the gate")}
          </Button>
        </span>
      ) : null}
      <span className="nx-pn-meta">
        {t("Readiness certificate: {value}.", { value: latest ? (latest.status === "signed" ? t("Version {version}, signed", { version: latest.version }) : t("Version {version}, waiting for signatures", { version: latest.version })) : cert ? t("Not issued") : t("not yet") })}{" "}
        <V2Link href={hrefFor({ kind: "certificate", id: g.wave_id })}>{t("Open the certificate")}</V2Link>
      </span>
      {error ? (
        <span className="nx-pn-err" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

// ── the readiness cockpit (v2 wave-cockpit WaveCockpitBlock) ───────────────────

const VERDICT_WORD: Record<WaveVerdict, () => string> = { go: () => t("Ready"), at_risk: () => t("At risk"), no_go: () => t("Blocked") };
const MOVE_WORD: Record<DestScoreContributor["kind"], () => string> = { dropped: () => t("Field not migrated"), target: () => t("Target rule"), gap: () => t("Migration gap") };
const GATE_WORD: Record<GateCheck["key"], () => string> = { min_score: () => t("Lowest object score"), zero_criticals: () => t("Critical rules failing"), contracts_met: () => t("Contracts met") };

function GateEvidenceRow({ c }: { c: GateCheck }) {
  const items = c.items ?? [];
  const max = c.key === "min_score" ? 100 : c.key === "contracts_met" ? Math.max(c.threshold ?? 0, 1) : Math.max(c.actual ?? 0, 1);
  return (
    <li data-testid={`gate-evidence-${c.key}`} className="nx-ib-row">
      <span className="nx-pn-row">
        <Verdict passed={c.passed} />
        {GATE_WORD[c.key]()}
        <span className="nx-pn-meta">
          {t("{actual} against {threshold}", { actual: c.actual == null ? "—" : c.key === "min_score" ? f1(c.actual) : int(c.actual), threshold: c.threshold == null ? "—" : c.key === "min_score" ? f1(c.threshold) : int(c.threshold) })}
        </span>
      </span>
      {c.key !== "zero_criticals" ? <meter min={0} max={max} value={c.actual ?? 0} low={c.key === "min_score" ? (c.threshold ?? 0) : undefined} optimum={max} aria-label={GATE_WORD[c.key]()} /> : null}
      {c.key === "min_score" && items.length ? (
        <ul className="nx-ib-list">
          {items.map((i) => (
            <li key={i.module} className="nx-pn-row">
              <span>{i.module ? moduleText(i.module) : <Dash why={t("No object")} />}</span>
              <meter min={0} max={100} value={i.actual ?? 0} low={i.threshold} optimum={100} aria-label={t("{name}: score against the gate", { name: i.module ? moduleText(i.module) : "" })} />
              <span className="nx-pn-meta">{i.actual == null ? t("not measured") : f1(i.actual)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {c.key === "zero_criticals" && items.length ? (
        <ul className="nx-ib-list" aria-label={t("Top failing critical rules")}>
          {items.map((i) => (
            <li key={`${i.module}:${i.check_id}`} className="nx-pn-row">
              <Code code={i.check_id ?? ""} text={i.message} />
              <span>{i.field ? <Code code={i.field} text={i.field_description} /> : <Dash why={t("No field")} />}</span>
              <span className="nx-pn-meta">{t("{n, plural, one {# system} other {# systems}}", { n: i.cells ?? 0 })}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {c.key === "contracts_met" && items.length ? (
        <ul className="nx-ib-list">
          {items.map((i) => (
            <li key={i.name} className="nx-pn-row">
              <Verdict passed={!!i.passed} />
              <span>{i.name}</span>
              <span className="nx-pn-meta">{i.passed ? t("Met") : t("Not met or never checked")}</span>
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
  if (f.status === "not_converging") return t("Not converging: blocking findings are not falling across the last {n, plural, one {# run} other {# runs}}, so no pass date can be projected.", { n: f.runs_used });
  return t("At the current pace the blocking findings reach zero by {date}, a straight line fitted to {n, plural, one {# run} other {# runs}} ({latest} in the latest).", { date: f.projected_date ?? "—", n: f.runs_used, latest: int(f.latest ?? 0) });
}

function GateEvidence({ waveId, forecast }: { waveId: string; forecast?: WaveForecast }) {
  const gates = useWaveGates();
  const g = gates.data?.gates.find((x) => x.wave_id === waveId);
  return (
    <div data-testid="gate-evidence">
      <h4>{t("Gate evidence")}</h4>
      {g && g.gate.configured && g.status.checks.length ? (
        <ul className="nx-ib-list">
          {g.status.checks.map((c) => (
            <GateEvidenceRow key={c.key} c={c} />
          ))}
        </ul>
      ) : (
        <p className="nx-pn-meta">{t("No gate yet: a wave without one moves on its verdict alone.")}</p>
      )}
      {forecast ? (
        <p className="nx-pn-note" data-testid="gate-forecast" data-status={forecast.status}>
          {forecastText(forecast)}
        </p>
      ) : null}
    </div>
  );
}

const num = (v: number | null | undefined) => (v == null ? <Dash why={t("Not measured")} /> : f1(v));

export function WaveCockpitBlock({ wave }: { wave: MigrationWave }) {
  const session = useV2Session();
  const { outcome, pending, run } = useOutcome();
  const cockpit = useWaveCockpit(wave.id);
  const { hrefFor } = useOpenItem();
  const [batch, setBatch] = useState<string | null>(null);
  const canAnalyse = session.can("analyse") && !session.shared && !session.viewAs;
  const canExport = session.can("export");
  const canFix = session.can("apply") && !session.shared && !session.viewAs;
  const c = cockpit.data;
  const moves = (c?.objects ?? []).flatMap((o) => (o.dest_contributors ?? []).map((x) => ({ module: o.module, x })));
  const analyse = () =>
    void run("analyse", async () => {
      const r = await rep.runWave(wave.id);
      setBatch(null);
      return { tone: "ok", title: t("Analysis of {name} queued", { name: wave.name }), detail: t("{n, plural, one {# object is} other {# objects are}} being analysed. The verdicts update when it finishes.", { n: r.modules.length }) };
    });
  const draft = (b: WaveBlocker) =>
    void run(`fix:${b.module}:${b.gap_type}:${b.field ?? ""}`, async () => {
      const r = await rep.draftBlockerFixBatch(wave.id, { module: b.module, gap_type: b.gap_type, field: b.field });
      setBatch(r.id);
      return { tone: "ok", title: t("Fix batch drafted for {gap}", { gap: gapText(b.gap_type) }), detail: t("{n, plural, one {# record is} other {# records are}} in the batch, {p} with a proposed fix. Review it before anything is changed.", { n: r.items, p: r.with_proposal }) };
    });
  const download = (fmt: rep.WaveReportFormat) =>
    void run(`report:${fmt}`, async () => {
      const name = await rep.downloadWaveReport(wave.id, fmt);
      return { tone: "ok", title: t("Readiness report saved"), detail: name };
    });
  return (
    <div className="nx-pn-form" data-testid="wave-cockpit">
      <div className="nx-pn-row">
        {canAnalyse ? (
          <Button variant="secondary" size={32} disabled={pending !== null || wave.modules.length === 0 || !wave.source_system_id} loading={pending === "analyse"} loadingLabel={t("Queuing…")} onClick={analyse}>
            {t("Analyse the whole wave")}
          </Button>
        ) : null}
        {canExport && c?.run_id
          ? (["xlsx", "pdf"] as const).map((fmt) => (
              <Button key={fmt} variant="secondary" size={32} disabled={pending !== null} loading={pending === `report:${fmt}`} loadingLabel={t("Preparing…")} onClick={() => download(fmt)}>
                {fmt === "xlsx" ? t("Download the report as Excel") : t("Download the report as PDF")}
              </Button>
            ))
          : null}
      </div>
      <Result outcome={outcome}>
        {batch ? <V2Link href={hrefFor({ kind: "batch", id: batch })}>{t("Open the fix batch")}</V2Link> : <V2Link href="/migration">{t("Open the migration analyses")}</V2Link>}
      </Result>
      {cockpit.isLoading ? <Skeleton lines={3} label={t("Readiness cockpit")} /> : null}
      {cockpit.isError ? <ErrorState sentence={t("The wave cockpit could not be read.")} error={cockpit.error} onRetry={() => void cockpit.refetch()} /> : null}
      {c && !c.run_id ? <EmptyState heading={t("This wave has not been analysed yet. Analyse the whole wave to see each object's verdict.")} /> : null}
      {c && c.run_id ? (
        <>
          <p className="nx-pn-note">
            {t("Readiness {score} against a threshold of {threshold}. {blocked} of {total} records are blocked.", { score: c.score == null ? "—" : f1(c.score), threshold: c.threshold == null ? "—" : f1(c.threshold), blocked: int(c.records_blocked), total: int(c.records_total) })}
          </p>
          <GateEvidence waveId={wave.id} forecast={c.forecast} />
          <div className="nx-pn-scroll" tabIndex={0}>
            <table className="nx-pn-table" aria-label={t("Readiness by object")}>
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
                      <td data-band={v.band}>
                        <Chip tone={v.verdict === "go" ? "good" : o.verdict === "at_risk" ? "warn" : "bad"}>{VERDICT_WORD[o.verdict]()}</Chip>
                      </td>
                      <td className="nx-pn-num">{num(o.score)}</td>
                      <td className="nx-pn-num">{num(o.dqs)}</td>
                      <td className="nx-pn-num">{num(o.dest_dqs_projected)}</td>
                      <td className="nx-pn-num">{num(o.dest_dqs_actual)}</td>
                      <td className="nx-pn-num">{int(o.records)}</td>
                      <td className="nx-pn-num">{int(o.records_blocked)}</td>
                      <td className="nx-pn-num">{int(o.blocker_count)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <h4>{t("What moves the quality score in the target")}</h4>
          {moves.length === 0 ? (
            <EmptyState heading={c.objects.some((o) => o.dest_dqs_projected != null) ? t("No rule or gap moves the quality score between source and target.") : t("The quality score in the target shape is projected on the next analysis of the wave.")} />
          ) : (
            <div className="nx-pn-scroll" tabIndex={0}>
              <table className="nx-pn-table" aria-label={t("Rules and gaps that move the quality score in the target")}>
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
                        <Code code={x.check_id.split(":")[0]} text={x.description} />
                      </td>
                      <td>{x.field ? <Code code={x.field} text={x.field_description} /> : <Dash why={t("No field")} />}</td>
                      <td>
                        <Sev severity={x.severity} />
                      </td>
                      <td>{MOVE_WORD[x.kind]()}</td>
                      <td className="nx-pn-num">{int(x.dest_affected ?? x.source_affected ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h4>{t("Blockers")}</h4>
          {c.blockers.length === 0 ? (
            <EmptyState heading={t("Nothing blocks this wave.")} />
          ) : (
            <div className="nx-pn-scroll" tabIndex={0}>
              <table className="nx-pn-table" aria-label={t("Blockers of the wave")}>
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
                  {c.blockers.map((b) => {
                    const key = `fix:${b.module}:${b.gap_type}:${b.field ?? ""}`;
                    return (
                      <tr key={key}>
                        <th scope="row">{moduleText(b.module)}</th>
                        <td>{gapText(b.gap_type)}</td>
                        <td>{b.field ? <Code code={b.field} /> : <Dash why={t("No field")} />}</td>
                        <td>
                          <Sev severity={b.severity} />
                        </td>
                        <td className="nx-pn-num">{int(b.records)}</td>
                        <td className="nx-pn-num">{int(b.gaps)}</td>
                        {canFix ? (
                          <td>
                            <Button variant="secondary" size={32} disabled={pending !== null} loading={pending === key} loadingLabel={t("Drafting…")} onClick={() => draft(b)}>
                              {t("Draft a fix batch")}
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
