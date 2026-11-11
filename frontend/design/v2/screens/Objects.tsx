"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { formatDate } from "@/lib/format";
import type { Landscape, LandscapeCell, LandscapeSystem } from "@/lib/api/v2/types";
import { useRunParam } from "@/lib/v2/hooks";
import { useLandscape } from "@/lib/v2/queries";
import { useTimeline } from "@/lib/v2/runs-queries";
import { runLabel } from "@/lib/v2/run-label";
import { f1, int, moduleFromSlug, moduleSlug, systemSlug } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { Money } from "../Money";
import { ObjectTrend } from "../ObjectTrend";
import { CodeWithText, InactiveChip, Lede, PrimaryAction } from "../RunParts";
import { Ruler } from "../Ruler";
import { CanvasSkeleton, Dash, EmptyFrame, ErrorFrame, PageTitle, V2Link } from "../parts";
import { dimsOf } from "../shell/ObjectsTree";
import { TableExport } from "@/design/v2/TableExport";

/** The lowest measured score on the board, with its system, so the primary action has a target. */
function worst(L: Landscape): { cell: LandscapeCell; system: LandscapeSystem; label: string } | null {
  let best: { cell: LandscapeCell; system: LandscapeSystem; label: string } | null = null;
  for (const c of L.cells) {
    const v = c.raw_score ?? c.score;
    const system = L.systems.find((s) => s.id === c.system_id);
    if (v == null || !system) continue;
    if (!best || v < (best.cell.raw_score ?? best.cell.score ?? 101)) best = { cell: c, system, label: L.objects.find((o) => o.module === c.module)?.label ?? c.module };
  }
  return best;
}

function SystemBlock({ L, system, pinned }: { L: Landscape; system: LandscapeSystem; pinned: boolean }) {
  const runs = useTimeline(system.id, 50).data?.runs ?? [];
  const cells = L.cells.filter((c) => c.system_id === system.id).sort((a, b) => (a.raw_score ?? a.score ?? 101) - (b.raw_score ?? b.score ?? 101));
  const inactive = system.is_active === false;
  const here = new Set(cells.map((c) => c.module));
  const missing = L.objects.filter((o) => !here.has(o.module) && runs.some((r) => r.objects[o.module]));
  return (
    <section className="m2-sec" aria-labelledby={`ob-${system.id}`} data-testid="objects-system">
      <h2 className="m2-h2" id={`ob-${system.id}`}>
        {system.name} {inactive ? <InactiveChip /> : null}
      </h2>
      {cells.length === 0 ? (
        <EmptyFrame action={<V2Link href="/s">{t("Open systems")}</V2Link>}>
          {system.state === "extracted" ? t("{system} is extracted but no run has scored it yet. Start an analysis from the systems page.", { system: system.name }) : t("{system} has no finished run. Extract it, then run an analysis.", { system: system.name })}
        </EmptyFrame>
      ) : (
        <TableExport><table className="m2-tbl m2-ob-table">
          <caption className="m2-sr">{t("Objects of {system}, lowest measured score first", { system: system.name })}</caption>
          <thead>
            <tr>
              <th scope="col">{t("Object")}</th>
              <th scope="col" title={t("Measured score out of 100 from the rules that ran, before any cap for failing critical rules.")}>{t("Score, 0 to 100")}</th>
              <th scope="col" title={t("The measured score at each of this object's finished runs, oldest to newest. Hover a point for its run and date.")}>{t("Trend")}</th>
              <th scope="col" title={t("Records that fail at least one rule, summed over the object's rules, at the run shown.")}>{t("Open findings")}</th>
              <th scope="col" title={t("Priced cost of the open findings, from the cost model. A dash means nothing could be priced.")}>{t("At risk")}</th>
              <th scope="col">{t("Run")}</th>
            </tr>
          </thead>
          <tbody>
            {cells.map((c) => {
              const label = L.objects.find((o) => o.module === c.module)?.label ?? c.module;
              const run = runs.find((r) => r.id === c.run_id);
              const o = run?.objects[c.module];
              return (
                <tr key={c.module} data-testid="objects-row">
                  <th scope="row">
                    <V2Link href={`/o/${systemSlug(system.name)}/${moduleSlug(c.module)}${pinned ? `?run=${c.run_id}` : ""}`}>
                      <CodeWithText code={c.module} text={label} />
                    </V2Link>
                  </th>
                  <td>
                    <span className="m2-ob-score">
                      <Ruler size={48} dims={dimsOf(c)} measured={c.raw_score} score={c.score} capped={c.capped} capLevel={c.cap_level} breaches={c.breaches} label={label} records={c.records_checked} rules={c.rules_measured} coverage={c.coverage} lowConfidence={c.low_confidence} />
                    </span>
                  </td>
                  <td>
                    <ObjectTrend size="inline" runs={runs} module={c.module} system={system.name} object={label} selectedId={c.run_id} />
                  </td>
                  <td className="m2-num">{o?.findings_open != null ? int(o.findings_open) : <Dash why={t("This run stored no findings for the object")} />}</td>
                  <td className="m2-num">{o?.value_at_risk ? <Money amount={o.value_at_risk.amount} currency={o.value_at_risk.currency} /> : <Dash why={t("Nothing could be priced for this object")} />}</td>
                  <td>
                    {run ? (
                      <span title={formatDate(run.run_at, "datetime")}>{runLabel(system.name, run.run_number)}</span>
                    ) : (
                      <Dash why={t("The run list does not hold this run")} />
                    )}
                  </td>
                </tr>
              );
            })}
            {missing.map((o) => (
              <tr key={o.module} className="m2-ob-gap" data-testid="objects-row-missing">
                <th scope="row"><CodeWithText code={o.module} text={o.label} /></th>
                <td colSpan={5}>{t("Not in the run shown. Earlier runs scored it; open the object to see them.")}</td>
              </tr>
            ))}
          </tbody>
        </table></TableExport>
      )}
    </section>
  );
}

/**
 * `/objects`: every object of every system on one board, each at its own newest finished run (or at the run in the
 * address when one is pinned). Systems that are switched off but hold finished runs stay, labelled.
 */
export function ObjectsCanvas() {
  const run = useRunParam();
  const q = useLandscape(run);
  const raw = useSearchParams().get("module");
  const only = raw ? moduleFromSlug(raw) : null;
  // `?module=` narrows the board to one object on every system; the landscape API has no module filter.
  const L = useMemo(() => (q.data && only ? { ...q.data, cells: q.data.cells.filter((c) => c.module === only), objects: q.data.objects.filter((o) => o.module === only) } : q.data), [q.data, only]);
  const w = useMemo(() => (L ? worst(L) : null), [L]);
  if (q.isError) {
    return (
      <>
        <PageTitle>{t("Objects")}</PageTitle>
        <div className="m2-sec">
          <ErrorFrame onRetry={() => void q.refetch()}>{t("The objects could not be read. Check that the API is reachable, then retry. You can still open Runs from the menu.")}</ErrorFrame>
        </div>
      </>
    );
  }
  if (!L) return <CanvasSkeleton blocks={3} />;
  const systems = L.systems.filter((s) => (only ? L.cells.some((c) => c.system_id === s.id) : s.state !== "not_extracted" || L.cells.some((c) => c.system_id === s.id)));
  const onlyLabel = only ? (L.objects[0]?.label ?? only) : null;
  const n = L.cells.length;
  return (
    <>
      <PageTitle>{t("Objects")}</PageTitle>
      <Lede>
        {n === 0
          ? t("No object has a finished run yet, so there is nothing to score.")
          : run
            ? t("{n} objects across {s} systems, as scored by the one run you pinned. Scores are out of 100.", { n, s: systems.length })
            : t("{n} objects across {s} systems, each at its own newest finished run. Scores are out of 100.", { n, s: systems.length })}
      </Lede>
      {only ? (
        <div className="m2-banner" role="status" data-testid="objects-module-filter">
          {L.objects.length ? t("Showing {object} only, on every system that scored it.", { object: onlyLabel }) : t("No system has scored {object} yet.", { object: only })} <V2Link href={run ? `/objects?run=${run}` : "/objects"}>{t("Show all objects")}</V2Link>
        </div>
      ) : null}
      {run ? (
        <div className="m2-banner" role="status">
          {t("Pinned to one run. Pinned scores come from that run only.")} <V2Link href="/objects">{t("Show each object at its newest run")}</V2Link>
        </div>
      ) : null}
      {w ? (
        <PrimaryAction
          action={
            <V2Link className="m2-btn m2-strong" href={`/o/${systemSlug(w.system.name)}/${moduleSlug(w.cell.module)}`}>
              {t("Open {object} on {system}", { object: w.label, system: w.system.name })}
            </V2Link>
          }
          why={t("It has the lowest measured score on the board, {score}.", { score: f1(w.cell.raw_score ?? w.cell.score) })}
        />
      ) : (
        <PrimaryAction action={<V2Link className="m2-btn m2-strong" href="/s">{t("Open systems")}</V2Link>} why={t("Extract a system and run an analysis to score its objects.")} />
      )}
      {systems.map((s) => (
        <SystemBlock key={s.id} L={L} system={s} pinned={Boolean(run)} />
      ))}
    </>
  );
}
