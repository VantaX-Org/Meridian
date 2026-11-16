"use client";

import { Fragment, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQueries } from "@tanstack/react-query";
import type { MigrationWave } from "@/types/api";
import { useFixture } from "@/lib/api/v2/fixture";
import { usePermissions } from "@/lib/permissions";
import { requestTargetFor } from "@/lib/rbac";
import { getProcessDocument } from "@/lib/api/v2/mdm";
import { DIMENSIONS, type Landscape as LandscapeData, type LandscapeCell, type LandscapeSystem, type Verdict } from "@/lib/api/v2/types";
import { formatDate, formatModuleName } from "@/lib/format";
import { useWaves } from "@/lib/v2/admin-queries";
import { useBatches, usePeople } from "@/lib/v2/approvals-queries";
import { useStatusPage } from "@/lib/v2/enterprise-queries";
import { useOpenItem, useRunParam, useV2Session, type V2Persona } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { firstSentence, JOB_KIND_LABEL, jobObject, openFailures } from "@/lib/v2/jobs";
import { mdmKeys } from "@/lib/v2/mdm-queries";
import { slaMet } from "@/lib/v2/people";
import { firstBlockedStep, PROCESS_MODULES, stepRef } from "@/lib/v2/process-tree";
import { useLandscape, useStatus } from "@/lib/v2/queries";
import { runLabel } from "@/lib/v2/run-label";
import { useSystemsExtended, useTimeline, useV2Jobs } from "@/lib/v2/runs-queries";
import { byMeasured, DASH, f1, int, moduleSlug, readingText, systemSlug, VERDICT_LABEL } from "@/lib/v2/score";
import { overallVerdict, overallWord } from "@/lib/v2/status";
import { contractMark } from "@/lib/v2/step9";
import { policyMark } from "@/lib/v2/step10";
import { daysUntil, groupByWave, nextWave, type WaveGroup } from "@/lib/v2/waves";
import { useWorkGroups, useWorkSummary } from "@/lib/v2/work-queries";
import { useWaveGates } from "@/lib/v2/roles-queries";
import { useMoney } from "@/lib/v2/step9-queries";
import { useExplain } from "@/lib/v2/object-queries";
import { formatMoney } from "@/lib/format";
import { Chip, Code, LargeTitle, SegmentedControl, Skeleton, Sparkline, StatCard } from "../kit";
import { SegBar } from "../kit/viz/SegBar";
import { ExportTable } from "./ExportTable";
import { PartBar } from "../kit/viz";
import { KeepLink, QueryView } from "./states";
import "./landscape.css";

/**
 * The landscape: every connected system at its newest run, the one sentence that says what holds it back, the
 * persona's next step, what the numbers were made from (the old status strip), and the coverage matrix by system or
 * by wave. Native rebuild of design/v2/screens/Landscape.tsx.
 */

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

const VERDICT_TONE: Record<Verdict, "good" | "warn" | "bad"> = { go: "good", "at-risk": "warn", "no-go": "bad" };
const dimsOf = (cell: LandscapeCell) => DIMENSIONS.map((d) => cell.dimensions[d.key] ?? null);

/** "11 m 42 s" from seconds, as the old status strip wrote it. */
function duration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m} m ${s} s` : `${s} s`;
}

/** The one sentence the landscape opens with, from /landscape.sentence. Rule ids open the rule. */
function LandscapeSentence({ landscape }: { landscape: LandscapeData }) {
  const { hrefFor } = useOpenItem();
  const s = landscape.sentence;
  if (s.objects === 0) return <>{t("No object has a run yet. Extract a system and run an analysis to score it.")}</>;
  const ids = s.release_if_fixed;
  return (
    <>
      {t("{held_under_85} of {objects} objects cannot reach 85 yet, because {critical_over_tolerance} critical {critical_over_tolerance, plural, one {rule fails} other {rules fail}} on too many records", { held_under_85: s.held_under_85, objects: s.objects, critical_over_tolerance: s.critical_over_tolerance })}
      {ids.length > 0 && s.released > 0 ? (
        <>
          {t("; fixing ")}
          {ids.map((id, i) => (
            <Fragment key={id}>
              {i > 0 ? (i === ids.length - 1 ? t(" and ") : t(", ")) : null}
              <KeepLink href={hrefFor({ kind: "rule", id })} className="nx-link">
                <Code code={id} />
              </KeepLink>
            </Fragment>
          ))}
          {t(" would release {released} of them", { released: s.released })}
        </>
      ) : null}
      {"."}
    </>
  );
}

/** The data owner's next step: the batch with the most at risk waiting for their approval. */
function OwnerNext() {
  const { hrefFor } = useOpenItem();
  const session = useV2Session();
  const batches = useBatches();
  const next = batches.rows
    .filter((b) => b.status === "draft" && b.ownerId !== session.id)
    .sort((a, b) => (b.valueAtRisk ?? -1) - (a.valueAtRisk ?? -1) || a.createdAt.localeCompare(b.createdAt))[0];
  if (batches.isLoading) return null;
  if (!next) return <KeepLink href="/people" className="nx-btn nx-btn-primary">{t("See who holds the work")}</KeepLink>;
  return <KeepLink href={hrefFor({ kind: "batch", id: next.id })} className="nx-btn nx-btn-primary">{t("Approve batch {label}", { label: next.label })}</KeepLink>;
}

/** Basis: a system whose credentials SAP refused comes first, then the next one to extract or analyse. */
function BasisNext({ landscape }: { landscape: LandscapeData }) {
  const { hrefFor } = useOpenItem();
  const refused = (useSystemsExtended().data ?? []).find((x) => x.health_status === "auth_failed");
  if (refused) {
    return (
      <KeepLink href={hrefFor({ kind: "connection", id: refused.id })} className="nx-btn nx-btn-primary" data-testid="basis-fix-signin">
        {t("Fix the {name} sign-in", { name: refused.name })}
      </KeepLink>
    );
  }
  const s = landscape.systems.find((x) => x.state === "not_extracted") ?? landscape.systems.find((x) => x.state === "extracted") ?? landscape.systems[0];
  if (!s) return null;
  const label = s.state === "extracted" ? t("Run analysis on {name}", { name: s.name }) : t("Extract {name}", { name: s.name });
  return <KeepLink href={hrefFor({ kind: "system", id: s.id })} className="nx-btn nx-btn-primary">{label}</KeepLink>;
}

/** The process analyst's next step: the first blocked process step, else the first process object's readiness. */
function ProcessNext({ landscape }: { landscape: LandscapeData }) {
  const fixture = useFixture();
  const cells = landscape.cells.filter((c) => PROCESS_MODULES.has(c.module) && c.run_id).slice(0, 6);
  const reads = useQueries({
    queries: cells.map((c) => ({ queryKey: mdmKeys.process(fixture, c.run_id, c.module), queryFn: () => getProcessDocument(c.run_id, c.module), staleTime: 30_000, retry: false })),
  });
  const base = (c: LandscapeCell) => `/o/${systemSlug(landscape.systems.find((x) => x.id === c.system_id)?.name ?? c.system_id)}/${moduleSlug(c.module)}/processes`;
  for (let i = 0; i < cells.length; i++) {
    const step = firstBlockedStep(reads[i]?.data?.processes ?? []);
    if (step) {
      return (
        <KeepLink href={`${base(cells[i])}?open=step:${stepRef(cells[i].module, step.id)}`} className="nx-btn nx-btn-primary">
          {t("Open {l1Id} step {number}", { l1Id: step.l1Id, number: step.number })}
        </KeepLink>
      );
    }
  }
  if (cells.length === 0) return null;
  return <KeepLink href={base(cells[0])} className="nx-btn nx-btn-primary">{t("Open the process readiness")}</KeepLink>;
}

/** What waits for the owner and how their SLA stands. */
function OwnerLine() {
  const me = usePeople().data?.people?.find((p) => p.is_me);
  if (!me) return null;
  const met = slaMet(me);
  return (
    <p className="nx-sub" data-testid="owner-line">
      {t("{approvals_waiting} {approvals_waiting2, plural, one {batch waits} other {batches wait}} for your approval", { approvals_waiting: int(me.approvals_waiting), approvals_waiting2: me.approvals_waiting })}
      {", "}
      {met == null ? t("no open work of yours") : t("SLA met on {met}% of your open work", { met })}
    </p>
  );
}

/** The steward's next step: the rule with the most suggested values, opened on their rows. */
function StewardNext() {
  const top = (useWorkGroups({}).data?.groups ?? []).filter((g) => g.proposed > 0).sort((a, b) => b.proposed - a.proposed)[0];
  return (
    <KeepLink href={top ? `/work?rule=${encodeURIComponent(top.check_id)}` : "/work"} className="nx-btn nx-btn-primary" data-testid="steward-next">
      {top ? t("Accept {count} suggested {count2, plural, one {value} other {values}} for {check}", { count: int(top.proposed), count2: top.proposed, check: top.check_id }) : t("Accept the suggested values")}
    </KeepLink>
  );
}

/** The next-step button, by persona. One per page. */
function NextStep({ landscape, persona, waves }: { landscape: LandscapeData; persona: V2Persona; waves: readonly MigrationWave[] }) {
  const { hrefFor } = useOpenItem();
  if (persona === "owner") return <OwnerNext />;
  if (persona === "steward") return <StewardNext />;
  if (persona === "process") return <ProcessNext landscape={landscape} />;
  if (persona === "admin") return <KeepLink href="/admin" className="nx-btn nx-btn-primary">{t("Open Administration")}</KeepLink>;
  if (persona === "auditor") return <KeepLink href="/rules" className="nx-btn nx-btn-primary">{t("Open the rules library")}</KeepLink>;
  if (persona === "basis") return <BasisNext landscape={landscape} />;
  const wave = waves.length ? nextWave(waves) : null;
  if (wave) {
    const [group] = groupByWave(landscape, [wave], landscape.cells);
    const noGo = group.counts["no-go"];
    const atRisk = group.counts["at-risk"];
    const due = daysUntil(wave.target_date);
    const when = wave.target_date ? t("due {target_date}{value}", { target_date: formatDate(wave.target_date), value: due != null ? (due < 0 ? t(", {value} {value, plural, one {day} other {days}} ago", { value: -due }) : due === 0 ? t(", today") : t(", in {due} {due, plural, one {day} other {days}}", { due })) : "" }) : t("no date set");
    const label = noGo > 0 ? t("Clear the {noGo} no-go {noGo, plural, one {object} other {objects}} in {name}", { noGo, name: wave.name }) : atRisk > 0 ? t("Review the {atRisk} at-risk {atRisk, plural, one {object} other {objects}} in {name}", { atRisk, name: wave.name }) : t("Open {name}", { name: wave.name });
    const href = noGo > 0 ? "/work?verdict=no-go" : atRisk > 0 ? "/work?verdict=at-risk" : hrefFor({ kind: "waves", id: "" });
    return (
      <>
        <KeepLink href={href} className="nx-btn nx-btn-primary" data-testid="wave-next-step">{label}</KeepLink>
        <span className="nx-sub" data-testid="wave-next-when">{t("{name}: {when}. {go} go, {atRisk} at risk, {noGo} no-go.", { name: wave.name, when, go: group.counts.go, atRisk, noGo })}</span>
      </>
    );
  }
  return <KeepLink href="/work?verdict=no-go" className="nx-btn nx-btn-primary">{t("Open the no-go objects")}</KeepLink>;
}

/** What the numbers were made from: the old status strip, as figures and a list. */
function Provenance({ landscape, run }: { landscape: LandscapeData; run: string | null }) {
  const current = useStatus();
  const health = useStatusPage();
  const { jobs } = useV2Jobs();
  const { hrefFor } = useOpenItem();
  const s = run ? landscape.status_strip : current.data ?? landscape.status_strip;
  const systems = !run ? current.data?.systems : undefined;
  const failures = openFailures(jobs);
  const failed = failures[0];
  const why = failed ? firstSentence(failed.error) : null;
  const word = health.data ? overallWord(health.data.status) : null;
  const tone = health.data ? VERDICT_TONE[overallVerdict(health.data.status)] : "neutral";
  return (
    <section className="nx-ls-prov" aria-label={t("Status")} data-testid="landscape-status">
      <div className="nx-statgrid">
        <StatCard label={t("Records checked")} value={s.records_checked ?? 0} />
        <StatCard label={t("Rules measured")} value={s.rules_measured ?? 0} />
        <StatCard label={t("Objects")} value={landscape.sentence.objects} />
        <StatCard label={t("Systems")} value={landscape.systems.length} />
      </div>
      <dl className="nx-notes">
        <div className="nx-note">
          <dt>{t("Run")}</dt>
          <dd>{s.run_at ? t("Run {run_at}", { run_at: formatDate(s.run_at, "datetime") }) : t("No run yet")}</dd>
        </div>
        {s.scored_in_s != null ? (
          <div className="nx-note">
            <dt>{t("Duration")}</dt>
            <dd>{t("scored in {scored_in_s}", { scored_in_s: duration(s.scored_in_s) })}</dd>
          </div>
        ) : null}
        {s.cost_model ? (
          <div className="nx-note">
            <dt>{t("Cost model")}</dt>
            <dd>{s.cost_model_source === "default" ? t("cost model {cost_model}, default assumptions", { cost_model: s.cost_model }) : t("cost model {cost_model}", { cost_model: s.cost_model })}</dd>
          </div>
        ) : null}
        {s.licence_valid_to ? (
          <div className="nx-note">
            <dt>{t("Licence")}</dt>
            <dd>{t("licence valid to {licence_valid_to}", { licence_valid_to: formatDate(s.licence_valid_to, "date") })}</dd>
          </div>
        ) : null}
        {word ? (
          <div className="nx-note">
            <dt>{t("Health")}</dt>
            <dd>
              <KeepLink href="/status" className="nx-link" data-testid="status-health" aria-label={t("Platform {statusWord}, open the status page", { statusWord: word })}>
                <Chip tone={tone}>{word}</Chip>
              </KeepLink>
              {failures.length === 1 ? ` ${t("{statusWord}, 1 failed job", { statusWord: word })}` : failures.length > 1 ? ` ${t("{statusWord}, {count} failed jobs", { statusWord: word, count: int(failures.length) })}` : null}
            </dd>
          </div>
        ) : null}
      </dl>
      {current.isError && !run ? <p className="nx-sub">{t("The status line could not be read.")}</p> : null}
      {systems?.length ? (
        <ul className="nx-ls-systems" aria-label={t("Systems")}>
          {systems.map((x) => (
            <li key={x.system_id}>
              {[x.name, x.latest_run_id ? runLabel(null, x.run_number) : t("No run yet"), x.run_at ? formatDate(x.run_at, "datetime") : "", x.records_checked == null ? "" : t("{records_checked} records checked", { records_checked: int(x.records_checked) }), x.is_active ? "" : t("Inactive")].filter(Boolean).join(", ")}
            </li>
          ))}
        </ul>
      ) : null}
      {failed ? (
        <p className="nx-ls-fail" data-testid="status-failure">
          <Chip tone="bad">{t("Failed")}</Chip>{" "}
          {t("{JOB_KIND_LABEL} of {jobObject} failed{value}", { JOB_KIND_LABEL: JOB_KIND_LABEL[failed.kind], jobObject: jobObject(failed), value: why ? `: ${why}` : "" })}{" "}
          <KeepLink href={hrefFor({ kind: "job", id: failed.id })} className="nx-link">{t("Open")}</KeepLink>
        </p>
      ) : null}
    </section>
  );
}

function SystemHead({ system }: { system: LandscapeSystem }) {
  const { hrefFor } = useOpenItem();
  const link = (label: string) => <KeepLink href={hrefFor({ kind: "system", id: system.id })} className="nx-link">{label}</KeepLink>;
  return (
    <div className="nx-cell-stack">
      <strong>{system.name}{system.is_active === false ? ` (${t("Inactive")})` : ""}</strong>
      <span className="nx-sub">{[system.version, system.client ? t("client {client}", { client: system.client }) : null].filter(Boolean).join(", ") || " "}</span>
      <span className="nx-sub">
        {system.state === "not_extracted" ? (
          <>{t("Not extracted yet.")} {link(t("Extract"))}</>
        ) : (
          <>
            {t("Extracted {last_extracted_at}, {records} records", { last_extracted_at: formatDate(system.last_extracted_at, "datetime"), records: int(system.records) })}
            {system.state === "extracted" ? <> {link(t("Run analysis"))}</> : null}
          </>
        )}
      </span>
    </div>
  );
}

/** One score as a number over a 0 to 100 bar; the measured score shows as a tick when a critical rule caps it. */
function ScoreBar({ cell }: { cell: LandscapeCell }) {
  const width = Math.max(0, Math.min(100, cell.score ?? 0));
  return (
    <span className="nx-ls-score" data-verdict={cell.verdict}>
      <span className="nx-ls-num">{cell.score == null ? DASH : f1(cell.score)}</span>
      <span className="nx-ls-track" aria-hidden="true">
        <span className="nx-ls-fill" style={{ width: `${width}%` }} />
        {cell.capped && cell.raw_score != null ? <span className="nx-ls-raw" style={{ left: `${Math.max(0, Math.min(100, cell.raw_score))}%` }} /> : null}
      </span>
    </span>
  );
}

/** The measured score of one object over the last eight runs, from the run timeline. */
function ScoreTrend({ systemId, module, label }: { systemId: string; module: string; label: string }) {
  const runs = useTimeline(systemId, 8).data?.runs ?? [];
  const known = runs.map((r) => r.objects[module]?.raw_score ?? r.objects[module]?.score ?? null).filter((v): v is number => v != null);
  if (known.length < 2) return null;
  return <Sparkline points={known} label={t("{label}, measured score over the last {count} runs: {first} to {last}", { label, count: runs.length, first: f1(known[0]), last: f1(known[known.length - 1]) })} />;
}

/** Asks an administrator for a permission; the shell draws the request dialog. */
function RequestAccess({ permission }: { permission: string }) {
  const { requestAccess } = usePermissions();
  return (
    <button type="button" className="nx-btn nx-btn-secondary nx-btn-sm" data-testid="request-access" onClick={() => requestAccess(requestTargetFor({ resource: null, action: permission }))}>
      {t("Request access")}
    </button>
  );
}

function CellLink({ system, cell, label, selected, run }: { system: LandscapeSystem; cell: LandscapeCell; label: string; selected: boolean; run: string | null }) {
  const reading = readingText({ label, measured: cell.raw_score, score: cell.score, capped: cell.capped, capLevel: cell.cap_level, breaches: cell.breaches, dims: dimsOf(cell), records: cell.records_checked, rules: cell.rules_measured, coverage: cell.coverage, lowConfidence: cell.low_confidence });
  const mark = contractMark(cell);
  const pmark = policyMark(cell);
  return (
    <KeepLink
      href={`/o/${systemSlug(system.name)}/${moduleSlug(cell.module)}${run ? `?run=${run}` : ""}`}
      className="nx-ls-cell"
      data-selected={selected ? "true" : undefined}
      data-testid="matrix-cell"
      title={reading}
      aria-label={`${label}, ${system.name}, ${f1(cell.score)}${cell.capped ? t(", held down by a failing critical rule") : ""}, ${VERDICT_LABEL[cell.verdict]}${cell.low_confidence ? t(", low coverage") : ""}${mark ? `, ${mark.title}` : ""}${pmark ? `, ${pmark.title}` : ""}`}
      onClick={() => rememberCell(`${system.id}:${cell.module}`)}
    >
      <ScoreBar cell={cell} />
      <ScoreTrend systemId={system.id} module={cell.module} label={label} />
      <span className="nx-row">
        <Chip tone={VERDICT_TONE[cell.verdict]}>{VERDICT_LABEL[cell.verdict]}</Chip>
        {cell.low_confidence ? <Chip tone="warn">{t("low coverage")}</Chip> : null}
        {mark ? <Chip tone={mark.enforced ? "accent" : "neutral"} count={mark.count}>{mark.title}</Chip> : null}
        {pmark ? <Chip tone="neutral" count={pmark.count}>{pmark.title}</Chip> : null}
      </span>
      <span className="nx-sub">{t("{records_checked} records, {rules_measured} rules", { records_checked: int(cell.records_checked), rules_measured: int(cell.rules_measured) })}</span>
    </KeepLink>
  );
}

function otherCell(system: LandscapeSystem): ReactNode {
  if (system.state === "extracted") return <span className="nx-sub">{t("Not analysed")}</span>;
  if (system.state === "not_extracted") return <span className="nx-sub">{t("Not extracted")}</span>;
  return <span className="nx-sub" title={t("This object has no run on this system")}>{DASH}</span>;
}

/** The header of one wave: name, date, verdict counts, and the ways to edit it and read its certificate. */
function WaveHeadText({ group }: { group: WaveGroup }) {
  const { hrefFor } = useOpenItem();
  const w = group.wave;
  const c = group.counts;
  return (
    <span className="nx-row nx-wrap">
      <strong>{w ? w.name : t("Not in a wave")}</strong>
      <span className="nx-sub">{w ? (w.target_date ? t("due {target_date}", { target_date: formatDate(w.target_date) }) : t("no date set")) : t("{modulesCount} {modulesCount, plural, one {object} other {objects}}", { modulesCount: group.modules.length })}</span>
      <span className="nx-sub">{t("{go} go, {c} at risk, {c2} no-go", { go: c.go, c: c["at-risk"], c2: c["no-go"] })}</span>
      {w ? (
        <>
          <GateMark waveId={w.id} />
          <KeepLink href={hrefFor({ kind: "waves", id: w.id })} className="nx-link" aria-label={t("Edit {name}", { name: w.name })}>{t("Edit")}</KeepLink>
          <KeepLink href={hrefFor({ kind: "certificate", id: w.id })} className="nx-link" aria-label={t("Readiness certificate of {name}", { name: w.name })} data-testid="wave-certificate-link">{t("Certificate")}</KeepLink>
        </>
      ) : null}
    </span>
  );
}

/** Whether the wave passes its go-live gate, from GET /waves/gates. Nothing when the wave has no gate configured. */
function GateMark({ waveId }: { waveId: string }) {
  const g = useWaveGates().data?.gates.find((x) => x.wave_id === waveId);
  if (!g || !g.gate.configured) return null;
  const checks = g.status.checks;
  const failed = checks.filter((c) => !c.passed).length;
  return (
    <span data-testid="gate-mark" title={checks.map((c) => (c.passed ? t("{label}: met", { label: c.label }) : `${c.label}: ${c.detail}`)).join(". ")}>
      <Chip tone={g.status.passed ? "good" : "bad"}>{g.status.passed ? t("Gate passed") : t("Gate not passed, {filterCount} of {checksCount} not met", { filterCount: failed, checksCount: checks.length })}</Chip>
    </span>
  );
}

/** The "i" beside an object: a native disclosure that reads GET /explain/dqs for the module only once it is opened. */
function Explain({ module, label }: { module: string; label: string }) {
  const [open, setOpen] = useState(false);
  const q = useExplain("dqs", { module }, open);
  return (
    <details className="nx-ls-explain" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="nx-ls-explain-btn" aria-label={t("About {label}", { label })}><span aria-hidden="true">i</span></summary>
      {open ? (
        <div className="nx-ls-explain-pop" role="group" aria-label={q.data?.title ?? label} data-testid="explain">
          {q.isPending ? (
            <Skeleton lines={2} />
          ) : q.isError ? (
            <p role="alert">{t("The explanation could not be read for this run.")}</p>
          ) : (
            <>
              <strong>{q.data.title}</strong>
              <p>{q.data.text}</p>
              {q.data.computation.length > 0 ? (
                <dl className="nx-ls-explain-calc">
                  {q.data.computation.map((row, i) => (
                    <div key={`${row.label}-${i}`}>
                      <dt>{row.label}</dt>
                      <dd className="nx-num">{row.value == null ? DASH : `${typeof row.value === "number" ? f1(row.value) : row.value}${row.unit ? ` ${row.unit}` : ""}`}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </details>
  );
}

/** Waves ranked by what fixing them unblocks, from GET /impact/money: a bar of each wave's share, then the ranked list. */
function WavesByValue() {
  const q = useMoney("landscape", null);
  const { hrefFor } = useOpenItem();
  const d = q.data;
  const valueOf = (w: { value_unblocked_per_month: number | null; features: string[] }) => (d?.cost_model ? (w.value_unblocked_per_month ?? 0) : w.features.length);
  const fmt = (n: number) => (d?.cost_model ? formatMoney(n, d.currency) : int(n));
  return (
    <section className="nx-ls-sec" aria-label={t("Waves by value")} data-testid="waves-by-value">
      <header className="nx-ls-head">
        <h3>{t("Waves by value")}</h3>
        {d ? <span className="nx-sub">{d.cost_model ? t("Opportunity cost a wave would unblock a month, in {currency}", { currency: d.currency ?? t("the tenant currency") }) : t("No cost model: ranked by features unblocked")}</span> : null}
      </header>
      {q.isPending ? (
        <Skeleton lines={1} />
      ) : q.isError ? (
        <p role="alert">{t("The value of the waves could not be read.")} <button type="button" className="nx-btn" onClick={() => void q.refetch()}>{t("Retry")}</button></p>
      ) : q.data.ranking.waves.length === 0 ? (
        <p className="nx-sub">
          {t("No wave exists yet. Add one and assign objects to it, and each wave is ranked here by what fixing it unblocks.")}{" "}
          <KeepLink href={hrefFor({ kind: "waves", id: "" })} className="nx-link">{t("Plan the waves")}</KeepLink>
        </p>
      ) : (
        <>
          <PartBar label={t("Waves by value")} format={fmt} segments={q.data.ranking.waves.map((w) => ({ label: w.name, value: valueOf(w) }))} />
          <ol className="nx-ls-rank">
            {q.data.ranking.waves.map((w) => (
              <li key={w.id} className="nx-row nx-wrap">
                <strong>{w.name}</strong>
                <span className="nx-sub">{w.features.length ? t("unblocks {features}", { features: w.features.join(", ") }) : t("unblocks no blocked feature")}</span>
                {q.data.cost_model && w.value_unblocked_per_month != null ? <span className="nx-num">{formatMoney(w.value_unblocked_per_month, q.data.currency)} {t("a month")}</span> : null}
                <KeepLink href={hrefFor({ kind: "certificate", id: w.id })} className="nx-link" aria-label={t("Readiness certificate of {name}", { name: w.name })}>{t("Certificate")}</KeepLink>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
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
    <div data-testid="view-toggle">
      <SegmentedControl label={t("Group the matrix")} value={view} onChange={go} items={[{ value: "systems", label: t("All objects") }, { value: "waves", label: t("Waves") }]} />
    </div>
  );
}

function Coverage({ landscape, run, view, waves }: { landscape: LandscapeData; run: string | null; view: "systems" | "waves"; waves: readonly MigrationWave[] }) {
  const params = useSearchParams();
  const selected = useSelectedCell();
  const chosen = params.get("system");
  const systems = landscape.systems.filter((s) => !chosen || systemSlug(s.name) === chosen);
  const cellOf = (system: LandscapeSystem, module: string) => landscape.cells.find((c) => c.system_id === system.id && c.module === module);
  const { go, at_risk, no_go } = landscape.counts;
  const visible = landscape.cells.filter((c) => systems.some((x) => x.id === c.system_id));
  const groups: WaveGroup[] | null = view === "waves" ? groupByWave(landscape, waves, visible) : null;
  const objectOf = (module: string) => landscape.objects.find((o) => o.module === module);
  // Rows rank by the lowest measured score of the object on the systems shown, so objects the cap ties still rank.
  const rank = new Map(byMeasured(visible).map((c, i) => [c.module, i] as const));
  const ranked = [...landscape.objects].sort((a, b) => (rank.get(a.module) ?? 1e9) - (rank.get(b.module) ?? 1e9));
  const phoneCells = byMeasured(landscape.cells).filter((c) => !chosen || systemSlug(landscape.systems.find((s) => s.id === c.system_id)?.name ?? "") === chosen);
  const objectRow = (o: { module: string; label: string }) => (
    <tr key={o.module}>
      <th scope="row">
        <span className="nx-cell-stack">
          <span className="nx-row">{o.label}<Explain module={o.module} label={t("the score of {label}", { label: o.label })} /></span>
          <Code code={o.module} />
        </span>
      </th>
      {systems.map((s) => {
        const cell = cellOf(s, o.module);
        return <td key={s.id}>{cell ? <CellLink system={s} cell={cell} label={o.label} selected={selected === `${s.id}:${o.module}`} run={run} /> : otherCell(s)}</td>;
      })}
    </tr>
  );
  const phoneRow = (c: LandscapeCell) => {
    const s = landscape.systems.find((x) => x.id === c.system_id);
    const label = objectOf(c.module)?.label ?? c.module;
    if (!s) return null;
    return (
      <KeepLink key={`${c.system_id}:${c.module}`} href={`/o/${systemSlug(s.name)}/${moduleSlug(c.module)}${run ? `?run=${run}` : ""}`} className="nx-ls-lrow" onClick={() => rememberCell(`${s.id}:${c.module}`)}>
        <span className="nx-row-main">{label}</span>
        <Chip tone={VERDICT_TONE[c.verdict]}>{VERDICT_LABEL[c.verdict]}</Chip>
        <ScoreBar cell={c} />
        <span className="nx-sub">
          {t("{records_checked} records checked against {rules_measured} rules", { records_checked: int(c.records_checked), rules_measured: int(c.rules_measured) })}
          {c.low_confidence ? ` ${t("low coverage")}` : ""}
          {landscape.systems.length > 1 ? `, ${s.name}` : ""}
        </span>
      </KeepLink>
    );
  };
  return (
    <section className="nx-ls-sec" aria-label={t("Coverage matrix")}>
      <header className="nx-ls-head">
        <h2>{t("Coverage")}</h2>
        <span className="nx-sub">{t("{go} go, {at_risk} at risk, {no_go} no-go", { go, at_risk, no_go })}</span>
        <ViewToggle view={view} />
      </header>
      <SegBar
        testid="landscape-verdicts"
        segs={[
          { key: "go", label: VERDICT_LABEL.go, value: go, tone: "good" },
          { key: "at-risk", label: VERDICT_LABEL["at-risk"], value: at_risk, tone: "warn" },
          { key: "no-go", label: VERDICT_LABEL["no-go"], value: no_go, tone: "bad" },
        ]}
      />
      <div className="nx-ls-wide">
        <ExportTable>
        <table className="nx-ls-matrix" data-testid="coverage-matrix">
          <thead>
            <tr>
              <th scope="col">{t("Object")}</th>
              {systems.map((s) => (
                <th key={s.id} scope="col"><SystemHead system={s} /></th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups
              ? groups.flatMap((g) => [
                  <tr key={`wave-${g.wave?.id ?? "none"}`} className="nx-ls-wavehead" data-testid="wave-head">
                    <th scope="colgroup" colSpan={1 + systems.length}><WaveHeadText group={g} /></th>
                  </tr>,
                  ...(g.modules.length === 0
                    ? [
                        <tr key={`empty-${g.wave?.id ?? "none"}`}>
                          <td colSpan={1 + systems.length} className="nx-sub">{t("No object is assigned to this wave yet.")}</td>
                        </tr>,
                      ]
                    : g.modules.map(objectOf).filter((o): o is NonNullable<typeof o> => !!o).map(objectRow)),
                ])
              : ranked.map(objectRow)}
          </tbody>
        </table>
        </ExportTable>
      </div>
      <div className="nx-ls-list">
        {groups
          ? groups.map((g) => (
              <Fragment key={g.wave?.id ?? "none"}>
                <p data-testid="wave-head-list"><WaveHeadText group={g} /></p>
                {phoneCells.filter((c) => g.modules.includes(c.module)).map(phoneRow)}
              </Fragment>
            ))
          : phoneCells.map(phoneRow)}
      </div>
      {groups ? <WavesByValue /> : null}
    </section>
  );
}

function BasisTasks({ landscape }: { landscape: LandscapeData }) {
  const { hrefFor } = useOpenItem();
  const tasks = landscape.systems.filter((s) => s.is_active !== false).map((s) => ({
    s,
    task: s.state === "not_extracted" ? t("Extract {name}", { name: s.name }) : s.state === "extracted" ? t("Run analysis on {name}", { name: s.name }) : t("Extract {name} again", { name: s.name }),
    when: s.state === "not_extracted" ? t("Never run") : s.state === "extracted" ? t("Extracted {last_extracted_at}", { last_extracted_at: formatDate(s.last_extracted_at, "datetime") }) : t("Last extraction {last_extracted_at}", { last_extracted_at: formatDate(s.last_extracted_at, "datetime") }),
  }));
  return (
    <section className="nx-ls-sec" aria-label={t("Your next work")} data-testid="basis-tasks">
      <header className="nx-ls-head"><h2>{t("Your next work")}</h2></header>
      <ExportTable>
      <table className="nx-ls-matrix">
        <thead>
          <tr>
            <th scope="col">{t("Task")}</th>
            <th scope="col">{t("State")}</th>
            <th scope="col"><span className="nx-sr">{t("Open")}</span></th>
          </tr>
        </thead>
        <tbody>
          {tasks.map(({ s, task, when }) => (
            <tr key={s.id}>
              <td>{task}</td>
              <td className="nx-sub">{when}</td>
              <td><KeepLink href={hrefFor({ kind: "system", id: s.id })} className="nx-btn nx-btn-secondary nx-btn-sm">{t("Open")}</KeepLink></td>
            </tr>
          ))}
        </tbody>
      </table>
      </ExportTable>
      <p className="nx-sub">{t("Tasks come from each system's state in the last run.")}</p>
    </section>
  );
}

/**
 * The first run of an empty tenant: connect a system or upload a file, run an analysis, read the landscape. The
 * current step carries the action when the viewer may take it, and names the permission when not.
 */
function FirstSteps({ connected, analysed, systemId }: { connected: boolean; analysed: boolean; systemId?: string }) {
  const session = useV2Session();
  const { hrefFor } = useOpenItem();
  const canConnect = session.can("manage_systems");
  const canUpload = session.can("upload");
  const canRun = session.can("analyse");
  const canInvite = session.can("manage_users");
  const current = !connected ? 1 : !analysed ? 2 : 3;
  const step = (n: number, title: string, body: string, action: ReactNode) => (
    <li className="nx-ls-step" data-state={n < current ? "done" : n === current ? "current" : "next"} aria-current={n === current ? "step" : undefined}>
      <span className="nx-ls-stepn" aria-hidden="true">{n}</span>
      <div className="nx-cell-stack">
        <h3>
          {title}
          {n < current ? <> <Chip tone="good">{t("Done")}</Chip></> : null}
        </h3>
        <p className="nx-sub">{body}</p>
        {n === current && action ? <div className="nx-row nx-wrap">{action}</div> : null}
      </div>
    </li>
  );
  return (
    <section className="nx-ls-sec" aria-labelledby="nx-ls-start" data-testid="first-steps">
      <header className="nx-ls-head">
        <h2 id="nx-ls-start">{t("Three steps to your first scores")}</h2>
        <span className="nx-sub">{t("Step {current} of 3", { current })}</span>
      </header>
      <ol className="nx-ls-steps">
        {step(
          1,
          t("Connect a system or upload a file"),
          t("Connect an SAP system (ECC, S/4HANA, SuccessFactors, Ariba, Concur or BTP) and extract it, or upload one object as CSV, Excel or Parquet. Nothing leaves your environment."),
          canConnect || canUpload ? (
            <>
              {canConnect ? <KeepLink href="/s/new" className="nx-btn nx-btn-primary">{t("Connect a system")}</KeepLink> : null}
              {canUpload ? <KeepLink href="/admin/runs" className="nx-btn nx-btn-secondary nx-btn-sm">{t("Upload a file")}</KeepLink> : null}
              {canInvite ? <KeepLink href={hrefFor({ kind: "user", id: "new:sap_basis" })} className="nx-btn nx-btn-secondary nx-btn-sm" data-testid="invite-basis">{t("Invite SAP Basis")}</KeepLink> : null}
            </>
          ) : (
            <>
              <span className="nx-sub" data-testid="connect-denied">{t("Connecting a system needs the manage systems permission. Ask an administrator to grant it.")}</span>
              <RequestAccess permission="manage_systems" />
            </>
          ),
        )}
        {step(
          2,
          t("Run an analysis"),
          t("Every rule of every object is checked against the extracted records. Before it starts you see how long it should take; the job line under the top bar shows its progress."),
          canRun ? (
            <KeepLink href={systemId ? hrefFor({ kind: "system", id: systemId }) : "/runs"} className="nx-btn nx-btn-primary">{t("Run analysis")}</KeepLink>
          ) : (
            <>
              <span className="nx-sub">{t("Running an analysis needs the analyse permission. Ask an administrator to grant it.")}</span>
              <RequestAccess permission="analyse" />
            </>
          ),
        )}
        {step(3, t("Read the landscape"), t("Each object gets a score on the ruler, a verdict and the records to fix. This page then opens with the one sentence that says what holds the landscape back, and your next step."), null)}
      </ol>
    </section>
  );
}

/** No system is connected. Objects from uploaded files may already have records to fix; then they are listed. */
function NoSystemYet() {
  const summary = useWorkSummary().data;
  const session = useV2Session();
  const uploaded = (summary?.objects ?? []).filter((o) => (o.records ?? 0) > 0 || (o.open ?? 0) > 0);
  if (uploaded.length === 0) {
    return (
      <>
        <p className="nx-ls-sentence" data-testid="landscape-sentence">
          {t("No SAP system is connected yet. Connect one, extract it and run an analysis, and every object appears here with its score.")}
        </p>
        <FirstSteps connected={false} analysed={false} />
      </>
    );
  }
  const open = uploaded.reduce((n, o) => n + (o.open ?? 0), 0);
  return (
    <>
      <p className="nx-ls-sentence" data-testid="landscape-sentence">
        {t("No SAP system is connected yet, but {count} {count, plural, one {object} other {objects}} came from uploaded files: {open} records to fix are on Work and their runs on Runs.", { count: uploaded.length, open: int(open) })}
      </p>
      <section className="nx-ls-sec" aria-label={t("Objects from uploaded files")} data-testid="uploaded-objects">
        <header className="nx-ls-head">
          <h2>{t("Objects from uploaded files")}</h2>
          <span className="nx-sub">{t("Not attached to a system")}</span>
        </header>
        <div className="nx-ls-list nx-ls-list-all">
          {uploaded.map((o) => (
            <KeepLink key={o.module} href={`/work?module=${encodeURIComponent(o.module)}`} className="nx-ls-lrow">
              <span className="nx-row-main">{formatModuleName(o.module)} <Code code={o.module} /></span>
              <span className="nx-sub">{t("{open} to fix, {records} records with an issue", { open: int(o.open), records: int(o.records) })}</span>
            </KeepLink>
          ))}
        </div>
        <div className="nx-row nx-wrap">
          <KeepLink href="/work" className="nx-btn nx-btn-primary">{t("Open Work")}</KeepLink>
          <KeepLink href="/runs" className="nx-btn nx-btn-secondary nx-btn-sm">{t("Open the runs")}</KeepLink>
          {session.can("manage_systems") ? <KeepLink href="/s/new" className="nx-btn nx-btn-secondary nx-btn-sm">{t("Connect a system to attach them")}</KeepLink> : null}
        </div>
      </section>
    </>
  );
}

export function Landscape() {
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
  return (
    <div className="nx-body nx-ls" data-testid="landscape">
      {run ? (
        <p className="nx-ls-banner" role="status">
          {t("Viewing one run. Scores come from that run; rows and counts always show the latest.")}{" "}
          <KeepLink href="/" className="nx-link">{t("Back to the latest run")}</KeepLink>
        </p>
      ) : null}
      <LargeTitle title={t("Landscape")} subtitle={L && L.systems.length ? scopeName : undefined} />
      <QueryView
        loading={q.isPending}
        error={q.isError}
        onRetry={() => void q.refetch()}
        empty={false}
        emptyHeading={t("Landscape")}
        label={t("The landscape could not be read. Check that the API is reachable, then retry.")}
      >
        {!L ? (
          <div aria-busy="true" data-testid="landscape-loading"><Skeleton lines={8} label={t("Landscape")} /></div>
        ) : L.systems.length === 0 ? (
          <NoSystemYet />
        ) : (
          <>
            <p className="nx-ls-lede">
              {L.sentence.objects === 0
                ? t("No object has a run yet. Extract a system and run an analysis to score it, then this page shows each system at its newest run.")
                : t("This page shows every connected system at its newest run: {systems} systems and {objects} objects. {held_under_85} cannot reach 85 yet. Start with the fix queue, or open any object to see its run.", { systems: L.systems.length, objects: L.sentence.objects, held_under_85: L.sentence.held_under_85 })}
            </p>
            {session.persona === "owner" ? <OwnerLine /> : null}
            <div className="nx-row nx-wrap" data-testid="home-next">
              <NextStep landscape={L} persona={session.persona} waves={waves} />
            </div>
            <p className="nx-ls-sentence" data-testid="landscape-sentence"><LandscapeSentence landscape={L} /></p>
            <p className="nx-sub">
              {[
                t("{records_checked} records checked", { records_checked: int(L.status_strip.records_checked) }),
                t("{rules_measured} rules measured", { rules_measured: int(L.status_strip.rules_measured) }),
                L.status_strip.run_at ? t("run {run_at}", { run_at: formatDate(L.status_strip.run_at, "datetime") }) : t("no run yet"),
              ].join(", ")}
            </p>
            <Provenance landscape={L} run={run} />
            {L.cells.length === 0 ? <FirstSteps connected analysed={false} systemId={L.systems[0]?.id} /> : null}
            {session.persona === "basis" ? <BasisTasks landscape={L} /> : null}
            <Coverage landscape={L} run={run} view={view} waves={waves} />
          </>
        )}
      </QueryView>
    </div>
  );
}
