"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { extractDelta, extractionDryRun, putEscalationChain, putWaveGate, type DryRun, type EscalationStep, type WaveGate } from "@/lib/api/v2/roles";
import { useAssignable } from "@/lib/v2/approvals-queries";
import { failureText } from "@/lib/v2/errors";
import { useV2Session } from "@/lib/v2/hooks";
import { notFound, refreshRoles, useEscalationChain, useWaveGates } from "@/lib/v2/roles-queries";
import { int } from "@/lib/v2/score";
import { VerdictMark } from "../marks";
import { Dash, Mono, Skeleton } from "../parts";
import "../roles.css";

/**
 * Governance pieces dropped into existing inspectors with one line each (step 6c):
 *   EscalationChainEditor  the triage panel: the levels after the first escalation
 *   GateMark / WaveGateEditor  the Waves view and panel: a wave's gate criteria and whether it passes
 *   DryRunBlock            the System inspector: what an extraction would read, and a delta extraction
 */

// ── escalation chain ──────────────────────────────────────────────────────────

const TARGET: Record<EscalationStep["target"], string> = { team_lead: "The team lead", fallback: "The fallback owner", user: "A person" };

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
    <section className="m2-rsec" aria-label="Escalation chain" data-testid="escalation-chain">
      <h3>Escalation chain</h3>
      <p className="m2-meta">After a breach the assignee and the team lead hear first. Each level below notifies once more when an item stays past due that long.</p>
      {q.isError ? (
        <p className="m2-meta">{notFound(q.error) ? <Dash why="The escalation chain is not available on this server yet" /> : "The chain could not be read."}</p>
      ) : !q.data ? (
        <Skeleton width="60%" height={12} />
      ) : (
        <>
          {list.length === 0 ? <p className="m2-meta">No further levels.</p> : null}
          <ol className="m2-hist">
            {list.map((s, i) => (
              <li key={i} data-testid="escalation-level">
                <span className="m2-meta">{`Level ${i + 1}`}</span>
                {canEdit ? (
                  <span className="m2-gtools">
                    <label>
                      <span className="m2-meta">Hours past due </span>
                      <input type="number" min={0} value={Math.round(s.after_minutes / 60)} onChange={(e) => set(i, { after_minutes: Math.max(0, Number(e.target.value)) * 60 })} style={{ width: 64 }} aria-label={`Level ${i + 1}: hours past due`} />
                    </label>
                    <select value={s.target} onChange={(e) => set(i, { target: e.target.value as EscalationStep["target"] })} aria-label={`Level ${i + 1}: who hears`}>
                      {Object.entries(TARGET).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                    {s.target === "user" ? (
                      <select value={s.user_id ?? ""} onChange={(e) => set(i, { user_id: e.target.value || null })} aria-label={`Level ${i + 1}: person`}>
                        <option value="">Choose</option>
                        {(people.data ?? []).map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    <button type="button" className="m2-linkbtn2" onClick={() => setSteps(list.filter((_, n) => n !== i))}>
                      Remove
                    </button>
                  </span>
                ) : (
                  <span>{`${Math.round(s.after_minutes / 60)} hours past due: ${s.target === "user" ? (s.user_name ?? "a person") : TARGET[s.target].toLowerCase()}`}</span>
                )}
              </li>
            ))}
          </ol>
          {canEdit ? (
            <span className="m2-gtools">
              <button type="button" className="m2-btn m2-sm" disabled={list.length >= 5} onClick={() => setSteps([...list, { level: list.length + 1, after_minutes: (list[list.length - 1]?.after_minutes ?? 0) + 480, target: "fallback", user_id: null }])}>
                Add a level
              </button>
              <button type="button" className="m2-btn m2-sm m2-strong" disabled={steps === null} onClick={() => void save()}>
                Save the chain
              </button>
            </span>
          ) : (
            <p className="m2-meta">Changing the chain needs the manage triage permission.</p>
          )}
          {error ? (
            <p className="m2-err" role="alert">
              {error}
            </p>
          ) : null}
          {saved ? <p role="status">Saved. It applies from the next SLA sweep.</p> : null}
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
    <span className="m2-gate" data-testid="gate-mark" title={g.status.checks.map((c) => `${c.label}: ${c.passed ? "met" : c.detail}`).join(". ")}>
      <VerdictMark verdict={g.status.passed ? "go" : "no-go"} />
      {g.status.passed ? "Gate passed" : `Gate not passed, ${g.status.checks.filter((c) => !c.passed).length} of ${g.status.checks.length} not met`}
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
  if (q.isError) return notFound(q.error) ? <Dash why="Wave gates are not available on this server yet" /> : <p className="m2-meta">The gate could not be read.</p>;
  if (!g) return null;
  return <GateForm key={g.gate.updated_at ?? "none"} g={g} />;
}

function GateForm({ g }: { g: WaveGate }) {
  const qc = useQueryClient();
  const session = useV2Session();
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
      <span className="m2-meta">Gate</span>
      {g.gate.configured ? <GateChecks g={g} /> : <p className="m2-meta">No gate yet: a wave without one moves on its verdict alone.</p>}
      {canEdit ? (
        <span className="m2-gtools">
          <label>
            <span className="m2-meta">Min score </span>
            <input type="number" min={0} max={100} value={min} onChange={(e) => setMin(e.target.value)} style={{ width: 64 }} aria-label={`${g.name}: minimum score`} />
          </label>
          <label className="m2-sw">
            <input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} />
            <span>Zero criticals</span>
          </label>
          <label className="m2-sw">
            <input type="checkbox" checked={contracts} onChange={(e) => setContracts(e.target.checked)} />
            <span>Contracts met</span>
          </label>
          <button type="button" className="m2-btn m2-sm" onClick={() => void save()}>
            Save the gate
          </button>
        </span>
      ) : null}
      <span className="m2-meta">
        {`Readiness certificate: ${g.status.passed ? "a draft is ready" : "not yet"} (the signed certificate arrives in step 9) `}
        <Mono>{g.certificate_href.replace("/api/v1", "")}</Mono>
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

const duration = (s: number): string => (s < 90 ? `${s} seconds` : s < 5400 ? `${Math.round(s / 60)} minutes` : `${(s / 3600).toFixed(1)} hours`);

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
      setError(notFound(e) ? "The dry run is not available on this server yet." : failureText(e));
    } finally {
      setBusy(null);
    }
  };
  const delta = async () => {
    setBusy("delta");
    setError(null);
    try {
      const r = await extractDelta(systemId, objects, true);
      setStarted(`Delta extraction queued (${r.job_id}).`);
    } catch (e) {
      setError(failureText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <section className="m2-rsec" aria-label="Dry run" data-testid="dry-run">
      <h3>Dry run</h3>
      <p className="m2-meta">What an extraction of {objects.length ? `${objects.length} ${objects.length === 1 ? "object" : "objects"}` : "the chosen objects"} would read, without reading it.</p>
      <button type="button" className="m2-btn m2-sm" disabled={!allowed || !objects.length || busy !== null} onClick={() => void run()} title={!allowed ? "Needs the trigger sync permission" : undefined}>
        {busy === "dry" ? "Counting…" : "Dry run"}
      </button>
      {error ? (
        <p className="m2-err" role="alert">
          {error}
        </p>
      ) : null}
      {plan ? (
        <div data-testid="dry-run-plan">
          <p>{`${int(plan.total_rows)} rows in ${plan.tables.length} ${plan.tables.length === 1 ? "table" : "tables"}, about ${duration(plan.seconds)} (${plan.rate_basis === "measured" ? "this system's recent speed" : "an assumed speed"}, ${int(Math.round(plan.rate))} rows a second).`}</p>
          {plan.unknown_tables ? <p className="m2-meta">{`${plan.unknown_tables} ${plan.unknown_tables === 1 ? "table was" : "tables were"} never extracted, so their rows are not counted.`}</p> : null}
          <div className="m2-scroll">
            <table className="m2-tbl m2-tmpl">
              <thead>
                <tr>
                  <th scope="col">Table</th>
                  <th scope="col" className="m2-r">
                    Rows last time
                  </th>
                </tr>
              </thead>
              <tbody>
                {plan.tables.map((t) => (
                  <tr key={t.table}>
                    <th scope="row">
                      <Mono>{t.table}</Mono>
                    </th>
                    <td className="m2-r">{t.rows === null ? <Dash why="Never extracted" /> : int(t.rows)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>Changes only</h3>
          <p className="m2-meta">{plan.delta.reason}</p>
          <button type="button" className="m2-btn m2-sm" disabled={!plan.delta.available || busy !== null} onClick={() => void delta()} title={plan.delta.available ? undefined : plan.delta.reason}>
            {busy === "delta" ? "Starting…" : "Extract changes only"}
          </button>
          {started ? <p role="status">{started}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
