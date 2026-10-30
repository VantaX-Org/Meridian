"use client";

import "../../step9.css";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { simulateFix, type SimState, type SimulateBody, type SimulateResult } from "@/lib/api/v2/step9";
import type { RuleRow } from "@/lib/api/v2/types";
import { failureText } from "@/lib/v2/errors";
import { useOpenItem } from "@/lib/v2/hooks";
import { lc, t, tn } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { useObjectRules } from "@/lib/v2/queries";
import { f1, int, VERDICT_LABEL } from "@/lib/v2/score";
import { capWords, gateWords, listWords, rulerOfState, sentenceWords, signed1, signedInt } from "@/lib/v2/step9";
import { useTopFixes } from "@/lib/v2/step9-queries";
import { Dialog } from "../../admin/kit";
import { SeverityMark, VerdictMark, type SeverityKey } from "../../marks";
import { Dash, EmptyFrame, ErrorFrame, Skeleton, V2Link } from "../../parts";
import { Ruler } from "../../Ruler";

/** The words that say this is a simulation, on every surface that shows one. */
export const simulationNote = (): string => t("Simulation: nothing is changed in SAP or in Meridian.");

function SimSide({ side, state, label, delta }: { side: "before" | "after"; state: SimState; label: string; delta?: SimulateResult["delta"] }) {
  const r = rulerOfState(state);
  const after = side === "after";
  return (
    <section className="m2-sim-side" data-side={side} aria-label={after ? t("After the simulated fix") : t("Before, as the run stored it")} data-testid={`sim-${side}`}>
      <h3>{after ? t("After, simulated") : t("Before, as stored")}</h3>
      <Ruler size={240} dims={r.dims} measured={r.measured} score={r.score} capped={r.capped} capLevel={r.capLevel} breaches={r.breaches} label={after ? t("{label}, simulated", { label }) : t("{label}, before", { label })} records={null} rules={null} coverage={null} selected={after} />
      <dl className="m2-sim-facts">
        <dt>{t("Score")}</dt>
        <dd>
          {f1(state.score)}
          {after && delta ? <span className="m2-sim-delta">{` ${signed1(delta.score)}`}</span> : null}
          <span className="m2-meta">{t(", measured {measured}", { measured: f1(state.raw_score) })}</span>
        </dd>
        <dt>{t("Cap")}</dt>
        <dd>{capWords(state)}</dd>
        <dt>{t("Verdict")}</dt>
        <dd>
          {state.verdict ? (
            <span className="m2-v">
              <VerdictMark verdict={state.verdict} />
              {VERDICT_LABEL[state.verdict]}
            </span>
          ) : (
            <Dash why={t("Not measured")} />
          )}
        </dd>
        <dt>{t("Features")}</dt>
        <dd>
          {t("{blocked} blocked, {degraded} degraded", { blocked: state.features_blocked, degraded: state.features_degraded })}
          {after && delta && (delta.features_blocked || delta.features_degraded) ? <span className="m2-meta">{` (${t("{blocked} blocked, {degraded} degraded", { blocked: signedInt(delta.features_blocked), degraded: signedInt(delta.features_degraded) })})`}</span> : null}
        </dd>
        <dt>{t("Wave")}</dt>
        <dd>
          {state.wave_gate.length === 0
            ? t("Not in a wave")
            : state.wave_gate.map((g) => (
                <span key={g.wave_id} className="m2-v" style={{ display: "flex" }}>
                  <VerdictMark verdict={g.open ? "go" : "no-go"} />
                  {gateWords(g)}
                </span>
              ))}
        </dd>
      </dl>
    </section>
  );
}

/** The summary sentence of a simulation: what moves, in plain words. */
export function simulationSentence(r: SimulateResult): string {
  const d = r.delta;
  const parts = [t("the score would move from {before} to {after} ({delta})", { before: f1(r.before.score), after: f1(r.after.score), delta: signed1(d.score) })];
  if (d.breaches_cleared.length) parts.push(t("{n} critical {n, plural, one {rule} other {rules}} would come under tolerance ({rules})", { n: d.breaches_cleared.length, rules: d.breaches_cleared.join(", ") }));
  if (d.features_blocked < 0) parts.push(t("{n} S/4 {n, plural, one {feature} other {features}} would be unblocked", { n: -d.features_blocked }));
  if (d.verdict_changed && r.after.verdict) parts.push(t("the verdict would be {verdict}", { verdict: lc(VERDICT_LABEL[r.after.verdict]) }));
  if (d.gates_opened.length) parts.push(t("{waves} would open", { waves: listWords(r.after.wave_gate.filter((g) => d.gates_opened.includes(g.wave_id)).map((g) => g.name)) }));
  const s = parts.join("; ");
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

/** Before and after side by side, the landscape sentence before and after, and how it was worked out. */
export function SimulationView({ result, label }: { result: SimulateResult; label: string }) {
  const { hrefFor } = useOpenItem();
  const fixed = result.method.rules_fixed ?? [];
  const resolved = Object.entries(result.method.records_resolved ?? {});
  const unknown = result.method.rules_unknown ?? [];
  return (
    <div className="m2-sim" data-testid="simulation">
      <span className="m2-sim-label">{simulationNote()}</span>
      <p className="m2-finding" data-testid="simulation-sentence">
        {simulationSentence(result)}
      </p>
      <div className="m2-sim-sides">
        <SimSide side="before" state={result.before} label={label} />
        <SimSide side="after" state={result.after} label={label} delta={result.delta} />
      </div>
      {result.landscape ? (
        <div data-testid="simulation-landscape">
          <p className="m2-sim-sent">
            <b>{t("Landscape now:")}</b> {sentenceWords(result.landscape.before)}
          </p>
          <p className="m2-sim-sent">
            <b>{t("Landscape after, simulated:")}</b> {sentenceWords(result.landscape.after)}
          </p>
        </div>
      ) : (
        <p className="m2-sim-sent">{t("The landscape sentence is not shown: this run is not the one the landscape reads for this object.")}</p>
      )}
      <p className="m2-prov">
        {result.run_at ? t("Rescored from the stored findings of the run of {when}, with the scoring the run used; feature impact from the impact rules.", { when: formatDate(result.run_at, "datetime") }) : t("Rescored from the stored findings of this object's run, with the scoring the run used; feature impact from the impact rules.")}{" "}
        {fixed.length ? (
          <>
            {tn("Rules fixed: {rules}.", {
              rules: (
                <>
                  {fixed.map((id, i) => (
                    <span key={id}>
                      {i > 0 ? ", " : ""}
                      <V2Link href={hrefFor({ kind: "rule", id })} className="m2-mono">
                        {id}
                      </V2Link>
                    </span>
                  ))}
                </>
              ),
            })}{" "}
          </>
        ) : null}
        {resolved.length ? `${t("Records resolved: {list}.", { list: resolved.map(([id, n]) => t("{n} of {rule}", { n: int(n), rule: id })).join(", ") })} ` : null}
        {unknown.length ? `${t("Not failing on this run: {rules}.", { rules: unknown.join(", ") })} ` : null}
        {result.method.reproduced === false ? t("The stored score was {score}; the change is exact for the rebuilt results.", { score: f1(result.method.stored_score ?? null) }) : null}
      </p>
    </div>
  );
}

/** One simulation per body asked for: read-only on the server, so it is a query keyed by what was chosen. */
function useSimulation(body: SimulateBody | null) {
  const fixture = useFixture();
  return useQuery({ queryKey: ["v2", "s9", "simulate", fixture, body], queryFn: () => simulateFix(body as SimulateBody), enabled: body !== null, retry: false, staleTime: 30_000 });
}

const SEV: readonly SeverityKey[] = ["critical", "high", "medium", "low", "info"];
const sevOf = (s: string): SeverityKey => (SEV.includes(s as SeverityKey) ? (s as SeverityKey) : "low");

/** The rules picker of the Rules tab: which failing rules to treat as fixed. The critical ones over tolerance start ticked. */
function RulePicker({ rules, chosen, set }: { rules: RuleRow[]; chosen: ReadonlySet<string>; set: (next: Set<string>) => void }) {
  const toggle = (id: string) => {
    const n = new Set(chosen);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    set(n);
  };
  return (
    <ul className="m2-sim-pick" aria-label={t("Rules to treat as fixed")}>
      {rules.map((r) => (
        <li key={r.check_id}>
          <label>
            <input type="checkbox" checked={chosen.has(r.check_id)} onChange={() => toggle(r.check_id)} />
            <span>
              <span className="m2-mono">{r.check_id}</span> {r.name}
            </span>
            <span className="m2-meta">
              <SeverityMark severity={sevOf(r.severity)} /> {t("{n} failing", { n: int(r.affected_count) })}
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

/**
 * "Simulate fixing": a dialog that rescores the object with the chosen failures treated as fixed. From the Rules tab
 * it starts with a rule picker; from the Work ledger it receives the selected records and runs at once.
 */
export function SimulateDialog({ module, label, systemId, run, rules: initial, records, onClose }: { module: string; label: string; systemId?: string | null; run?: string | null; rules?: string[]; records?: { module: string; record_key: string }[]; onClose: () => void }) {
  const base = { module, system_id: systemId ?? undefined, run_id: run ?? undefined };
  const rulesQ = useObjectRules(module, run ?? null);
  const failing = (rulesQ.data ?? []).filter((r) => r.affected_count > 0);
  const [chosen, setChosen] = useState<Set<string> | null>(initial ? new Set(initial) : null);
  const picked = chosen ?? new Set(failing.filter((r) => r.severity === "critical").map((r) => r.check_id));
  const [asked, setAsked] = useState<SimulateBody | null>(records ? { ...base, records } : initial ? { ...base, rules: [...initial] } : null);
  const sim = useSimulation(asked);
  return (
    <Dialog title={t("Simulate fixing, {label}", { label })} description={simulationNote()} onClose={onClose} className="m2-sim-dlg">
      {records ? (
        <p className="m2-prov" style={{ margin: 0 }}>
          {t("{n} selected {n, plural, one {record} other {records}} of {label}, every rule they fail treated as fixed.", { n: records.length, label })}
        </p>
      ) : (
        <>
          {rulesQ.isPending ? (
            <Skeleton width="100%" height={80} />
          ) : rulesQ.isError ? (
            <ErrorFrame onRetry={() => void rulesQ.refetch()}>{t("The rules of this object could not be read.")}</ErrorFrame>
          ) : failing.length === 0 ? (
            <EmptyFrame>{t("No rule fails on this object in this run, so there is nothing to simulate.")}</EmptyFrame>
          ) : (
            <RulePicker rules={failing} chosen={picked} set={setChosen} />
          )}
          <div className="m2-dlg-a" style={{ justifyContent: "flex-start" }}>
            <button type="button" className="m2-btn m2-strong" disabled={picked.size === 0 || sim.isFetching} onClick={() => setAsked({ ...base, rules: [...picked].sort() })}>
              {sim.isFetching ? t("Simulating…") : t("Simulate fixing {n} {n, plural, one {rule} other {rules}}", { n: picked.size })}
            </button>
          </div>
        </>
      )}
      {asked && sim.isPending ? <Skeleton width="100%" height={200} /> : null}
      {sim.isError ? (
        <p className="m2-s9-err" role="alert">
          {failureText(sim.error)}
        </p>
      ) : null}
      {sim.data ? <SimulationView result={sim.data} label={label} /> : null}
      <div className="m2-dlg-a">
        <button type="button" className="m2-btn" onClick={onClose}>
          {t("Close")}
        </button>
      </div>
    </Dialog>
  );
}

/** The Rules tab's "Top fixes" view: the failing rules whose fix moves the shown score most, each simulated. */
export function TopFixesView({ module, label, systemId, run }: { module: string; label: string; systemId: string | null; run: string | null }) {
  const q = useTopFixes(module, systemId, run);
  const { hrefFor } = useOpenItem();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string[] | null>(null);
  const toggle = (id: string) => {
    const n = new Set(chosen);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setChosen(n);
  };
  return (
    <section aria-label={t("Top fixes")} data-testid="top-fixes">
      <p className="m2-prov" style={{ marginTop: 0 }}>
        <span className="m2-sim-label">{simulationNote()}</span> {q.data ? t("Each rule is simulated on its own against the stored run; the score shown now is {score}.", { score: f1(q.data.score) }) : null}
      </p>
      {q.isPending ? (
        <Skeleton width="100%" height={120} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The top fixes could not be simulated for this object.")}</ErrorFrame>
      ) : q.data.rules.length === 0 ? (
        <EmptyFrame>{t("No rule fails on {label} in this run, so no fix would move its score.", { label })}</EmptyFrame>
      ) : (
        <>
          <div className="m2-frame" tabIndex={0} role="region" aria-label={t("Top fixes, scrollable")}>
            <table className="m2-tbl" aria-label={t("Top fixes for {label}, ranked by score gained", { label })}>
              <thead>
                <tr>
                  <th scope="col">
                    <span className="m2-sr">{t("Choose")}</span>
                  </th>
                  <th scope="col">{t("Rule")}</th>
                  <th scope="col">{t("Severity")}</th>
                  <th scope="col" className="m2-r">{t("Failing")}</th>
                  <th scope="col" className="m2-r">{t("Score after")}</th>
                  <th scope="col" className="m2-r">{t("Gained")}</th>
                  <th scope="col">{t("Verdict after")}</th>
                  <th scope="col">
                    <span className="m2-sr">{t("Simulate")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.data.rules.map((r) => (
                  <tr key={r.check_id}>
                    <td>
                      <input type="checkbox" aria-label={t("Choose {rule}", { rule: r.check_id })} checked={chosen.has(r.check_id)} onChange={() => toggle(r.check_id)} />
                    </td>
                    <th scope="row">
                      <V2Link href={hrefFor({ kind: "rule", id: r.check_id })} className="m2-mono">
                        {r.check_id}
                      </V2Link>
                      {r.breach_cleared ? <span className="m2-meta"> {t("clears the cap")}</span> : null}
                    </th>
                    <td>
                      <span className="m2-sev">
                        <SeverityMark severity={sevOf(r.severity)} />
                        {labelText(r.severity)}
                      </span>
                    </td>
                    <td className="m2-r">{int(r.failing)}</td>
                    <td className="m2-r">{f1(r.after_score)}</td>
                    <td className="m2-r m2-sim-delta">{signed1(r.delta)}</td>
                    <td>
                      {r.after_verdict ? (
                        <span className="m2-v">
                          <VerdictMark verdict={r.after_verdict} />
                          {VERDICT_LABEL[r.after_verdict]}
                        </span>
                      ) : (
                        <Dash />
                      )}
                    </td>
                    <td className="m2-r">
                      <button type="button" className="m2-btn m2-sm" onClick={() => setOpen([r.check_id])} aria-label={t("Simulate fixing {rule}", { rule: r.check_id })}>
                        {t("Simulate")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="m2-acts" style={{ marginTop: "var(--m2-s2)" }}>
            <button type="button" className="m2-btn m2-strong" disabled={chosen.size === 0} onClick={() => setOpen([...chosen])}>
              {chosen.size ? t("Simulate fixing {n} {n, plural, one {rule} other {rules}} together", { n: chosen.size }) : t("Choose rules to simulate together")}
            </button>
          </div>
          <p className="m2-prov">{t("Ranked by the shown score gained, then the measured score, then the records failing.")}</p>
        </>
      )}
      {open ? <SimulateDialog module={module} label={label} systemId={systemId} run={run} rules={open} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}
