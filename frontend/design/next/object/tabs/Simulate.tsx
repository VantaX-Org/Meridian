"use client";

import Link from "next/link";
import { Fragment, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { simulateFix, type SimState, type SimulateBody, type SimulateResult, type TopFix } from "@/lib/api/v2/step9";
import type { RuleRow } from "@/lib/api/v2/types";
import { useObjectRules } from "@/lib/v2/queries";
import { useTopFixes } from "@/lib/v2/step9-queries";
import { capWords, gateWords, listWords, sentenceWords, signed1, signedInt } from "@/lib/v2/step9";
import { failureText } from "@/lib/v2/errors";
import { useOpenItem } from "@/lib/v2/hooks";
import { lc, t, tn } from "@/lib/v2/i18n";
import { f1, int, VERDICT_LABEL } from "@/lib/v2/score";
import { formatDate } from "@/lib/format";
import { Button, DataTable, EmptyState, ErrorState, Sheet, Skeleton, type Column } from "@/design/next/kit";
import { ExportTable } from "@/design/next/more/ExportTable";
import { Dash, ScoreBar, SevChip, VerdictChip } from "./tabs-g-parts";
import "./tabs-f.css";

export const simulationNote = (): string => t("Simulation: nothing is changed in SAP or in Meridian.");

function SimSide({ side, state, label, delta }: { side: "before" | "after"; state: SimState; label: string; delta?: SimulateResult["delta"] }) {
  const after = side === "after";
  return (
    <section className="nx-card nx-tf-sec" data-testid={`sim-${side}`} aria-label={after ? t("After the simulated fix") : t("Before, as the run stored it")}>
      <h3 className="nx-sec-h">{after ? t("After, simulated") : t("Before, as stored")}</h3>
      <ScoreBar value={state.score} label={t("Score of {label}", { label })} />
      <dl className="nx-tf-facts">
        <dt>{t("Score")}</dt>
        <dd>
          {f1(state.score)}
          {after && delta ? ` ${signed1(delta.score)}` : ""}
          {t(", measured {measured}", { measured: f1(state.raw_score) })}
        </dd>
        <dt>{t("Cap")}</dt>
        <dd>{capWords(state)}</dd>
        <dt>{t("Verdict")}</dt>
        <dd>{state.verdict ? <VerdictChip verdict={state.verdict} /> : <Dash why={t("Not measured")} />}</dd>
        <dt>{t("Features")}</dt>
        <dd>
          {t("{blocked} blocked, {degraded} degraded", { blocked: state.features_blocked, degraded: state.features_degraded })}
          {after && delta && (delta.features_blocked || delta.features_degraded)
            ? ` (${t("{blocked} blocked, {degraded} degraded", { blocked: signedInt(delta.features_blocked), degraded: signedInt(delta.features_degraded) })})`
            : ""}
        </dd>
        <dt>{t("Wave")}</dt>
        <dd>
          {state.wave_gate.length === 0
            ? t("Not in a wave")
            : state.wave_gate.map((g) => (
                <span key={g.wave_id} className="nx-tf-dec">
                  <VerdictChip verdict={g.open ? "go" : "no-go"} /> {gateWords(g)}
                </span>
              ))}
        </dd>
      </dl>
    </section>
  );
}

/** One sentence that says what the simulated fix changes. */
export function simulationSentence(r: SimulateResult): string {
  const d = r.delta;
  const parts = [t("the score would move from {before} to {after} ({delta})", { before: f1(r.before.score), after: f1(r.after.score), delta: signed1(d.score) })];
  if (d.breaches_cleared.length) {
    const n = d.breaches_cleared.length;
    parts.push(t("{n} critical {n, plural, one {rule} other {rules}} would come under tolerance ({rules})", { n, rules: d.breaches_cleared.join(", ") }));
  }
  if (d.features_blocked < 0) parts.push(t("{n} S/4 {n, plural, one {feature} other {features}} would be unblocked", { n: -d.features_blocked }));
  if (d.verdict_changed && r.after.verdict) parts.push(t("the verdict would be {verdict}", { verdict: lc(VERDICT_LABEL[r.after.verdict]) }));
  if (d.gates_opened.length) parts.push(t("{waves} would open", { waves: listWords(r.after.wave_gate.filter((g) => d.gates_opened.includes(g.wave_id)).map((g) => g.name)) }));
  const s = parts.join("; ");
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

export function SimulationView({ result, label }: { result: SimulateResult; label: string }) {
  const { hrefFor } = useOpenItem();
  const m = result.method;
  const fixed = m.rules_fixed ?? [];
  const resolved = Object.entries(m.records_resolved ?? {});
  const unknown = m.rules_unknown ?? [];
  const links: ReactNode = fixed.map((id, i) => (
    <Fragment key={id}>
      {i ? ", " : ""}
      <Link className="nx-link nx-mono" href={hrefFor({ kind: "rule", id })}>
        {id}
      </Link>
    </Fragment>
  ));
  return (
    <div className="nx-tf-stack" data-testid="simulation">
      <span className="nx-tf-sub">{simulationNote()}</span>
      <p data-testid="simulation-sentence">{simulationSentence(result)}</p>
      <div className="nx-tf-sides">
        <SimSide side="before" state={result.before} label={label} />
        <SimSide side="after" state={result.after} label={label} delta={result.delta} />
      </div>
      {result.landscape ? (
        <dl className="nx-tf-facts" data-testid="simulation-landscape">
          <dt>{t("Landscape now:")}</dt>
          <dd>{sentenceWords(result.landscape.before)}</dd>
          <dt>{t("Landscape after, simulated:")}</dt>
          <dd>{sentenceWords(result.landscape.after)}</dd>
        </dl>
      ) : (
        <p className="nx-tf-sub">{t("The landscape sentence is not shown: this run is not the one the landscape reads for this object.")}</p>
      )}
      <p className="nx-tf-sub">
        {result.run_at
          ? t("Rescored from the stored findings of the run of {when}, with the scoring the run used; feature impact from the impact rules.", { when: formatDate(result.run_at, "datetime") })
          : t("Rescored from the stored findings of this object's run, with the scoring the run used; feature impact from the impact rules.")}
        {fixed.length ? <> {tn("Rules fixed: {rules}.", { rules: links })}</> : null}
        {resolved.length ? ` ${t("Records resolved: {list}.", { list: resolved.map(([rule, n]) => t("{n} of {rule}", { n: int(n), rule })).join(", ") })}` : ""}
        {unknown.length ? ` ${t("Not failing on this run: {rules}.", { rules: unknown.join(", ") })}` : ""}
        {m.reproduced === false ? ` ${t("The stored score was {score}; the change is exact for the rebuilt results.", { score: f1(m.stored_score ?? null) })}` : ""}
      </p>
    </div>
  );
}

function useSimulation(body: SimulateBody | null) {
  const fixture = useFixture();
  return useQuery({ queryKey: ["v2", "s9", "simulate", fixture, body], queryFn: () => simulateFix(body as SimulateBody), enabled: body !== null, retry: false, staleTime: 30_000 });
}

/** The rules picker: which failing rules to treat as fixed. */
function RulePicker({ rules, chosen, set }: { rules: RuleRow[]; chosen: ReadonlySet<string>; set: (next: Set<string>) => void }) {
  const toggle = (id: string) => {
    const n = new Set(chosen);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    set(n);
  };
  return (
    <ul className="nx-tf-pick" aria-label={t("Rules to treat as fixed")}>
      {rules.map((r) => (
        <li key={r.check_id}>
          <label>
            <input type="checkbox" checked={chosen.has(r.check_id)} onChange={() => toggle(r.check_id)} />
            <span>
              <span className="nx-mono">{r.check_id}</span> {r.name}
            </span>
            <SevChip severity={r.severity} />
            <span className="nx-tf-sub">{t("{n} failing", { n: int(r.affected_count) })}</span>
          </label>
        </li>
      ))}
    </ul>
  );
}

export function SimulateDialog({
  module,
  label,
  systemId,
  run,
  rules: initial,
  records,
  onClose,
}: {
  module: string;
  label: string;
  systemId?: string | null;
  run?: string | null;
  rules?: string[];
  records?: { module: string; record_key: string }[];
  onClose: () => void;
}) {
  const base: SimulateBody = { module, system_id: systemId ?? undefined, run_id: run ?? undefined };
  const rulesQ = useObjectRules(module, run ?? null);
  const failing = (rulesQ.data ?? []).filter((r) => r.affected_count > 0);
  const [chosen, setChosen] = useState<Set<string> | null>(initial ? new Set(initial) : null);
  const picked = chosen ?? new Set(failing.filter((r) => r.severity === "critical").map((r) => r.check_id));
  const [asked, setAsked] = useState<SimulateBody | null>(records ? { ...base, records } : initial ? { ...base, rules: [...initial] } : null);
  const sim = useSimulation(asked);
  return (
    <Sheet
      open
      onClose={onClose}
      title={t("Simulate fixing, {label}", { label })}
      meta={simulationNote()}
      size="large"
      primary={
        records ? undefined : (
          <Button variant="primary" disabled={picked.size === 0 || sim.isFetching} onClick={() => setAsked({ ...base, rules: [...picked].sort() })}>
            {sim.isFetching ? t("Simulating…") : t("Simulate fixing {n} {n, plural, one {rule} other {rules}}", { n: picked.size })}
          </Button>
        )
      }
      secondary={
        <Button variant="secondary" onClick={onClose}>
          {t("Close")}
        </Button>
      }
    >
      <div className="nx-tf-stack" data-testid="simulate-dialog">
        {records ? (
          <p>{t("{n} selected {n, plural, one {record} other {records}} of {label}, every rule they fail treated as fixed.", { n: records.length, label })}</p>
        ) : rulesQ.isPending ? (
          <Skeleton />
        ) : rulesQ.isError ? (
          <ErrorState sentence={t("The rules of this object could not be read.")} onRetry={() => void rulesQ.refetch()} />
        ) : failing.length === 0 ? (
          <EmptyState heading={t("No rule fails on this object in this run, so there is nothing to simulate.")} />
        ) : (
          <RulePicker rules={failing} chosen={picked} set={setChosen} />
        )}
        {asked && sim.isPending ? <Skeleton /> : null}
        {sim.isError ? <p role="alert">{failureText(sim.error)}</p> : null}
        {sim.data ? <SimulationView result={sim.data} label={label} /> : null}
      </div>
    </Sheet>
  );
}

/** Each failing rule simulated on its own, ranked by the score it would give back. */
export function TopFixesView({ module, label, systemId, run }: { module: string; label: string; systemId: string | null; run: string | null }) {
  const q = useTopFixes(module, systemId, run);
  const { hrefFor } = useOpenItem();
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string[] | null>(null);
  const toggle = (id: string) =>
    setChosen((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const cols: Column<TopFix>[] = [
    { id: "choose", label: t("Choose"), cell: (r) => <input type="checkbox" aria-label={t("Choose {rule}", { rule: r.check_id })} checked={chosen.has(r.check_id)} onChange={() => toggle(r.check_id)} /> },
    {
      id: "rule",
      label: t("Rule"),
      cell: (r) => (
        <span>
          <Link className="nx-link nx-mono" href={hrefFor({ kind: "rule", id: r.check_id })} data-testid={`top-fix-${r.check_id}`}>
            {r.check_id}
          </Link>
          {r.breach_cleared ? ` ${t("clears the cap")}` : ""}
        </span>
      ),
    },
    { id: "severity", label: t("Severity"), cell: (r) => <SevChip severity={r.severity} /> },
    { id: "failing", label: t("Failing"), cell: (r) => int(r.failing), align: "end", compare: (a, b) => a.failing - b.failing },
    { id: "after", label: t("Score after"), cell: (r) => f1(r.after_score), align: "end" },
    { id: "delta", label: t("Gained"), cell: (r) => signed1(r.delta), align: "end", compare: (a, b) => (a.delta ?? 0) - (b.delta ?? 0) },
    { id: "verdict", label: t("Verdict after"), cell: (r) => (r.after_verdict ? <VerdictChip verdict={r.after_verdict} /> : <Dash />) },
    {
      id: "sim",
      label: t("Simulate"),
      cell: (r) => (
        <Button variant="quiet" size={32} aria-label={t("Simulate fixing {rule}", { rule: r.check_id })} onClick={() => setOpen([r.check_id])}>
          {t("Simulate")}
        </Button>
      ),
    },
  ];
  return (
    <section className="nx-card nx-tf-sec" data-testid="top-fixes" aria-label={t("Top fixes")}>
      <div className="nx-tf-head">
        <h3 className="nx-sec-h">{t("Top fixes")}</h3>
        <span className="nx-tf-sub">
          {simulationNote()} {q.data ? t("Each rule is simulated on its own against the stored run; the score shown now is {score}.", { score: f1(q.data.score) }) : null}
        </span>
      </div>
      {q.isPending ? (
        <Skeleton />
      ) : q.isError ? (
        <ErrorState sentence={t("The top fixes could not be simulated for this object.")} onRetry={() => void q.refetch()} />
      ) : q.data.rules.length === 0 ? (
        <EmptyState heading={t("No rule fails on {label} in this run, so no fix would move its score.", { label })} />
      ) : (
        <>
          <ExportTable>
            <DataTable rows={q.data.rules} columns={cols} rowKey={(r) => r.check_id} rowLabel={(r) => r.check_id} caption={t("Top fixes for {label}, ranked by score gained", { label })} />
          </ExportTable>
          <p className="nx-tf-tools">
            <Button variant="primary" disabled={chosen.size === 0} onClick={() => setOpen([...chosen])}>
              {chosen.size ? t("Simulate fixing {n} {n, plural, one {rule} other {rules}} together", { n: chosen.size }) : t("Choose rules to simulate together")}
            </Button>
          </p>
          <p className="nx-tf-sub">{t("Ranked by the shown score gained, then the measured score, then the records failing.")}</p>
        </>
      )}
      {open ? <SimulateDialog module={module} label={label} systemId={systemId} run={run} rules={open} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}
