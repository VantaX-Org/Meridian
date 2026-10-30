"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { extractDelta, extractionDryRun, putEscalationChain, putWaveGate, type DryRun, type EscalationStep, type WaveGate } from "@/lib/api/v2/roles";
import { useAssignable } from "@/lib/v2/approvals-queries";
import { failureText } from "@/lib/v2/errors";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { notFound, refreshRoles, useEscalationChain, useWaveGates } from "@/lib/v2/roles-queries";
import { int } from "@/lib/v2/score";
import { VerdictMark } from "../marks";
import { Dash, Mono, Skeleton, V2Link } from "../parts";
import "../roles.css";
import { t as tr } from "@/lib/v2/i18n";

/**
 * Governance pieces dropped into existing inspectors with one line each (step 6c):
 *   EscalationChainEditor  the triage panel: the levels after the first escalation
 *   GateMark / WaveGateEditor  the Waves view and panel: a wave's gate criteria and whether it passes
 *   DryRunBlock            the System inspector: what an extraction would read, and a delta extraction
 */

// ── escalation chain ──────────────────────────────────────────────────────────

const TARGET: Record<EscalationStep["target"], string> = { get team_lead() { return tr("The team lead"); }, get fallback() { return tr("The fallback owner"); }, get user() { return tr("A person"); } };

export function EscalationChainEditor() {
  const qc = useQueryClient();
  const session = useV2Session();
  const q = useEscalationChain();
  const people = useAssignable(true);
  const [steps, setSteps] = useState<EscalationStep[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const canEdit = (session.can("manage_triage") || session.can("manage_settings") || session.can("manage_rules")) && !session.shared && !session.viewAs;
  const list = steps ?? q.data?.steps ?? [];
  const set = (i: number, patch: Partial<EscalationStep>) => setSteps(list.map((s, n) => (n === i ? { ...s, ...patch } : s)));
  const save = async () => {
    setError(null);
    setSaved(false);
    try {
      await putEscalationChain(list.map((s, i) => ({ ...s, level: i + 1, user_id: s.target === "user" ? s.user_id : null })));
      setSteps(null);
      setSaved(true);
      await refreshRoles(qc, "chain");
    } catch (e) {
      setError(failureText(e));
    }
  };
  return (
    <section className="m2-rsec" aria-label={tr("Escalation chain")} data-testid="escalation-chain">
      <h3>{tr("Escalation chain")}</h3>
      <p className="m2-meta">{tr("After a breach the assignee and the team lead hear first. Each level below notifies once more when a task stays past due that long.")}</p>
      {q.isError ? (
        <p className="m2-meta">{notFound(q.error) ? <Dash why={tr("The escalation chain is not available on this server yet")} /> : tr("The chain could not be read.")}</p>
      ) : !q.data ? (
        <Skeleton width="60%" height={12} />
      ) : (
        <>
          {list.length === 0 ? <p className="m2-meta">{tr("No further levels.")}</p> : null}
          <ol className="m2-hist">
            {list.map((s, i) => (
              <li key={i} data-testid="escalation-level">
                <span className="m2-meta">{tr("Level {count}", { count: i + 1 })}</span>
                {canEdit ? (
                  <span className="m2-gtools">
                    <label>
                      <span className="m2-meta">{tr("Hours past due")}{" "}</span>
                      <input type="number" min={0} value={Math.round(s.after_minutes / 60)} onChange={(e) => set(i, { after_minutes: Math.max(0, Number(e.target.value)) * 60 })} style={{ width: 64 }} aria-label={tr("Level {count}: hours past due", { count: i + 1 })} />
                    </label>
                    <select value={s.target} onChange={(e) => set(i, { target: e.target.value as EscalationStep["target"] })} aria-label={tr("Level {count}: who hears", { count: i + 1 })}>
                      {Object.entries(TARGET).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                    {s.target === "user" ? (
                      <select value={s.user_id ?? ""} onChange={(e) => set(i, { user_id: e.target.value || null })} aria-label={tr("Level {count}: person", { count: i + 1 })}>
                        <option value="">{tr("Choose")}</option>
                        {(people.data ?? []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <button type="button" className="m2-linkbtn2" onClick={() => setSteps(list.filter((_, n) => n !== i))}>
                      {tr("Remove")}
                    </button>
                  </span>
                ) : (
                  <span>{tr("{value} hours past due: {value2}", { value: Math.round(s.after_minutes / 60), value2: s.target === "user" ? (s.user_name ?? tr("a person")) : TARGET[s.target].toLowerCase() })}</span>
                )}
              </li>
            ))}
          </ol>
          {canEdit ? (
            <span className="m2-gtools">
              <button type="button" className="m2-btn m2-sm" disabled={list.length >= 5} onClick={() => setSteps([...list, { level: list.length + 1, after_minutes: (list[list.length - 1]?.after_minutes ?? 0) + 480, target: "fallback", user_id: null }])}>
                {tr("Add a level")}
              </button>
              <button type="button" className="m2-btn m2-sm m2-strong" disabled={steps === null} onClick={() => void save()}>
                {tr("Save the chain")}
              </button>
            </span>
          ) : (
            <p className="m2-meta">{tr("Changing the chain needs the manage triage permission.")}</p>
          )}
          {error ? (
            <p className="m2-err" role="alert">
              {error}
            </p>
          ) : null}
          {saved ? <p role="status">{tr("Saved. It applies from the next SLA sweep.")}</p> : null}
        </>
      )}
    </section>
  );
}

// ── wave gates ────────────────────────────────────────────────────────────────

/** The gate verdict of one wave in a word and a mark; a dash while there is no gate. */
export function GateMark({ waveId }: { waveId: string }) {
  const q = useWaveGates();
  const g = q.data?.gates.find((x) => x.wave_id === waveId);
  if (!g || !g.gate.configured) return null;
  return (
    <span className="m2-gate" data-testid="gate-mark" title={g.status.checks.map((c) => (c.passed ? tr("{label}: met", { label: c.label }) : `${c.label}: ${c.detail}`)).join(". ")}>
      <VerdictMark verdict={g.status.passed ? "go" : "no-go"} />
      {g.status.passed ? tr("Gate passed") : tr("Gate not passed, {filterCount} of {checksCount} not met", { filterCount: g.status.checks.filter((c) => !c.passed).length, checksCount: g.status.checks.length })}
    </span>
  );
}

function GateChecks({ g }: { g: WaveGate }) {
  return (
    <ul className="m2-gate-list" data-testid="gate-checks">
      {g.status.checks.map((c) => (
        <li key={c.key}>
          <VerdictMark verdict={c.passed ? "go" : "no-go"} />
          <span>{c.label}</span>
          <span className="m2-meta">{c.detail}</span>
        </li>
      ))}
    </ul>
  );
}

export function WaveGateEditor({ waveId }: { waveId: string }) {
  const q = useWaveGates();
  const g = q.data?.gates.find((x) => x.wave_id === waveId);
  if (q.isError) return notFound(q.error) ? <Dash why={tr("Wave gates are not available on this server yet")} /> : <p className="m2-meta">{tr("The gate could not be read.")}</p>;
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
    <div className="m2-wgate" data-testid="wave-gate">
      <span className="m2-meta">{tr("Gate")}</span>
      {g.gate.configured ? <GateChecks g={g} /> : <p className="m2-meta">{tr("No gate yet: a wave without one moves on its verdict alone.")}</p>}
      {canEdit ? (
        <span className="m2-gtools">
          <label>
            <span className="m2-meta">{tr("Min score")}{" "}</span>
            <input type="number" min={0} max={100} value={min} onChange={(e) => setMin(e.target.value)} style={{ width: 64 }} aria-label={tr("{name}: minimum score", { name: g.name })} />
          </label>
          <label className="m2-sw">
            <input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} />
            <span>{tr("Zero criticals")}</span>
          </label>
          <label className="m2-sw">
            <input type="checkbox" checked={contracts} onChange={(e) => setContracts(e.target.checked)} />
            <span>{tr("Contracts met")}</span>
          </label>
          <button type="button" className="m2-btn m2-sm" onClick={() => void save()}>
            {tr("Save the gate")}
          </button>
        </span>
      ) : null}
      <span className="m2-meta">
        {tr("Readiness certificate: {value}.", { value: g.status.passed ? tr("a draft is ready") : tr("not yet") })}{" "}
        <V2Link href={hrefFor({ kind: "certificate", id: g.wave_id })}>{tr("Open the certificate")}</V2Link>
      </span>
      {error ? (
        <span className="m2-err" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

// ── extraction dry run and delta ──────────────────────────────────────────────

const duration = (s: number): string => (s < 90 ? tr("{s} seconds", { s }) : s < 5400 ? tr("{value} minutes", { value: Math.round(s / 60) }) : tr("{value} hours", { value: (s / 3600).toFixed(1) }));

export function DryRunBlock({ systemId, objects }: { systemId: string; objects: string[] }) {
  const session = useV2Session();
  const [plan, setPlan] = useState<DryRun | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState<string | null>(null);
  const allowed = session.can("trigger_sync") && !session.shared && !session.viewAs;
  const run = async () => {
    setBusy("dry");
    setError(null);
    try {
      setPlan(await extractionDryRun(systemId, objects));
    } catch (e) {
      setError(notFound(e) ? tr("The dry run is not available on this server yet.") : failureText(e));
    } finally {
      setBusy(null);
    }
  };
  const delta = async () => {
    setBusy("delta");
    setError(null);
    try {
      const r = await extractDelta(systemId, objects, true);
      setStarted(tr("Delta extraction queued ({job_id}).", { job_id: r.job_id }));
    } catch (e) {
      setError(failureText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="m2-rsec" aria-label={tr("Dry run")} data-testid="dry-run">
      <h3>{tr("Dry run")}</h3>
      <p className="m2-meta">{tr("What an extraction of {what} would read, without reading it.", { what: objects.length ? tr("{objectsCount} {objectsCount, plural, one {object} other {objects}}", { objectsCount: objects.length }) : tr("the chosen objects") })}</p>
      <button type="button" className="m2-btn m2-sm" disabled={!allowed || !objects.length || busy !== null} onClick={() => void run()} title={!allowed ? tr("Needs the trigger sync permission") : undefined}>
        {busy === "dry" ? tr("Counting…") : tr("Dry run")}
      </button>
      {error ? (
        <p className="m2-err" role="alert">
          {error}
        </p>
      ) : null}
      {plan ? (
        <div data-testid="dry-run-plan">
          <p>{tr("{total_rows} rows in {tablesCount} {tablesCount, plural, one {table} other {tables}}, about {seconds} ({value}, {rate} rows a second).", { total_rows: int(plan.total_rows), tablesCount: plan.tables.length, seconds: duration(plan.seconds), value: plan.rate_basis === "measured" ? tr("this system's recent speed") : tr("an assumed speed"), rate: int(Math.round(plan.rate)) })}</p>
          {plan.unknown_tables ? <p className="m2-meta">{tr("{unknown_tables} {unknown_tables, plural, one {table was} other {tables were}} never extracted, so their rows are not counted.", { unknown_tables: plan.unknown_tables })}</p> : null}
          <div className="m2-scroll">
            <table className="m2-tbl m2-tmpl">
              <thead>
                <tr>
                  <th scope="col">{tr("Table")}</th>
                  <th scope="col" className="m2-r">
                    {tr("Rows last time")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {plan.tables.map((t) => (
                  <tr key={t.table}>
                    <th scope="row">
                      <Mono>{t.table}</Mono>
                    </th>
                    <td className="m2-r">{t.rows === null ? <Dash why={tr("Never extracted")} /> : int(t.rows)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>{tr("Changes only")}</h3>
          <p className="m2-meta">{plan.delta.reason}</p>
          <button type="button" className="m2-btn m2-sm" disabled={!plan.delta.available || busy !== null} onClick={() => void delta()} title={plan.delta.available ? undefined : plan.delta.reason}>
            {busy === "delta" ? tr("Starting…") : tr("Extract changes only")}
          </button>
          {started ? <p role="status">{started}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
