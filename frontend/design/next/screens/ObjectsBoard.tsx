"use client";

/**
 * `/objects` in the new interface: every object of every system, each at its own newest finished run or at the run
 * pinned in the address, led by how the scores spread. `?module=` narrows the board to one object on every system.
 * The per-system tables are the old ones (score ruler, trend, findings, value at risk, run, export), so nothing is lost.
 */
import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { SystemBlock, worst } from "@/design/v2/screens/Objects";
import { V2Link } from "@/design/v2/parts";
import { useRunParam } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { useLandscape } from "@/lib/v2/queries";
import { f1, int, moduleFromSlug, moduleSlug, systemSlug } from "@/lib/v2/score";
import { EmptyState, ErrorState, Skeleton } from "../kit";
import { SegBar, type Seg } from "../kit/viz";
import { LegacyScope } from "../shell/LegacyMount";
import "../portfolio/portfolio.css";

export function ObjectsBoard() {
  const run = useRunParam();
  const q = useLandscape(run);
  const raw = useSearchParams().get("module");
  const only = raw ? moduleFromSlug(raw) : null;
  // The landscape API has no module filter, so `?module=` is applied here.
  const L = useMemo(() => (q.data && only ? { ...q.data, cells: q.data.cells.filter((c) => c.module === only), objects: q.data.objects.filter((o) => o.module === only) } : q.data), [q.data, only]);
  const w = useMemo(() => (L ? worst(L) : null), [L]);
  const segs = useMemo<Seg[]>(() => {
    const scores = (L?.cells ?? []).map((c) => c.raw_score ?? c.score);
    const n = (test: (v: number) => boolean) => scores.filter((v) => v != null && test(v)).length;
    return [
      { key: "good", label: t("90 or more"), value: n((v) => v >= 90), tone: "good" },
      { key: "warn", label: t("70 to 90"), value: n((v) => v >= 70 && v < 90), tone: "warn" },
      { key: "bad", label: t("Under 70"), value: n((v) => v < 70), tone: "bad" },
      { key: "none", label: t("Not scored"), value: scores.filter((v) => v == null).length, tone: "quiet" },
    ];
  }, [L]);

  if (q.isError) {
    return (
      <main className="nx-pf" data-testid="objects-board">
        <header className="nx-pf-head"><div><h1>{t("Objects")}</h1></div></header>
        <ErrorState error={q.error} fallback={t("The objects could not be read. Check that the API is reachable, then retry. You can still open Runs from the menu.")} onRetry={() => void q.refetch()} />
      </main>
    );
  }
  if (!L) return <main className="nx-pf"><Skeleton lines={6} label={t("Loading the objects")} /></main>;

  const systems = L.systems.filter((s) => (only ? L.cells.some((c) => c.system_id === s.id) : s.state !== "not_extracted" || L.cells.some((c) => c.system_id === s.id)));
  const onlyLabel = only ? (L.objects[0]?.label ?? only) : null;
  const n = L.cells.length;
  const lede = n === 0
    ? t("No object has a finished run yet, so there is nothing to score.")
    : run
      ? t("{n} objects across {s} systems, as scored by the one run you pinned. Scores are out of 100.", { n, s: systems.length })
      : t("{n} objects across {s} systems, each at its own newest finished run. Scores are out of 100.", { n, s: systems.length });

  return (
    <main className="nx-pf" data-testid="objects-board">
      <header className="nx-pf-head">
        <div>
          <h1>{t("Objects")}</h1>
          <p>{lede}</p>
        </div>
        {w ? (
          <V2Link className="nx-btn nx-btn-primary" href={`/o/${systemSlug(w.system.name)}/${moduleSlug(w.cell.module)}`} title={t("It has the lowest measured score on the board, {score}.", { score: f1(w.cell.raw_score ?? w.cell.score) })}>
            {t("Open {object} on {system}", { object: w.label, system: w.system.name })}
          </V2Link>
        ) : (
          <V2Link className="nx-btn nx-btn-primary" href="/s">{t("Open systems")}</V2Link>
        )}
      </header>
      {only ? (
        <p className="nx-muted" role="status" data-testid="objects-module-filter">
          {L.objects.length ? t("Showing {object} only, on every system that scored it.", { object: onlyLabel }) : t("No system has scored {object} yet.", { object: only })} <V2Link href={run ? `/objects?run=${run}` : "/objects"}>{t("Show all objects")}</V2Link>
        </p>
      ) : null}
      {run ? (
        <p className="nx-muted" role="status">
          {t("Pinned to one run. Pinned scores come from that run only.")} <V2Link href="/objects">{t("Show each object at its newest run")}</V2Link>
        </p>
      ) : null}
      {n === 0 ? (
        <EmptyState heading={t("No object has a finished run yet, so there is nothing to score.")} action={<V2Link className="nx-btn nx-btn-secondary" href="/s">{t("Open systems")}</V2Link>}>
          {t("Extract a system and run an analysis to score its objects.")}
        </EmptyState>
      ) : (
        <section className="nx-card" aria-labelledby="nx-ob-spread" data-testid="lead-objects">
          <h2 id="nx-ob-spread" className="nx-sec-h">{t("How the scores spread")}</h2>
          <p className="nx-muted">{t("{n} objects by measured score.", { n: int(n) })}</p>
          <SegBar segs={segs} format={(v) => int(v)} testid="lead-chart-objects" />
        </section>
      )}
      <LegacyScope>
        {systems.map((s) => <SystemBlock key={s.id} L={L} system={s} pinned={Boolean(run)} />)}
      </LegacyScope>
    </main>
  );
}
