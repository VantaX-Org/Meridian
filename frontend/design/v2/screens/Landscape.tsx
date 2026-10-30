"use client";

import { Explain } from "../Explain";
import { Fragment, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { MigrationWave } from "@/types/api";
import { useWaves } from "@/lib/v2/admin-queries";
import { daysUntil, groupByWave, nextWave, type WaveGroup } from "@/lib/v2/waves";
import { formatDate } from "@/lib/format";
import type { Landscape, LandscapeCell, LandscapeSystem, WorkRow } from "@/lib/api/v2/types";
import { useOpenItem, useRunParam, useV2Session, type V2Persona } from "@/lib/v2/hooks";
import { useBatches, usePeople } from "@/lib/v2/approvals-queries";
import { slaMet } from "@/lib/v2/people";
import { useLandscape, useStatus, useTopWork } from "@/lib/v2/queries";
import { f1, int, moduleSlug, readingText, systemSlug, VERDICT_LABEL } from "@/lib/v2/score";
import { type GridColumn } from "../Grid";
import { VerdictMark } from "../marks";
import { Dash, Dot, EmptyFrame, ErrorFrame, Mono, PageTitle, Skeleton, V2Link } from "../parts";
import { Ruler } from "../Ruler";
import { ProcessNextStep } from "./object/ProcessNext";
import { dimsOf } from "../shell/MapPane";
import { GateMark } from "../inspector/governance";
import { ToolGrid } from "../GridTools";
import { t } from "@/lib/v2/i18n";

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
  if (s.objects === 0) return <>{t("No object has a run yet. Extract a system and run an analysis to score it.")}</>;
  const ids = s.release_if_fixed;
  return (
    <>
      {t("{held_under_85} of {objects} objects are held under 85 by {critical_over_tolerance} critical {critical_over_tolerance, plural, one {rule} other {rules}} over tolerance", { held_under_85: s.held_under_85, objects: s.objects, critical_over_tolerance: s.critical_over_tolerance })}
      {ids.length > 0 && s.released > 0 ? (
        <>
          {t("; fixing ")}
          {ids.map((id, i) => (
            <Fragment key={id}>
              {i > 0 ? (i === ids.length - 1 ? t(" and ") : t(", ")) : null}
              <V2Link href={hrefFor({ kind: "rule", id })} className="m2-mono">
                {id}
              </V2Link>
            </Fragment>
          ))}
          {t(" would release {released} of them", { released: s.released })}
        </>
      ) : null}
      {"."}
    </>
  );
}

/** The data owner's next step: the oldest batch waiting for their approval, opened in the batch inspector. */
function OwnerNext() {
  const { hrefFor } = useOpenItem();
  const session = useV2Session();
  const batches = useBatches();
  // The one with the most at risk first, as the ledger ranks; the longest waiting breaks a tie.
  const next = batches.rows
    .filter((b) => b.status === "draft" && b.ownerId !== session.id)
    .sort((a, b) => (b.valueAtRisk ?? -1) - (a.valueAtRisk ?? -1) || a.createdAt.localeCompare(b.createdAt))[0];
  if (batches.isLoading) return null;
  if (!next) {
    return (
      <V2Link href="/v2/people" className="m2-btn m2-next">
        {t("See who holds the work")}
      </V2Link>
    );
  }
  return (
    <V2Link href={hrefFor({ kind: "batch", id: next.id })} className="m2-btn m2-next">
      {t("Approve batch {label}", { label: next.label })}
    </V2Link>
  );
}

/** What waits for the owner and how their SLA stands, under the landscape sentence. */
function OwnerLine() {
  const people = usePeople().data?.people;
  const me = people?.find((p) => p.is_me);
  if (!me) return null;
  const met = slaMet(me);
  return (
    <p className="m2-prov" data-testid="owner-line">
      {t("{approvals_waiting} {approvals_waiting2, plural, one {batch waits} other {batches wait}} for your approval", { approvals_waiting: int(me.approvals_waiting), approvals_waiting2: me.approvals_waiting })}
      <Dot />
      {met == null ? t("no open work of yours") : t("SLA met on {met}% of your open work", { met })}
    </p>
  );
}

/** The next-step button, by persona. One per canvas. */
export function NextStep({ landscape, persona, waves }: { landscape: Landscape; persona: V2Persona; waves?: readonly MigrationWave[] }) {
  const { hrefFor } = useOpenItem();
  if (persona === "owner") return <OwnerNext />;
  if (persona === "steward") {
    return (
      <V2Link href="/v2/work" className="m2-btn m2-next">
        {t("Accept the suggested values")}
      </V2Link>
    );
  }
  if (persona === "process") return <ProcessNextStep landscape={landscape} />;
  if (persona === "basis") {
    const s = landscape.systems.find((x) => x.state === "not_extracted") ?? landscape.systems.find((x) => x.state === "extracted") ?? landscape.systems[0];
    if (!s) return null;
    const label = s.state === "extracted" ? t("Run analysis on {name}", { name: s.name }) : t("Extract {name}", { name: s.name });
    return (
      <V2Link href={hrefFor({ kind: "system", id: s.id })} className="m2-btn m2-next">
        {label}
      </V2Link>
    );
  }
  const wave = waves && waves.length ? nextWave(waves) : null;
  if (wave) {
    const [group] = groupByWave(landscape, [wave], landscape.cells);
    const noGo = group.counts["no-go"];
    const atRisk = group.counts["at-risk"];
    const due = daysUntil(wave.target_date);
    const when = wave.target_date ? t("due {target_date}{value}", { target_date: formatDate(wave.target_date), value: due != null ? (due < 0 ? t(", {value} {value, plural, one {day} other {days}} ago", { value: -due }) : due === 0 ? t(", today") : t(", in {due} {due, plural, one {day} other {days}}", { due })) : "" }) : t("no date set");
    const label = noGo > 0 ? t("Clear the {noGo} no-go {noGo, plural, one {object} other {objects}} in {name}", { noGo, name: wave.name }) : atRisk > 0 ? t("Review the {atRisk} at-risk {atRisk, plural, one {object} other {objects}} in {name}", { atRisk, name: wave.name }) : t("Open {name}", { name: wave.name });
    const href = noGo > 0 ? "/v2/work?verdict=no-go" : atRisk > 0 ? "/v2/work?verdict=at-risk" : hrefFor({ kind: "waves", id: "" });
    return (
      <>
        <V2Link href={href} className="m2-btn m2-next" data-testid="wave-next-step">
          {label}
        </V2Link>
        <span className="m2-meta" data-testid="wave-next-when">{t("{name}: {when}. {go} go, {atRisk} at risk, {noGo} no-go.", { name: wave.name, when, go: group.counts.go, atRisk, noGo })}</span>
      </>
    );
  }
  return (
    <V2Link href="/v2/work?verdict=no-go" className="m2-btn m2-next">
      {t("Open the no-go objects")}
    </V2Link>
  );
}

function SystemHead({ system }: { system: LandscapeSystem }) {
  const { hrefFor } = useOpenItem();
  const link = (label: string) => <V2Link href={hrefFor({ kind: "system", id: system.id })}>{label}</V2Link>;
  return (
    <>
      <div className="m2-hn">{system.name}</div>
      <div className="m2-hs">{[system.version, system.client ? t("client {client}", { client: system.client }) : null].filter(Boolean).join(", ") || " "}</div>
      <div className="m2-hs">
        {system.state === "not_extracted" ? (
          <>{t("Not extracted yet.")}{" "}{link(t("Extract"))}</>
        ) : (
          <>
            {t("Extracted {last_extracted_at}, {records} records", { last_extracted_at: formatDate(system.last_extracted_at, "datetime"), records: int(system.records) })}
            {system.state === "extracted" ? <> {link(t("Run analysis"))}</> : null}
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
      aria-label={`${label}, ${system.name}, ${f1(cell.score)}${cell.capped ? " capped" : ""}, ${VERDICT_LABEL[cell.verdict]}${cell.low_confidence ? t(", low coverage") : ""}`}
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
        {t("{records_checked} rec, {rules_measured} rules", { records_checked: int(cell.records_checked), rules_measured: int(cell.rules_measured) })}
        {cell.low_confidence ? <span className="m2-lcm">{t("low coverage")}</span> : null}
      </span>
    </V2Link>
  );
}

function otherCell(system: LandscapeSystem): ReactNode {
  if (system.state === "extracted") return <span className="m2-st">{t("Not analysed")}</span>;
  if (system.state === "not_extracted") return <span className="m2-st">{t("Not extracted")}</span>;
  return <Dash why={t("This object has no run on this system")} />;
}

/** The header of one wave: its name, date and stage, and how many of its objects are go, at risk and no-go. */
function WaveHeadText({ group }: { group: WaveGroup }) {
  const { hrefFor } = useOpenItem();
  const w = group.wave;
  const c = group.counts;
  return (
    <span className="m2-wsum">
      <b>{w ? w.name : t("Not in a wave")}</b>{" "}
      <span>{w ? (w.target_date ? t("due {target_date}", { target_date: formatDate(w.target_date) }) : t("no date set")) : t("{modulesCount} {modulesCount, plural, one {object} other {objects}}", { modulesCount: group.modules.length })}</span>{" "}
      <span>{t("{go} go, {c} at risk, {c2} no-go", { go: c.go, c: c["at-risk"], c2: c["no-go"] })}</span>
      {w ? (
        <>
          {" "}
          <GateMark waveId={w.id} />{" "}
          <V2Link href={hrefFor({ kind: "waves", id: "" })} aria-label={t("Edit {name}", { name: w.name })}>
            {t("Edit")}
          </V2Link>
        </>
      ) : null}
    </span>
  );
}

/** By system (the plain matrix) or by wave, kept in the address as `?view=waves`. */
function ViewToggle({ view }: { view: "systems" | "waves" }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const go = (next: "systems" | "waves") => {
    const q = new URLSearchParams(params.toString());
    if (next === "waves") q.set("view", "waves");
    else q.delete("view");
    const qs = q.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  return (
    <div role="group" aria-label={t("Group the matrix")} className="m2-segs" data-testid="view-toggle">
      <button type="button" className="m2-seg" aria-pressed={view === "systems"} onClick={() => go("systems")}>
        {t("All objects")}
      </button>
      <button type="button" className="m2-seg" aria-pressed={view === "waves"} onClick={() => go("waves")}>
        {t("Waves")}
      </button>
    </div>
  );
}

export function Coverage({ landscape, run, view = "systems", waves = [] }: { landscape: Landscape; run: string | null; view?: "systems" | "waves"; waves?: readonly MigrationWave[] }) {
  const params = useSearchParams();
  const selected = useSelectedCell();
  const chosen = params.get("system");
  const systems = landscape.systems.filter((s) => !chosen || systemSlug(s.name) === chosen);
  const cellOf = (system: LandscapeSystem, module: string) => landscape.cells.find((c) => c.system_id === system.id && c.module === module);
  const { go, at_risk, no_go } = landscape.counts;
  const visible = landscape.cells.filter((c) => systems.some((x) => x.id === c.system_id));
  const groups: WaveGroup[] | null = view === "waves" ? groupByWave(landscape, waves, visible) : null;
  const objectOf = (module: string) => landscape.objects.find((o) => o.module === module);
  return (
    <section className="m2-sec" aria-label={t("Coverage matrix")}>
      <div className="m2-sechead">
        <h2 className="m2-h2">{t("Coverage")}</h2>
        <span className="m2-sub">{t("{go} go, {at_risk} at risk, {no_go} no-go", { go, at_risk, no_go })}</span>
        <ViewToggle view={view} />
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
              <th scope="col">{t("Object")}</th>
              {systems.map((s) => (
                <th key={s.id} scope="col">
                  <SystemHead system={s} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups
              ? groups.flatMap((g) => [
                  <tr key={`wave-${g.wave?.id ?? "none"}`} className="m2-wavehead" data-testid="wave-head">
                    <th scope="colgroup" colSpan={1 + systems.length}>
                      <WaveHeadText group={g} />
                    </th>
                  </tr>,
                  ...(g.modules.length === 0
                    ? [
                        <tr key={`empty-${g.wave?.id ?? "none"}`}>
                          <td colSpan={1 + systems.length} className="m2-meta">
                            {t("No object is assigned to this wave yet.")}
                          </td>
                        </tr>,
                      ]
                    : g.modules.map((m) => objectOf(m)).filter((o): o is NonNullable<typeof o> => !!o).map((o) => (
              <tr key={o.module}>
                    <th scope="row">
                      <span className="m2-oname">{o.label}</span>
                      <Explain metric="dqs" label={t("the score of {label}", { label: o.label })} module={o.module} />
                    </th>
                    {systems.map((s) => {
                      const cell = cellOf(s, o.module);
                      return <td key={s.id}>{cell ? <CellLink system={s} cell={cell} label={o.label} selected={selected === `${s.id}:${o.module}`} run={run} /> : otherCell(s)}</td>;
                    })}
                  </tr>
                      ))),
                ])
              : landscape.objects.map((o) => (
              <tr key={o.module}>
                <th scope="row">
                  <span className="m2-oname">{o.label}</span>
                  <Explain metric="dqs" label={t("the score of {label}", { label: o.label })} module={o.module} />
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
        {groups ? (
          <p className="m2-prov" data-testid="wave-list-note">
            {groups.map((g) => t("{name}: {go} go, {counts} at risk, {counts2} no-go", { name: g.wave?.name ?? t("Not in a wave"), go: g.counts.go, counts: g.counts["at-risk"], counts2: g.counts["no-go"] })).join(". ")}.
          </p>
        ) : null}
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
                  {t("{records_checked} records checked, {rules_measured} rules measured", { records_checked: int(c.records_checked), rules_measured: int(c.rules_measured) })}
                  {c.low_confidence ? <span className="m2-lcm">{t("low coverage")}</span> : null}
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
  { id: "record", get header() { return t("Record"); }, width: 200, pin: true, locked: true, cell: (r) => <Mono>{r.record_key.split("=").slice(1).join("=") || r.record_key}</Mono> },
  { id: "name", get header() { return t("Name"); }, width: 200, cell: (r) => r.name ?? <Dash /> },
  { id: "problem", get header() { return t("Problem"); }, width: 260, cell: (r) => r.top_message ?? <Dash /> },
  { id: "value", get header() { return t("Current to suggested"); }, width: 200, cell: (r) => (r.suggested_value ? <Mono>{r.suggested_value}</Mono> : <Dash why={t("No suggested value")} />) },
  { id: "var", get header() { return t("Value at risk"); }, width: 130, numeric: true, cell: (r) => (r.value_at_risk == null ? <Dash /> : <>{int(r.value_at_risk)} <span className="m2-meta">ZAR</span></>) },
];

function NextWork({ landscape }: { landscape: Landscape }) {
  const q = useTopWork(5);
  const { openItem, open } = useOpenItem();
  const status = useStatus().data;
  const rows = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  return (
    <section className="m2-sec" aria-label={t("Your next work")}>
      <div className="m2-sechead">
        <h2 className="m2-h2">{t("Your next work")}</h2>
        {total > 0 ? <V2Link href="/v2/work">{t("View all {total}", { total: int(total) })}</V2Link> : null}
      </div>
      <ToolGrid<WorkRow>
          toolsTitle={t("Top of the ledger")}
        id="landscape-next-work"
        ariaLabel={t("Your next work")}
        columns={NEXT_WORK_COLUMNS}
        rows={rows}
        rowId={(r) => recordKey(r)}
        compact
        hideBar
        height={32 + Math.max(rows.length, 1) * 28 + 2}
        loading={q.isPending}
        error={q.isError ? <ErrorFrame onRetry={() => void q.refetch()}>{t("The next rows to fix could not be read.")}</ErrorFrame> : undefined}
        emptyFrame={
          <EmptyFrame
            action={
              <V2Link href="/v2/runs" className="m2-btn">
                {t("Open the runs")}
              </V2Link>
            }
          >
            {landscape.cells.length === 0 ? t("Nothing is waiting because no run has scored an object yet. Run an analysis and the rows that fail land here, ranked by value at risk.") : t("No record is waiting to be fixed in the current state.")}
          </EmptyFrame>
        }
        onOpen={(r) => openItem({ kind: "record", id: recordKey(r) })}
        openRowId={open?.kind === "record" ? open.id : null}
      />
      <p className="m2-prov">{t("Rows ranked by value at risk{value}.", { value: status?.cost_model ? t(", cost model {cost_model}", { cost_model: status.cost_model }) : "" })}</p>
    </section>
  );
}

function BasisTasks({ landscape }: { landscape: Landscape }) {
  const { hrefFor } = useOpenItem();
  const tasks = landscape.systems.map((s) => ({
    s,
    task: s.state === "not_extracted" ? t("Extract {name}", { name: s.name }) : s.state === "extracted" ? t("Run analysis on {name}", { name: s.name }) : t("Extract {name} again", { name: s.name }),
    when: s.state === "not_extracted" ? t("Never run") : s.state === "extracted" ? t("Extracted {last_extracted_at}", { last_extracted_at: formatDate(s.last_extracted_at, "datetime") }) : t("Last extraction {last_extracted_at}", { last_extracted_at: formatDate(s.last_extracted_at, "datetime") }),
  }));
  return (
    <section className="m2-sec" aria-label={t("Your next work")}>
      <div className="m2-sechead">
        <h2 className="m2-h2">{t("Your next work")}</h2>
      </div>
      <div className="m2-frame">
        <table className="m2-tbl">
          <thead>
            <tr>
              <th scope="col">{t("Task")}</th>
              <th scope="col">{t("State")}</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {tasks.map(({ s, task, when }) => (
              <tr key={s.id}>
                <td>{task}</td>
                <td className="m2-meta">{when}</td>
                <td className="m2-r">
                  <V2Link href={hrefFor({ kind: "system", id: s.id })}>{t("Open")}</V2Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="m2-prov">{t("Tasks come from each system's state in the last run.")}</p>
    </section>
  );
}

function LandscapeSkeleton() {
  return (
    <div aria-busy="true" data-testid="landscape-loading">
      <PageTitle>{t("Landscape")}</PageTitle>
      <p className="m2-finding">
        <Skeleton width={520} height={14} />
      </p>
      <div className="m2-cta">
        <Skeleton width={180} height={36} />
      </div>
      <section className="m2-sec">
        <div className="m2-sechead">
          <h2 className="m2-h2">{t("Coverage")}</h2>
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
  const waves = useWaves().data ?? [];
  const view = params.get("view") === "waves" ? "waves" : "systems";
  const L = q.data;
  const scopeName = useMemo(() => {
    const chosen = params.get("system");
    return L?.systems.find((s) => systemSlug(s.name) === chosen)?.name ?? t("All systems");
  }, [L, params]);
  if (q.isError) {
    return (
      <>
        <PageTitle>{t("Landscape")}</PageTitle>
        <div className="m2-sec">
          <ErrorFrame onRetry={() => void q.refetch()}>{t("The landscape could not be read. Check that the API is reachable, then retry.")}</ErrorFrame>
        </div>
      </>
    );
  }
  if (!L) return <LandscapeSkeleton />;
  if (L.systems.length === 0) {
    return (
      <>
        <PageTitle>{t("Landscape")}</PageTitle>
        <div className="m2-sec">
          <EmptyFrame
            action={
              <V2Link href="/systems" className="m2-btn m2-next">
                {t("Connect a system")}
              </V2Link>
            }
          >
            {t("No SAP system is connected yet. Connect one, extract it and run an analysis, and every object appears here with its score.")}
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
          {t("Viewing one run. Scores come from that run; rows and counts always show the latest.")}{" "}
          <V2Link href="/v2">{t("Back to the latest run")}</V2Link>
        </div>
      ) : null}
      <PageTitle sub={scopeName}>{t("Landscape")}</PageTitle>
      <p className="m2-finding" data-testid="landscape-sentence">
        <LandscapeSentence landscape={L} />
      </p>
      <p className="m2-prov">
        {t("{records_checked} records checked", { records_checked: int(first.records_checked) })}
        <Dot />
        {t("{rules_measured} rules measured", { rules_measured: int(first.rules_measured) })}
        <Dot />
        {first.run_at ? t("run {run_at}", { run_at: formatDate(first.run_at, "datetime") }) : t("no run yet")}
      </p>
      {session.persona === "owner" ? <OwnerLine /> : null}
      <div className="m2-cta">
        <NextStep landscape={L} persona={session.persona} waves={waves} />
      </div>
      <Coverage landscape={L} run={run} view={view} waves={waves} />
      {session.persona === "basis" ? <BasisTasks landscape={L} /> : <NextWork landscape={L} />}
    </>
  );
}
