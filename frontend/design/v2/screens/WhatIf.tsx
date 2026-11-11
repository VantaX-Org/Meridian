"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { createSimulation, getSimulation, isDone, type SimRule, type SimulationDoc } from "@/lib/api/v2/simulations";
import { useOpenItem } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { f1, int } from "@/lib/v2/score";
import { signed1 } from "@/lib/v2/step9";
import { SeverityMark, type SeverityKey } from "../marks";
import { ErrorFrame, SapCode, Skeleton, V2Link } from "../parts";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { simulationNote } from "./step9/Simulation";
import { Fld, Sw } from "../admin/kit";
import "../admin.css";
import { TableExport } from "@/design/v2/TableExport";

/** The backend's key rule for a value map, so a bad key is caught before the request. */
const KEY = /^[A-Z0-9_/]+\.[A-Z0-9_/]+$/;

type MapRow = { key: string; from: string; to: string };

const STATUS: Record<SimRule["status"], () => string> = {
  resolved: () => t("Resolved"),
  improved: () => t("Improved"),
  regressed: () => t("Regressed"),
  newly_failing: () => t("Newly failing"),
  newly_evaluated: () => t("Newly evaluated"),
  not_evaluated: () => t("No longer evaluated"),
  unchanged: () => t("Unchanged"),
};

const DIMENSION: Record<string, () => string> = {
  completeness: () => t("Completeness"),
  accuracy: () => t("Accuracy"),
  consistency: () => t("Consistency"),
  timeliness: () => t("Timeliness"),
  uniqueness: () => t("Uniqueness"),
  validity: () => t("Validity"),
};

const failing = (c: SimRule["before"]) => (c ? int(c.failing) : "—");

function RuleTable({ rows, label }: { rows: SimRule[]; label: string }) {
  const { hrefFor } = useOpenItem();
  return (
    <div className="m2-frame" tabIndex={0}>
      <TableExport><table className="m2-tbl" aria-label={label}>
        <thead>
          <tr>
            <th scope="col">{t("Rule")}</th>
            <th scope="col">{t("Field")}</th>
            <th scope="col">{t("Object")}</th>
            <th scope="col">{t("Change")}</th>
            <th scope="col" className="m2-r">{t("Failing before")}</th>
            <th scope="col" className="m2-r">{t("Failing after")}</th>
            <th scope="col" className="m2-r">{t("Records fixed")}</th>
            <th scope="col" className="m2-r">{t("Records broken")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.module}:${r.check_id}`}>
              <th scope="row">
                <SeverityMark severity={r.severity as SeverityKey} /> <V2Link href={hrefFor({ kind: "rule", id: r.check_id })} className="m2-mono">{r.check_id}</V2Link>
              </th>
              <td>{r.field ? <SapCode field={r.field} /> : null}</td>
              <td>{moduleText(r.module)}</td>
              <td>{STATUS[r.status]?.() ?? r.status}</td>
              <td className="m2-r">{failing(r.before)}</td>
              <td className="m2-r">{failing(r.after)}</td>
              <td className="m2-r">{int(r.records_resolved)}</td>
              <td className="m2-r">{int(r.records_introduced)}</td>
            </tr>
          ))}
        </tbody>
      </table></TableExport>
    </div>
  );
}

function Result({ doc }: { doc: SimulationDoc }) {
  const o = doc.dqs.overall;
  return (
    <div data-testid="whatif-result">
      <p className="m2-h2">
        {t("Score {before} to {after} ({delta})", { before: f1(o.before), after: f1(o.after), delta: signed1(o.delta) })}
      </p>
      <p className="m2-prov">
        {t("{resolved} records fixed, {introduced} broken. Findings {before} to {after}.", {
          resolved: int(doc.records.resolved), introduced: int(doc.records.introduced), before: int(doc.findings.before), after: int(doc.findings.after),
        })}
      </p>

      <div className="m2-frame" tabIndex={0}>
        <TableExport><table className="m2-tbl" aria-label={t("Score by object")}>
          <thead>
            <tr><th scope="col">{t("Object")}</th><th scope="col" className="m2-r">{t("Before")}</th><th scope="col" className="m2-r">{t("After")}</th><th scope="col" className="m2-r">{t("Change")}</th></tr>
          </thead>
          <tbody>
            {doc.dqs.modules.map((m) => (
              <tr key={m.module}>
                <th scope="row">{moduleText(m.module)} <span className="m2-mono m2-sub">{m.module}</span></th>
                <td className="m2-r">{f1(m.before)}</td><td className="m2-r">{f1(m.after)}</td><td className="m2-r">{signed1(m.delta)}</td>
              </tr>
            ))}
          </tbody>
        </table></TableExport>
      </div>

      <div className="m2-frame" tabIndex={0}>
        <TableExport><table className="m2-tbl" aria-label={t("Score by dimension")}>
          <thead>
            <tr><th scope="col">{t("Dimension")}</th><th scope="col" className="m2-r">{t("Before")}</th><th scope="col" className="m2-r">{t("After")}</th><th scope="col" className="m2-r">{t("Change")}</th></tr>
          </thead>
          <tbody>
            {doc.dqs.dimensions.map((d) => (
              <tr key={d.dimension}>
                <th scope="row">{DIMENSION[d.dimension]?.() ?? d.dimension}</th>
                <td className="m2-r">{f1(d.before)}</td><td className="m2-r">{f1(d.after)}</td><td className="m2-r">{signed1(d.delta)}</td>
              </tr>
            ))}
          </tbody>
        </table></TableExport>
      </div>

      {doc.rules.length ? <RuleTable rows={doc.rules} label={t("Rules that change")} /> : <p className="m2-prov">{t("No rule changes its result.")}</p>}

      {doc.side_effects.length ? (
        <>
          <h3 className="m2-h3">{t("Side effects")}</h3>
          <p className="m2-prov">{t("Rules you did not target that these changes break.")}</p>
          <RuleTable rows={doc.side_effects} label={t("Side effects")} />
        </>
      ) : null}

      {doc.impact.length ? (
        <>
          <h3 className="m2-h3">{t("SAP features")}</h3>
          <ul className="m2-prov" aria-label={t("SAP features")}>
            {doc.impact.map((i) => (
              <li key={`${i.module}:${i.feature}`}>{t("{feature} ({module}): {before} to {after}", { feature: i.feature, module: moduleText(i.module), before: i.before, after: i.after })}</li>
            ))}
          </ul>
        </>
      ) : null}

      {doc.best_next_fixes?.length ? (
        <>
          <h3 className="m2-h3">{t("Best next fixes")}</h3>
          <div className="m2-frame" tabIndex={0}>
            <TableExport><table className="m2-tbl" aria-label={t("Best next fixes")}>
              <thead>
                <tr><th scope="col">{t("Fix")}</th><th scope="col" className="m2-r">{t("Records changed")}</th><th scope="col" className="m2-r">{t("Score gain")}</th><th scope="col" className="m2-r">{t("Score after")}</th></tr>
              </thead>
              <tbody>
                {doc.best_next_fixes.map((b) => (
                  <tr key={b.id}>
                    <th scope="row">{b.label}</th>
                    <td className="m2-r">{int(b.records_changed)}</td><td className="m2-r">{signed1(b.dqs_gain)}</td><td className="m2-r">{f1(b.dqs_after)}</td>
                  </tr>
                ))}
              </tbody>
            </table></TableExport>
          </div>
        </>
      ) : null}

      <p className="m2-prov">
        {t("{cells} cells changed, {unmatched} records not matched. {unchanged} rules gave the same result.", {
          cells: int(doc.fixes.cells_changed), unmatched: int(doc.fixes.unmatched_records), unchanged: int(doc.unchanged_rules),
        })}
      </p>
    </div>
  );
}

function Progress({ id }: { id: string }) {
  const f = useFixture();
  const q = useQuery({
    queryKey: ["v2", "simulation", f, id],
    queryFn: () => getSimulation(id),
    retry: false,
    refetchInterval: (x) => (x.state.data && (isDone(x.state.data) || x.state.data.status === "failed") ? false : 2000),
  });
  if (q.isPending) return <Skeleton width="100%" height={80} />;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{t("The simulation could not be read. It may have expired.")}</ErrorFrame>;
  const s = q.data;
  if (isDone(s)) return <Result doc={s} />;
  if ("error" in s) return <ErrorFrame>{t("The simulation failed: {error}", { error: s.error })}</ErrorFrame>;
  const job = "job" in s ? s.job : null;
  return (
    <p className="m2-prov" role="status">
      {job?.message ?? t("Queued")}
      {job?.percent != null ? ` (${Math.round(job.percent)}%)` : ""}
    </p>
  );
}

/**
 * Run › What if: patch the stored dataset of this run with value maps, rule fixes or approved batches, re-score it,
 * and show what moves and what breaks. Nothing is written to SAP or to the run.
 */
export function WhatIf({ run, canRun }: { run: string; canRun: boolean }) {
  const [maps, setMaps] = useState<MapRow[]>([]);
  const [rules, setRules] = useState("");
  const [all, setAll] = useState(false);
  const [simId, setSimId] = useState<string | null>(null);
  const { outcome, pending, run: act } = useOutcome("whatif");

  const ruleIds = [...new Set(rules.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean))];
  const badKey = maps.find((m) => !KEY.test(m.key));
  const empty = !maps.length && !ruleIds.length && !all;
  const set = (i: number, p: Partial<MapRow>) => setMaps(maps.map((m, n) => (n === i ? { ...m, ...p } : m)));

  const submit = () =>
    void act("simulate", async () => {
      const value_maps: Record<string, Record<string, string>> = {};
      for (const m of maps) (value_maps[m.key] ??= {})[m.from === "" ? "__blank__" : m.from] = m.to;
      const r = await createSimulation({
        version_id: run,
        ...(maps.length ? { value_maps } : {}),
        ...(ruleIds.length ? { rule_fixes: ruleIds.map((check_id) => ({ check_id })) } : {}),
        all_rule_fixes: all,
      });
      setSimId(r.simulation_id);
      return { tone: "info", title: t("Simulation started. The result shows below when it is ready.") };
    });

  return (
    <section className="m2-sec" aria-label={t("What if")}>
      <div className="m2-sechead">
        <h2 className="m2-h2">{t("What if")}</h2>
        <span className="m2-sub">{simulationNote()}</span>
      </div>
      {canRun ? (
        <>
          {maps.length ? (
            <div className="m2-frame" tabIndex={0}>
              <TableExport><table className="m2-tbl" aria-label={t("Value maps")}>
                <thead>
                  <tr><th scope="col">{t("Table and field")}</th><th scope="col">{t("Value now")}</th><th scope="col">{t("New value")}</th><th scope="col" /></tr>
                </thead>
                <tbody>
                  {maps.map((m, i) => (
                    <tr key={i}>
                      <td>
                        <input className="m2-inp m2-mono" placeholder="MARA.MTART" aria-label={t("Table and field of map {n}", { n: i + 1 })} value={m.key} onChange={(e) => set(i, { key: e.target.value.toUpperCase().trim() })} />
                        {m.key && !KEY.test(m.key) ? <p className="m2-prov" role="alert">{t("Write it as TABLE.FIELD, for example MARA.MTART.")}</p> : null}
                      </td>
                      <td><input className="m2-inp" placeholder={t("Blank")} aria-label={t("Value now of map {n}", { n: i + 1 })} value={m.from} onChange={(e) => set(i, { from: e.target.value })} /></td>
                      <td><input className="m2-inp" aria-label={t("New value of map {n}", { n: i + 1 })} value={m.to} onChange={(e) => set(i, { to: e.target.value })} /></td>
                      <td><button type="button" className="m2-btn m2-sm m2-ghost" onClick={() => setMaps(maps.filter((_, n) => n !== i))}>{t("Remove")}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table></TableExport>
            </div>
          ) : null}
          <Fld label={t("Apply the stored fix of these rules")} hint={t("Rule IDs, separated by spaces or commas.")} mono>
            <input value={rules} onChange={(e) => setRules(e.target.value)} />
          </Fld>
          <Sw checked={all} onChange={setAll} label={t("Apply the stored fix of every rule")} />
          {outcome ? <ResultFrame outcome={outcome} /> : null}
          <div className="m2-adm-acts">
            <button type="button" className="m2-btn m2-ghost" onClick={() => setMaps([...maps, { key: "", from: "", to: "" }])}>{t("Add a value map")}</button>
            <button type="button" className="m2-btn" disabled={empty || !!badKey || pending !== null} onClick={submit}>
              {pending === "simulate" ? t("Starting…") : t("Simulate")}
            </button>
          </div>
          {empty ? <p className="m2-prov">{t("Give at least one value map or rule to simulate.")}</p> : null}
        </>
      ) : (
        <p className="m2-prov">{t("Simulating needs the analyse permission.")}</p>
      )}
      {simId ? <Progress key={simId} id={simId} /> : null}
    </section>
  );
}
