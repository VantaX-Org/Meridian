"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getFindings } from "@/lib/api/v2/insights";
import { getTimeline } from "@/lib/api/v2/runs";
import type { TimelineRun } from "@/lib/api/v2/runs";
import type { Landscape, LandscapeCell, LandscapeSystem } from "@/lib/api/v2/types";
import { formatDate } from "@/lib/format";
import { runKeys } from "@/lib/v2/runs-queries";
import { useTopWork } from "@/lib/v2/queries";
import { runLabel } from "@/lib/v2/run-label";
import { moduleText } from "@/lib/v2/labels";
import { f1, int, moduleSlug, systemSlug, VERDICT_LABEL } from "@/lib/v2/score";
import { t } from "@/lib/v2/i18n";
import { Money } from "../Money";
import { ObjectTrend } from "../ObjectTrend";
import { InactiveChip } from "../RunParts";
import { Ruler } from "../Ruler";
import { Dash, EmptyFrame, ErrorFrame, Skeleton, V2Link } from "../parts";
import { dimsOf } from "../shell/ObjectsTree";
import { KeyText, keyValue } from "./work-parts";

const LIMIT = 50;
const measured = (c: LandscapeCell): number | null => c.raw_score ?? c.score;
const objectHref = (system: string, module: string) => `/o/${systemSlug(system)}/${moduleSlug(module)}`;

/** The measured score of one object in one run of the timeline. */
const at = (r: TimelineRun | undefined, module: string): number | null => {
  const o = r?.objects[module];
  return o ? (o.raw_score ?? o.score) : null;
};

interface Mover {
  system: LandscapeSystem;
  module: string;
  label: string;
  delta: number;
  from: number;
  to: number;
  run: TimelineRun;
}

/** Each object's change between its two newest scored runs, most negative first. Objects that did not fall are left out. */
export function worstMovers(systems: readonly LandscapeSystem[], timelines: ReadonlyArray<readonly TimelineRun[] | undefined>, label: (m: string) => string, limit = 5): Mover[] {
  const out: Mover[] = [];
  systems.forEach((system, i) => {
    const runs = timelines[i] ?? [];
    const modules = new Set(runs.flatMap((r) => Object.keys(r.objects)));
    for (const mod of modules) {
      const scored = runs.filter((r) => at(r, mod) != null);
      const [prev, last] = [scored[scored.length - 2], scored[scored.length - 1]];
      if (!prev || !last) continue;
      const from = at(prev, mod) as number;
      const to = at(last, mod) as number;
      if (to < from) out.push({ system, module: mod, label: label(mod), delta: to - from, from, to, run: last });
    }
  });
  return out.sort((a, b) => a.delta - b.delta).slice(0, limit);
}

function SystemStrip({ L, system, runs, failed }: { L: Landscape; system: LandscapeSystem; runs: readonly TimelineRun[] | undefined; failed: boolean }) {
  const cells = L.cells.filter((c) => c.system_id === system.id);
  const inactive = system.is_active === false;
  const scores = cells.map(measured).filter((v): v is number => v != null);
  const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const verdict = cells.some((c) => c.verdict === "no-go") ? "no-go" : cells.some((c) => c.verdict === "at-risk") ? "at-risk" : cells.length ? "go" : null;
  const newest = runs?.[runs.length - 1];
  const open = cells.reduce((n, c) => n + (c.open_work ?? 0), 0);
  const risk = newest ? Object.values(newest.objects).reduce((n, o) => n + (o.value_at_risk?.amount ?? 0), 0) : 0;
  const currency = newest ? Object.values(newest.objects).find((o) => o.value_at_risk)?.value_at_risk?.currency : undefined;
  const rep = cells[0];
  return (
    <li className="m2-hs-strip" data-testid="home-strip" data-inactive={inactive ? "true" : undefined}>
      <div className="m2-hs-id">
        <b>{system.name}</b> {inactive ? <InactiveChip /> : <span className="m2-meta">{t("Active")}</span>}
      </div>
      {failed ? (
        <div className="m2-hs-err" role="alert" data-testid="home-strip-error">
          {t("The runs of {system} could not be read.", { system: system.name })} <V2Link href={`/s`}>{t("Open systems")}</V2Link>
        </div>
      ) : cells.length === 0 ? (
        <div className="m2-hs-none">
          {system.state === "not_extracted" ? t("{system} is not extracted yet.", { system: system.name }) : t("{system} has no finished run yet.", { system: system.name })}{" "}
          <V2Link href="/s">{t("Open systems")}</V2Link>
        </div>
      ) : (
        <>
          <span className="m2-hs-run" title={newest ? formatDate(newest.run_at, "datetime") : undefined}>{newest ? runLabel(system.name, newest.run_number) : <Dash why={t("The run list does not hold the newest run")} />}</span>
          <span className="m2-hs-score" title={t("Mean measured score of this system's objects at their newest runs, out of 100.")}>
            {rep ? <Ruler size={48} dims={dimsOf(rep)} measured={mean} score={mean} capped={false} capLevel={null} breaches={[]} label={system.name} records={null} rules={null} coverage={null} lowConfidence={false} /> : null}
            {verdict ? <span className="m2-meta">{VERDICT_LABEL[verdict]}</span> : null}
          </span>
          <span className="m2-hs-trend">
            {runs && cells.length ? <MeanTrend runs={runs} cells={cells} system={system.name} /> : <Skeleton width={120} height={20} />}
          </span>
          <span title={t("Records that fail at least one rule, summed over the objects of this system.")}>{t("{n} open findings", { n: int(open) })}</span>
          <span title={t("Priced cost of the open findings in the newest run, from the cost model.")}>{risk ? <Money amount={risk} currency={currency} /> : <Dash why={t("Nothing could be priced")} />}</span>
        </>
      )}
    </li>
  );
}

/** The system's trend is its worst-scoring object's own ribbon: a mean would hide the object that fell. */
function MeanTrend({ runs, cells, system }: { runs: readonly TimelineRun[]; cells: LandscapeCell[]; system: string }) {
  const low = [...cells].sort((a, b) => (measured(a) ?? 101) - (measured(b) ?? 101))[0];
  return <ObjectTrend size="inline" runs={runs} module={low.module} system={system} object={low.module} selectedId={low.run_id} />;
}

function FindingsUnverified() {
  const fixture = useFixture();
  const q = useQuery({ queryKey: ["aletheia-found", fixture, ""], queryFn: () => getFindings(), staleTime: 60_000 });
  const items = (q.data?.findings ?? []).slice(0, 3);
  return (
    <section className="m2-hs-col" aria-labelledby="hs-ver" data-testid="home-verified">
      <h2 className="m2-h2" id="hs-ver">{t("Found by Aletheia")}</h2>
      <p className="m2-meta">{t("Unverified: measured facts that nobody has confirmed yet. Confirm one before you act on it.")}</p>
      {q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("What Aletheia found could not be read.")}</ErrorFrame>
      ) : q.isPending ? (
        <Skeleton width={240} height={14} />
      ) : items.length === 0 ? (
        <EmptyFrame action={<V2Link href="/runs">{t("Open the runs")}</V2Link>}>{t("Aletheia has found nothing yet. Findings appear after a run that scores an object.")}</EmptyFrame>
      ) : (
        <ul className="m2-hs-list">
          {items.map((f) => (
            <li key={f.id}>
              {f.action.kind === "across" ? (
                // A cross-system finding has no rule, so the backend sends an empty name: say what it is and open the duplicates.
                <V2Link href={`/o/_/${moduleSlug(f.module)}/golden#across-systems`}>
                  {t("{n} {n2, plural, one {pair} other {pairs}} of {label} records exist in more than one connected system as separate records", { n: int(f.affected), n2: f.affected, label: moduleText(f.module) })}
                </V2Link>
              ) : (
                <>
                  <V2Link href={`/o/_/${moduleSlug(f.module)}/rules`}>{f.name}</V2Link>{" "}
                  <span className="m2-meta">{t("{n} records affected", { n: int(f.affected) })}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The top of Home: a strip per system at its newest run (never a run picker), then three columns: the objects that
 * fell furthest since their previous run, the top of the fix queue, and what Aletheia found.
 */
export function HomeHeadlines({ L }: { L: Landscape }) {
  const fixture = useFixture();
  // Every system keeps its strip, a never-extracted one included, so the strips add up to the lede's count.
  const systems = L.systems;
  const lines = useQueries({ queries: systems.map((s) => ({ queryKey: runKeys.timeline(fixture, s.id, LIMIT, undefined), queryFn: () => getTimeline(s.id, LIMIT), staleTime: 30_000 })) });
  const work = useTopWork(5);
  const label = (m: string) => L.objects.find((o) => o.module === m)?.label ?? m;
  const timelines = lines.map((q) => q.data?.runs);
  const movers = worstMovers(systems, timelines, label);
  const nSys = systems.filter((s) => L.cells.some((c) => c.system_id === s.id)).length;
  return (
    <>
      <p className="m2-meta" data-testid="home-strips-note">
        {t("{s} of {n} systems have a finished run, each shown at its newest. Scores are measured out of 100; open any object for its run detail.", { s: nSys, n: systems.length })}
      </p>
      <section className="m2-sec" aria-labelledby="hs-sys" data-testid="home-strips">
        <div className="m2-sechead">
          <h2 className="m2-h2" id="hs-sys">{t("Systems")}</h2>
          <V2Link href="/objects">{t("All objects")}</V2Link>
        </div>
        <ul className="m2-hs-strips">
          {systems.map((s, i) => (
            <SystemStrip key={s.id} L={L} system={s} runs={lines[i]?.data?.runs} failed={Boolean(lines[i]?.isError)} />
          ))}
        </ul>
      </section>
      <div className="m2-hs-cols">
        <section className="m2-hs-col" aria-labelledby="hs-mov" data-testid="home-movers">
          <h2 className="m2-h2" id="hs-mov">{t("Worst movers since last run")}</h2>
          <p className="m2-meta">{t("Change in measured score between an object's two newest runs, in points.")}</p>
          {lines.some((q) => q.isPending) ? (
            <Skeleton width={240} height={14} />
          ) : movers.length === 0 ? (
            <EmptyFrame action={<V2Link href="/objects">{t("All objects")}</V2Link>}>{t("No object scored lower than at its previous run, or none has two runs yet.")}</EmptyFrame>
          ) : (
            <ul className="m2-hs-list">
              {movers.map((m) => (
                <li key={`${m.system.id}:${m.module}`} title={t("{name}, {date}: measured {score}", { name: runLabel(m.system.name, m.run.run_number), date: formatDate(m.run.run_at, "date"), score: f1(m.to) })}>
                  <V2Link href={objectHref(m.system.name, m.module)}>{m.label}</V2Link>{" "}
                  <span className="m2-meta">{m.system.name}</span> <b>{m.delta.toFixed(1)}</b>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="m2-hs-col" aria-labelledby="hs-fix" data-testid="home-fixqueue">
          <h2 className="m2-h2" id="hs-fix">{t("Fix queue")}</h2>
          <p className="m2-meta">{t("Records to fix, the ones with the most value at risk first.")}</p>
          {work.isError ? (
            <ErrorFrame onRetry={() => void work.refetch()}>{t("The next rows to fix could not be read.")}</ErrorFrame>
          ) : work.isPending ? (
            <Skeleton width={240} height={14} />
          ) : (work.data?.items ?? []).length === 0 ? (
            <EmptyFrame action={<V2Link href="/work">{t("Open Work")}</V2Link>}>{t("No record is waiting to be fixed in the current state.")}</EmptyFrame>
          ) : (
            <>
              <ul className="m2-hs-list">
                {(work.data?.items ?? []).map((r) => {
                  // Several rows can fail the same rule: the record key tells them apart, as SAP shows it.
                  const key = keyValue(r, 0);
                  const rule = r.checks[0];
                  return (
                    <li key={`${r.module}:${r.record_key}`}>
                      <V2Link href={rule ? `/work?module=${encodeURIComponent(r.module)}&rule=${encodeURIComponent(rule)}` : `/work?module=${encodeURIComponent(r.module)}`}>{r.top_message ?? r.record_key}</V2Link>{" "}
                      <span className="m2-meta">{label(r.module)}</span>{key ? <> <KeyText value={key} /></> : null}
                    </li>
                  );
                })}
              </ul>
              <V2Link href="/work">{t("Open the whole fix queue ({total})", { total: int(work.data?.total ?? 0) })}</V2Link>
            </>
          )}
        </section>
        <FindingsUnverified />
      </div>
    </>
  );
}
