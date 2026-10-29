"use client";

import { Fragment, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { formatDate } from "@/lib/format";
import type { Landscape, LandscapeCell, LandscapeSystem, WorkRow } from "@/lib/api/v2/types";
import { useOpenItem, useRunParam, useV2Session, type V2Persona } from "@/lib/v2/hooks";
import { useLandscape, useStatus, useTopWork } from "@/lib/v2/queries";
import { f1, int, moduleSlug, readingText, systemSlug, VERDICT_LABEL } from "@/lib/v2/score";
import { Grid, type GridColumn } from "../Grid";
import { VerdictMark } from "../marks";
import { Dash, Dot, EmptyFrame, ErrorFrame, Mono, PageTitle, Skeleton, V2Link } from "../parts";
import { Ruler } from "../Ruler";
import { dimsOf } from "../shell/MapPane";

const SEL_KEY = "mn_v2_sel";

function readSelected(): string | null {
  try {
    return window.sessionStorage.getItem(SEL_KEY);
  } catch {
    return null;
  }
}
const noop = () => () => undefined;
/** The cell last opened, so coming back to the landscape shows where you were. Kept for the tab. */
function useSelectedCell(): string | null {
  return useSyncExternalStore(noop, readSelected, () => null);
}
function rememberCell(id: string): void {
  try {
    window.sessionStorage.setItem(SEL_KEY, id);
  } catch {
    /* storage blocked: the landscape just opens with nothing selected */
  }
}

/** The one sentence the landscape opens with, from /landscape.sentence. Rule ids open the rule in the inspector. */
export function LandscapeSentence({ landscape }: { landscape: Landscape }) {
  const { hrefFor } = useOpenItem();
  const s = landscape.sentence;
  if (s.objects === 0) return <>No object has a run yet. Extract a system and run an analysis to score it.</>;
  const ids = s.release_if_fixed;
  return (
    <>
      {`${s.held_under_85} of ${s.objects} objects are held under 85 by ${s.critical_over_tolerance} critical ${s.critical_over_tolerance === 1 ? "rule" : "rules"} over tolerance`}
      {ids.length > 0 && s.released > 0 ? (
        <>
          {"; fixing "}
          {ids.map((id, i) => (
            <Fragment key={id}>
              {i > 0 ? (i === ids.length - 1 ? " and " : ", ") : null}
              <V2Link href={hrefFor({ kind: "rule", id })} className="m2-mono">
                {id}
              </V2Link>
            </Fragment>
          ))}
          {` would release ${s.released} of them`}
        </>
      ) : null}
      {"."}
    </>
  );
}

/** The next-step button, by persona. One per canvas. */
export function NextStep({ landscape, persona }: { landscape: Landscape; persona: V2Persona }) {
  const { hrefFor } = useOpenItem();
  if (persona === "steward") {
    return (
      <V2Link href="/v2/work" className="m2-btn m2-next">
        Accept the suggested values
      </V2Link>
    );
  }
  if (persona === "basis") {
    const s = landscape.systems.find((x) => x.state === "not_extracted") ?? landscape.systems.find((x) => x.state === "extracted") ?? landscape.systems[0];
    if (!s) return null;
    const label = s.state === "extracted" ? `Run analysis on ${s.name}` : `Extract ${s.name}`;
    return (
      <V2Link href={hrefFor({ kind: "system", id: s.id })} className="m2-btn m2-next">
        {label}
      </V2Link>
    );
  }
  return (
    <V2Link href="/v2/work?verdict=no-go" className="m2-btn m2-next">
      Open the no-go objects
    </V2Link>
  );
}

function SystemHead({ system }: { system: LandscapeSystem }) {
  const { hrefFor } = useOpenItem();
  const link = (label: string) => <V2Link href={hrefFor({ kind: "system", id: system.id })}>{label}</V2Link>;
  return (
    <>
      <div className="m2-hn">{system.name}</div>
      <div className="m2-hs">{[system.version, system.client ? `client ${system.client}` : null].filter(Boolean).join(", ") || " "}</div>
      <div className="m2-hs">
        {system.state === "not_extracted" ? (
          <>Not extracted yet. {link("Extract")}</>
        ) : (
          <>
            {`Extracted ${formatDate(system.last_extracted_at, "datetime")}, ${int(system.records)} records`}
            {system.state === "extracted" ? <> {link("Run analysis")}</> : null}
          </>
        )}
      </div>
    </>
  );
}

function CellLink({ system, cell, label, selected, run }: { system: LandscapeSystem; cell: LandscapeCell; label: string; selected: boolean; run: string | null }) {
  const reading = readingText({ label, measured: cell.raw_score, score: cell.score, capped: cell.capped, capLevel: cell.cap_level, breaches: cell.breaches, dims: dimsOf(cell), records: cell.records_checked, rules: cell.rules_measured, coverage: cell.coverage, lowConfidence: cell.low_confidence });
  const href = `/v2/o/${systemSlug(system.name)}/${moduleSlug(cell.module)}${run ? `?run=${run}` : ""}`;
  return (
    <V2Link
      href={href}
      className="m2-cell"
      data-selected={selected ? "true" : undefined}
      data-testid="matrix-cell"
      title={reading}
      aria-label={`${label}, ${system.name}, ${f1(cell.score)}${cell.capped ? " capped" : ""}, ${VERDICT_LABEL[cell.verdict]}${cell.low_confidence ? ", low coverage" : ""}`}
      onClick={() => rememberCell(`${system.id}:${cell.module}`)}
    >
      <Ruler
        size={48}
        dims={dimsOf(cell)}
        measured={cell.raw_score}
        score={cell.score}
        capped={cell.capped}
        capLevel={cell.cap_level}
        breaches={cell.breaches}
        label={label}
        records={cell.records_checked}
        rules={cell.rules_measured}
        coverage={cell.coverage}
        lowConfidence={cell.low_confidence}
        selected={selected}
      />
      <span className="m2-cell-vd m2-v">
        <VerdictMark verdict={cell.verdict} />
        {VERDICT_LABEL[cell.verdict]}
      </span>
      <span className="m2-cell-sub">
        {`${int(cell.records_checked)} rec, ${int(cell.rules_measured)} rules`}
        {cell.low_confidence ? <span className="m2-lcm">low coverage</span> : null}
      </span>
    </V2Link>
  );
}

function otherCell(system: LandscapeSystem): ReactNode {
  if (system.state === "extracted") return <span className="m2-st">Not analysed</span>;
  if (system.state === "not_extracted") return <span className="m2-st">Not extracted</span>;
  return <Dash why="This object has no run on this system" />;
}

export function Coverage({ landscape, run }: { landscape: Landscape; run: string | null }) {
  const params = useSearchParams();
  const selected = useSelectedCell();
  const chosen = params.get("system");
  const systems = landscape.systems.filter((s) => !chosen || systemSlug(s.name) === chosen);
  const cellOf = (system: LandscapeSystem, module: string) => landscape.cells.find((c) => c.system_id === system.id && c.module === module);
  const { go, at_risk, no_go } = landscape.counts;
  return (
    <section className="m2-sec" aria-label="Coverage matrix">
      <div className="m2-sechead">
        <h2 className="m2-h2">Coverage</h2>
        <span className="m2-sub">{`${go} go, ${at_risk} at risk, ${no_go} no-go`}</span>
      </div>
      <div className="m2-frame m2-only-wide">
        <table className="m2-tbl m2-mx" data-testid="coverage-matrix">
          <colgroup>
            <col style={{ width: 170 }} />
            {systems.map((s) => (
              <col key={s.id} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Object</th>
              {systems.map((s) => (
                <th key={s.id} scope="col">
                  <SystemHead system={s} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {landscape.objects.map((o) => (
              <tr key={o.module}>
                <th scope="row">
                  <span className="m2-oname">{o.label}</span>
                </th>
                {systems.map((s) => {
                  const cell = cellOf(s, o.module);
                  return <td key={s.id}>{cell ? <CellLink system={s} cell={cell} label={o.label} selected={selected === `${s.id}:${o.module}`} run={run} /> : otherCell(s)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="m2-mlist">
        {landscape.cells
          .filter((c) => !chosen || systemSlug(landscape.systems.find((s) => s.id === c.system_id)?.name ?? "") === chosen)
          .map((c) => {
            const s = landscape.systems.find((x) => x.id === c.system_id);
            const label = landscape.objects.find((o) => o.module === c.module)?.label ?? c.module;
            if (!s) return null;
            return (
              <V2Link key={`${c.system_id}:${c.module}`} href={`/v2/o/${systemSlug(s.name)}/${moduleSlug(c.module)}${run ? `?run=${run}` : ""}`} className="m2-lrow" onClick={() => rememberCell(`${s.id}:${c.module}`)}>
                <span>{label}</span>
                <span className="m2-v">
                  <VerdictMark verdict={c.verdict} />
                  {VERDICT_LABEL[c.verdict]}
                </span>
                <span className="m2-c">
                  <Ruler size={48} dims={dimsOf(c)} measured={c.raw_score} score={c.score} capped={c.capped} capLevel={c.cap_level} breaches={c.breaches} label={label} records={c.records_checked} rules={c.rules_measured} coverage={c.coverage} lowConfidence={c.low_confidence} />
                </span>
                <span className="m2-c">
                  {`${int(c.records_checked)} records checked, ${int(c.rules_measured)} rules measured`}
                  {c.low_confidence ? <span className="m2-lcm">low coverage</span> : null}
                  {landscape.systems.length > 1 ? `, ${s.name}` : ""}
                </span>
              </V2Link>
            );
          })}
      </div>
    </section>
  );
}

function recordKey(r: WorkRow): string {
  return `${r.module}:${r.record_key}`;
}

const NEXT_WORK_COLUMNS: GridColumn<WorkRow>[] = [
  { id: "record", header: "Record", width: 200, pin: true, locked: true, cell: (r) => <Mono>{r.record_key.split("=").slice(1).join("=") || r.record_key}</Mono> },
  { id: "name", header: "Name", width: 200, cell: (r) => r.name ?? <Dash /> },
  { id: "problem", header: "Problem", width: 260, cell: (r) => r.top_message ?? <Dash /> },
  { id: "value", header: "Current to suggested", width: 200, cell: (r) => (r.suggested_value ? <Mono>{r.suggested_value}</Mono> : <Dash why="No suggested value" />) },
  { id: "var", header: "Value at risk", width: 130, numeric: true, cell: (r) => (r.value_at_risk == null ? <Dash /> : <>{int(r.value_at_risk)} <span className="m2-meta">ZAR</span></>) },
];

function NextWork({ landscape }: { landscape: Landscape }) {
  const q = useTopWork(5);
  const { openItem, open } = useOpenItem();
  const status = useStatus().data;
  const rows = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  return (
    <section className="m2-sec" aria-label="Your next work">
      <div className="m2-sechead">
        <h2 className="m2-h2">Your next work</h2>
        {total > 0 ? <V2Link href="/v2/work">{`View all ${int(total)}`}</V2Link> : null}
      </div>
      <Grid<WorkRow>
        id="landscape-next-work"
        ariaLabel="Your next work"
        columns={NEXT_WORK_COLUMNS}
        rows={rows}
        rowId={(r) => recordKey(r)}
        compact
        hideBar
        height={32 + Math.max(rows.length, 1) * 28 + 2}
        loading={q.isPending}
        error={q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>The next rows to fix could not be read.</ErrorFrame> : undefined}
        emptyFrame={
          <EmptyFrame
            action={
              <V2Link href="/v2/runs" className="m2-btn">
                Open the runs
              </V2Link>
            }
          >
            {landscape.cells.length === 0 ? "Nothing is waiting because no run has scored an object yet. Run an analysis and the rows that fail land here, ranked by value at risk." : "No record is waiting to be fixed in the current state."}
          </EmptyFrame>
        }
        onOpen={(r) => openItem({ kind: "record", id: recordKey(r) })}
        openRowId={open?.kind === "record" ? open.id : null}
      />
      <p className="m2-prov">{`Rows ranked by value at risk${status?.cost_model ? `, cost model ${status.cost_model}` : ""}.`}</p>
    </section>
  );
}

function BasisTasks({ landscape }: { landscape: Landscape }) {
  const { hrefFor } = useOpenItem();
  const tasks = landscape.systems.map((s) => ({
    s,
    task: s.state === "not_extracted" ? `Extract ${s.name}` : s.state === "extracted" ? `Run analysis on ${s.name}` : `Extract ${s.name} again`,
    state: s.state === "not_extracted" ? "Never run" : s.state === "extracted" ? `Extracted ${formatDate(s.last_extracted_at, "datetime")}` : `Last extraction ${formatDate(s.last_extracted_at, "datetime")}`,
  }));
  return (
    <section className="m2-sec" aria-label="Your next work">
      <div className="m2-sechead">
        <h2 className="m2-h2">Your next work</h2>
      </div>
      <div className="m2-frame">
        <table className="m2-tbl">
          <thead>
            <tr>
              <th scope="col">Task</th>
              <th scope="col">State</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {tasks.map(({ s, task, state }) => (
              <tr key={s.id}>
                <td>{task}</td>
                <td className="m2-meta">{state}</td>
                <td className="m2-r">
                  <V2Link href={hrefFor({ kind: "system", id: s.id })}>Open</V2Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m2-prov">Tasks come from each system&apos;s state in the last run.</p>
    </section>
  );
}

function LandscapeSkeleton() {
  return (
    <div aria-busy="true" data-testid="landscape-loading">
      <PageTitle>Landscape</PageTitle>
      <p className="m2-finding">
        <Skeleton width={520} height={14} />
      </p>
      <div className="m2-cta">
        <Skeleton width={180} height={36} />
      </div>
      <section className="m2-sec">
        <div className="m2-sechead">
          <h2 className="m2-h2">Coverage</h2>
        </div>
        <div className="m2-frame">
          <div style={{ height: 320 }} />
        </div>
      </section>
    </div>
  );
}

/** The landscape canvas: the sentence, the next step, the coverage matrix and the next work. */
export function LandscapeCanvas() {
  const run = useRunParam();
  const q = useLandscape(run);
  const session = useV2Session();
  const params = useSearchParams();
  const L = q.data;
  const scopeName = useMemo(() => {
    const chosen = params.get("system");
    return L?.systems.find((s) => systemSlug(s.name) === chosen)?.name ?? "All systems";
  }, [L, params]);
  if (q.isError) {
    return (
      <>
        <PageTitle>Landscape</PageTitle>
        <div className="m2-sec">
          <ErrorFrame onRetry={() => void q.refetch()}>The landscape could not be read. Check that the API is reachable, then retry.</ErrorFrame>
        </div>
      </>
    );
  }
  if (!L) return <LandscapeSkeleton />;
  if (L.systems.length === 0) {
    return (
      <>
        <PageTitle>Landscape</PageTitle>
        <div className="m2-sec">
          <EmptyFrame
            action={
              <V2Link href="/systems" className="m2-btn m2-next">
                Connect a system
              </V2Link>
            }
          >
            No SAP system is connected yet. Connect one, extract it and run an analysis, and every object appears here with its score.
          </EmptyFrame>
        </div>
      </>
    );
  }
  const first = L.status_strip;
  return (
    <>
      {run ? (
        <div className="m2-banner" role="status">
          Viewing one run. Scores come from that run; rows and counts always show the latest.{" "}
          <V2Link href="/v2">Back to the latest run</V2Link>
        </div>
      ) : null}
      <PageTitle sub={scopeName}>Landscape</PageTitle>
      <p className="m2-finding" data-testid="landscape-sentence">
        <LandscapeSentence landscape={L} />
      </p>
      <p className="m2-prov">
        {`${int(first.records_checked)} records checked`}
        <Dot />
        {`${int(first.rules_measured)} rules measured`}
        <Dot />
        {first.run_at ? `run ${formatDate(first.run_at, "datetime")}` : "no run yet"}
      </p>
      <div className="m2-cta">
        <NextStep landscape={L} persona={session.persona} />
      </div>
      <Coverage landscape={L} run={run} />
      {session.persona === "basis" ? <BasisTasks landscape={L} /> : <NextWork landscape={L} />}
    </>
  );
}
