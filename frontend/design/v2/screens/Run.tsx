"use client";

import { Fragment, useMemo, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { getObjectRules } from "@/lib/api/v2/landscape";
import { formatDate } from "@/lib/format";
import type { LandscapeCell, RuleRow } from "@/lib/api/v2/types";
import { archiveRuns, downloadRunReport, pinBaseline, restoreRuns, type TimelineRun } from "@/lib/api/v2/runs";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { JOB_KIND_LABEL, JOB_STATUS_LABEL, jobObject, jobSeconds } from "@/lib/v2/jobs";
import { useLandscape, v2Keys } from "@/lib/v2/queries";
import { useTimeline, useV2Jobs, useVersionHead, useVersionsPage } from "@/lib/v2/runs-queries";
import { f1, int, moduleSlug, systemSlug, VERDICT_LABEL } from "@/lib/v2/score";
import { VerdictMark } from "../marks";
import { ChartFrame, ChartTable, DIST_H, Distribution, STACK_H, StackedBar, scoreDomain, severityParts } from "../charts";
import { Dash, Dot, EmptyFrame, ErrorFrame, PageTitle, Skeleton, V2Link } from "../parts";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { kindWord, triggerOf } from "../RunTimeline";
import { duration } from "../shell/StatusStrip";
import { t as tr, lc } from "@/lib/v2/i18n";
import { baselineRefusalOf, type BaselineRefusal } from "@/lib/api/v2/step9";
import { breachWords } from "@/lib/v2/step9";
import { moduleText } from "@/lib/v2/labels";
import "../basis.css";

/**
 * The shape of a run in two figures: how its objects spread over the measured score, against the verdict bands, and
 * its findings by severity. Both from the chart grammar, each with its figures as a table.
 */
function RunShape({ cells, labelOf, severity, loading }: { cells: LandscapeCell[]; labelOf: (m: string) => string; severity: Record<string, number> | null; loading: boolean }) {
  const items = useMemo(() => cells.filter((c) => c.raw_score != null).map((c) => ({ id: c.module, label: labelOf(c.module), value: c.raw_score ?? 0 })), [cells, labelOf]);
  const domain = useMemo(() => {
    const [lo] = scoreDomain(items.map((i) => i.value), [], 40);
    return [Math.min(lo, 60), 100] as const;
  }, [items]);
  const refs = useMemo(() => [{ value: 75, label: tr("75 at risk") }, { value: 90, label: tr("90 go") }], []);
  const parts = useMemo(() => (severity ? severityParts(severity) : []), [severity]);
  const findings = parts.reduce((n, p) => n + p.value, 0);
  if (!loading && cells.length === 0) return null;
  const state = loading ? "loading" : "ready";
  const sorted = [...items].sort((a, b) => a.value - b.value);
  return (
    <section className="m2-sec m2-runshape" aria-label={tr("Shape of the run")} data-testid="run-shape">
      <ChartFrame
        title={tr("Objects by measured score")}
        sub={tr("Before any cap, in bins of 5")}
        state={state}
        height={DIST_H}
        testId="run-distribution"
        table={
          <ChartTable
            caption={tr("Objects by measured score")}
            head={[tr("Object"), tr("Measured")]}
            rows={sorted.map((i) => [i.label, f1(i.value)])}
          />
        }
      >
        <Distribution
          items={items}
          domain={domain}
          binWidth={5}
          refs={refs}
          label={tr("{count} {count, plural, one {object} other {objects}} by measured score, from {low} to {high}", { count: items.length, low: f1(sorted[0]?.value ?? null), high: f1(sorted[sorted.length - 1]?.value ?? null) })}
          describe={(b, names) => tr("{from} to {to}: {count} {count, plural, one {object} other {objects}}{names}", { from: b.from, to: b.to, count: names.length, names: names.length ? `, ${names.join(", ")}` : "" })}
        />
      </ChartFrame>
      <ChartFrame
        title={tr("Findings by severity")}
        sub={findings > 0 ? tr("{n} {count, plural, one {finding} other {findings}} in this run", { n: int(findings), count: findings }) : undefined}
        state={state === "loading" ? "loading" : severity ? "ready" : "empty"}
        empty={tr("This run did not count its findings by severity.")}
        height={STACK_H + 24}
        testId="run-severity"
        table={<ChartTable caption={tr("Findings by severity")} head={[tr("Severity"), tr("Findings")]} rows={parts.map((p) => [p.label, int(p.value)])} />}
      >
        <StackedBar parts={parts} format={int} label={parts.map((p) => p.title).join(". ")} />
      </ChartFrame>
    </section>
  );
}

/** A refused pin: the server's reason, the enforced contract breaches behind it, and "Pin anyway" with a reason. */
function PinRefusal({ refusal, canForce, pending, onForce }: { refusal: BaselineRefusal; canForce: boolean; pending: boolean; onForce: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <div className="m2-result" role="alert" data-tone="fail" data-testid="pin-refusal">
      <span className="m2-result-t">
        <VerdictMark verdict="no-go" />
        {refusal.detail}
      </span>
      <ul className="m2-breaches">
        {refusal.breaches.map((b, i) => (
          <li key={`${b.contract_id ?? ""}:${b.module ?? ""}:${b.metric}:${i}`}>
            <span>{b.module ? tr("{name}, {object}", { name: b.name ?? tr("Data contract"), object: moduleText(b.module) }) : (b.name ?? tr("Data contract"))}</span>
            <span className="m2-meta">{breachWords(b)}</span>
          </li>
        ))}
      </ul>
      {canForce ? (
        <span style={{ display: "flex", flexWrap: "wrap", gap: "var(--m2-s2)", alignItems: "center" }}>
          <label className="m2-sr" htmlFor="pin-reason">
            {tr("Why this run is pinned anyway")}
          </label>
          <input id="pin-reason" className="m2-inp" placeholder={tr("Why pin it anyway (audited)")} value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} />
          <button type="button" className="m2-btn m2-sm" disabled={!reason.trim() || pending} onClick={() => onForce(reason.trim())}>
            {tr("Pin anyway")}
          </button>
        </span>
      ) : null}
    </div>
  );
}

/** The "Compare with" control: the other runs of the scope, newest first, and the link that opens the pair. */
export function CompareControl({ id, runs }: { id: string; runs: readonly TimelineRun[] }) {
  const others = useMemo(() => runs.filter((r) => r.id !== id).reverse(), [runs, id]);
  // The default partner measured the same objects: a run of another object compares nothing ("0 rules that ran
  // cleanly in both runs"). The baseline when it shares an object, else the newest earlier run that does.
  const shares = useMemo(() => {
    const mine = new Set(Object.keys(runs.find((r) => r.id === id)?.objects ?? {}));
    return (r: TimelineRun) => mine.size === 0 || Object.keys(r.objects ?? {}).some((m) => mine.has(m));
  }, [runs, id]);
  const base = others.find((r) => r.baseline && shares(r));
  const prev = useMemo(() => {
    const at = runs.findIndex((r) => r.id === id);
    const earlier = runs.slice(0, Math.max(0, at)).reverse();
    return earlier.find(shares) ?? others.find(shares) ?? (at > 0 ? runs[at - 1] : others[0]);
  }, [runs, id, others, shares]);
  const [picked, setPicked] = useState<string | null>(null);
  const other = picked ?? (base ?? prev)?.id ?? null;
  if (others.length === 0) return null;
  const t = (rid: string) => new Date(runs.find((r) => r.id === rid)?.run_at ?? 0).getTime();
  // The newest run of the same objects at least 30 days before this one: the month-on-month view in one click (F31).
  const monthAgo = others.find((r) => shares(r) && new Date(r.run_at ?? 0).getTime() <= t(id) - 30 * 86_400_000);
  const [a, b] = other ? (t(other) <= t(id) ? [other, id] : [id, other]) : [id, id];
  return (
    <span className="m2-pop-cmp">
      <label htmlFor="run-compare-with" className="m2-meta">
        {tr("Compare with")}
      </label>
      <select id="run-compare-with" className="m2-sel" value={other ?? ""} onChange={(e) => setPicked(e.target.value)}>
        {others.map((r) => (
          <option key={r.id} value={r.id}>
            {`${formatDate(r.run_at, "datetime")}${r.baseline ? tr(" (baseline)") : ""}`}
          </option>
        ))}
      </select>
      <V2Link href={`/run/${a}/vs/${b}`} className="m2-btn">
        {tr("Compare")}
      </V2Link>
      {monthAgo ? (
        <V2Link href={`/run/${monthAgo.id}/vs/${id}`} title={formatDate(monthAgo.run_at, "datetime")}>
          {tr("Compare with last month")}
        </V2Link>
      ) : null}
    </span>
  );
}

function ObjectTable({ cells, labelOf, systemName, run }: { cells: LandscapeCell[]; labelOf: (m: string) => string; systemName: string; run: string }) {
  return (
    <div className="m2-frame">
      <table className="m2-tbl" data-testid="run-objects">
        <thead>
          <tr>
            <th scope="col">{tr("Object")}</th>
            <th scope="col" className="m2-r" title={tr("The score before any cap")}>
              {tr("Measured")}
            </th>
            <th scope="col" className="m2-r" title={tr("The score after the critical cap")}>
              {tr("Shown")}
            </th>
            <th scope="col">{tr("Verdict")}</th>
            <th scope="col" className="m2-r">
              {tr("Records checked")}
            </th>
            <th scope="col" className="m2-r">
              {tr("Rules")}
            </th>
            <th scope="col" className="m2-r">
              {tr("Open work")}
            </th>
          </tr>
        </thead>
        <tbody>
          {cells.map((c) => (
            <tr key={c.module}>
              <th scope="row">
                <V2Link href={`/o/${systemSlug(systemName)}/${moduleSlug(c.module)}?run=${run}`}>{labelOf(c.module)}</V2Link>
              </th>
              <td className="m2-r">{f1(c.raw_score)}</td>
              <td className="m2-r">
                {f1(c.score)}
                {c.capped ? <span className="m2-meta">{" "}{tr("capped")}</span> : null}
              </td>
              <td>
                <span className="m2-v">
                  <VerdictMark verdict={c.verdict} />
                  {VERDICT_LABEL[c.verdict]}
                </span>
              </td>
              <td className="m2-r">{int(c.records_checked)}</td>
              <td className="m2-r">{int(c.rules_measured)}</td>
              <td className="m2-r">{c.open_work == null ? <Dash why={tr("Open work is counted for the objects with a work ledger")} /> : int(c.open_work)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The jobs that made this run: its extraction and its analysis, from the job registry. */
export function RunJobs({ runId }: { runId: string }) {
  const jobs = useV2Jobs();
  const { hrefFor } = useOpenItem();
  const mine = jobs.jobs.filter((j) => j.version_id === runId || j.id === runId || j.id === `dl-${runId}`);
  return (
    <section className="m2-sec" aria-label={tr("Jobs")}>
      <div className="m2-sechead">
        <h2 className="m2-h2">{tr("Jobs")}</h2>
        <span className="m2-sub">{tr("The extraction and analysis that made this run")}</span>
      </div>
      {jobs.isLoading ? (
        <Skeleton width="100%" height={64} />
      ) : mine.length === 0 ? (
        <EmptyFrame>{tr("No job record is kept for this run. The registry holds jobs for 7 days, and the 200 most recent.")}</EmptyFrame>
      ) : (
        <div className="m2-frame">
          <table className="m2-tbl" data-testid="run-jobs">
            <thead>
              <tr>
                <th scope="col">{tr("Job")}</th>
                <th scope="col">{tr("State")}</th>
                <th scope="col">{tr("Started")}</th>
                <th scope="col" className="m2-r">
                  {tr("Took")}
                </th>
              </tr>
            </thead>
            <tbody>
              {mine.map((j) => {
                const secs = jobSeconds(j);
                return (
                  <tr key={j.id}>
                    <th scope="row">
                      <V2Link href={hrefFor({ kind: "job", id: j.id })}>{`${JOB_KIND_LABEL[j.kind]}, ${jobObject(j)}`}</V2Link>
                    </th>
                    <td>
                      <span className="m2-v">
                        {j.status === "completed" ? <VerdictMark verdict="go" /> : j.status === "failed" ? <VerdictMark verdict="no-go" /> : null}
                        {JOB_STATUS_LABEL[j.status]}
                      </span>
                    </td>
                    <td>{formatDate(j.started_at * 1000, "datetime")}</td>
                    <td className="m2-r">{secs == null ? <Dash /> : duration(secs)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * `/run/{id}`: one run. Its status line, what it scored object by object, the actions on it and the jobs that made
 * it. Scores are the run's own (the landscape read scoped to it), never the current state.
 */
/** The three kinds of rule the SAP team proves by hand before go-live (docs/live-deployment-checklist.md section 8). */
const PROVE_KINDS: { kind: () => string; classes: string[] }[] = [
  { kind: () => tr("Completeness"), classes: ["null_check"] },
  { kind: () => tr("Value list"), classes: ["referential_check", "domain_value_check"] },
  { kind: () => tr("Join or condition"), classes: ["exists_check", "cross_field_check", "uniqueness_check"] },
];

/** Prove three rules: the most failing rule of each kind in this run, each opening at Prove in SAP. */
export function proveThree(rules: readonly RuleRow[]): { kind: () => string; rule: RuleRow }[] {
  const failing = [...rules].filter((r) => r.affected_count > 0).sort((a, b) => b.affected_count - a.affected_count);
  return PROVE_KINDS.flatMap(({ kind, classes }) => {
    const rule = failing.find((r) => classes.includes(r.check_class ?? ""));
    return rule ? [{ kind, rule }] : [];
  });
}

function ProveThree({ run, modules }: { run: string; modules: string[] }) {
  const fixture = useFixture();
  const qs = useQueries({ queries: modules.map((m) => ({ queryKey: v2Keys.rules(fixture, m, run, 0), queryFn: () => getObjectRules(m, run), staleTime: 30_000 })) });
  const picks = proveThree(qs.flatMap((q) => q.data ?? []));
  if (picks.length === 0) return null;
  return (
    <section className="m2-sec" aria-label={tr("Prove three rules")} data-testid="run-prove-three">
      <div className="m2-sechead">
        <h2 className="m2-h2">{tr("Prove three rules")}</h2>
        <span className="m2-sub">{tr("Count them in SE16 before anyone acts on a number")}</span>
      </div>
      <ul className="m2-prove3">
        {picks.map(({ kind, rule }) => (
          <li key={rule.check_id}>
            <V2Link href={`/r/${encodeURIComponent(rule.check_id)}?tab=prove`}>
              <span className="m2-meta">{kind()}</span> <span className="m2-mono">{rule.check_id}</span> {rule.name}
            </V2Link>
            <span className="m2-meta"> {tr("{count} failing", { count: int(rule.affected_count) })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RunCanvas({ id }: { id: string }) {
  const qc = useQueryClient();
  const session = useV2Session();
  const head = useVersionHead(id);
  const land = useLandscape(id);
  const timeline = useTimeline(null, 50);
  const page = useVersionsPage({ limit: 200 });
  const { outcome, pending, run } = useOutcome();

  const v = head.data;
  const L = land.data;
  const meta = timeline.data?.runs.find((r) => r.id === id) ?? null;
  const systemId = v?.metadata?.system_id ?? L?.cells[0]?.system_id ?? null;
  const system = L?.systems.find((s) => s.id === systemId) ?? null;
  const labelOf = (m: string) => L?.objects.find((o) => o.module === m)?.label ?? m;
  const cells = (L?.cells ?? []).filter((c) => !systemId || c.system_id === systemId);
  const baseline = Boolean(v?.metadata?.baseline);
  const [refusal, setRefusal] = useState<BaselineRefusal | null>(null);
  const archived = Boolean(v?.metadata?.archived);
  const canChange = session.can("analyse");
  const strip = L?.status_strip;

  const rank = (page.data?.versions ?? []).findIndex((r) => r.id === id);
  const older = rank >= 0 ? (page.data?.total ?? 0) - rank - 1 : 0;
  const refresh = () => void qc.invalidateQueries({ queryKey: ["v2"] });

  const counts = cells.reduce((n, c) => ({ ...n, [c.verdict]: (n[c.verdict] ?? 0) + 1 }), {} as Partial<Record<LandscapeCell["verdict"], number>>);

  if (head.isError) {
    return (
      <>
        <PageTitle>{tr("Run")}</PageTitle>
        <div className="m2-sec">
          <ErrorFrame onRetry={() => void head.refetch()}>{tr("This run could not be read. It may belong to another tenant or have been removed.")}</ErrorFrame>
        </div>
      </>
    );
  }

  const parts: string[] = v
    ? [
        system?.name ?? "",
        strip ? tr("{records_checked} records checked", { records_checked: int(strip.records_checked) }) : "",
        strip ? tr("{rules_measured} rules measured", { rules_measured: int(strip.rules_measured) }) : "",
        meta?.duration_s != null ? tr("scored in {duration_s}", { duration_s: duration(meta.duration_s) }) : "",
        tr("trigger {kindWord}", { kindWord: lc(kindWord(triggerOf(meta?.kind, v.metadata))) }),
      ].filter(Boolean)
    : [];

  return (
    <>
      <PageTitle sub={system?.name}>{v ? tr("Run {run_at}", { run_at: formatDate(v.run_at, "datetime") }) : tr("Run")}</PageTitle>
      <p className="m2-statusline" data-testid="run-status-line">
        {v ? (
          <>
            <span>
              {parts.map((p, i) => (
                <Fragment key={p}>
                  {i > 0 ? <Dot /> : null}
                  {p}
                </Fragment>
              ))}
            </span>
            {baseline ? (
              <span className="m2-v">{tr("Baseline")}</span>
            ) : null}
            {archived ? (
              <span>{tr("Archived")}</span>
            ) : null}
            {v.status === "failed" ? (
              <span className="m2-v">
                <VerdictMark verdict="no-go" />
                {tr("Failed")}
              </span>
            ) : null}
          </>
        ) : (
          <Skeleton width={420} height={14} />
        )}
      </p>
      {cells.length > 0 ? (
        <p className="m2-finding" data-testid="run-sentence">
          {tr("{cellsCount} {cellsCount, plural, one {object} other {objects}} scored: {go} go, {counts} at risk, {counts2} no-go.", { cellsCount: cells.length, go: counts.go ?? 0, counts: counts["at-risk"] ?? 0, counts2: counts["no-go"] ?? 0 })}
        </p>
      ) : null}

      <div className="m2-cta" data-testid="run-actions">
        <V2Link href={`/?run=${id}`} className="m2-btn m2-next">
          {tr("Show scores from this run")}
        </V2Link>
        <button
          type="button"
          className="m2-btn"
          disabled={!canChange || pending !== null || !v}
          onClick={() =>
            void run("pin", async () => {
              setRefusal(null);
              let r: { baseline: boolean };
              try {
                r = await pinBaseline(id, !baseline);
              } catch (e) {
                const refused = baselineRefusalOf(e);
                if (!refused) throw e;
                setRefusal(refused);
                return { tone: "fail", title: tr("Not pinned"), detail: refused.detail };
              }
              refresh();
              return { tone: "ok", title: r.baseline ? tr("Pinned as the baseline") : tr("Baseline unpinned"), detail: r.baseline ? tr("Later runs of this system compare with it by default.") : tr("Later runs compare with the run before them.") };
            })
          }
        >
          {baseline ? tr("Unpin baseline") : tr("Pin as baseline")}
        </button>
        {archived ? (
          <button
            type="button"
            className="m2-btn"
            disabled={!canChange || pending !== null}
            onClick={() =>
              void run("restore", async () => {
                const r = await restoreRuns();
                refresh();
                return { tone: "ok", title: tr("{restored} {restored, plural, one {run} other {runs}} restored", { restored: r.restored }), detail: tr("Every archived run is back in the lists.") };
              })
            }
          >
            {tr("Restore archived runs")}
          </button>
        ) : (
          <button
            type="button"
            className="m2-btn"
            disabled={!canChange || pending !== null || older === 0}
            title={older === 0 ? tr("No run is older than this one") : undefined}
            onClick={() =>
              void run("archive", async () => {
                const r = await archiveRuns(rank + 1);
                refresh();
                return { tone: "ok", title: tr("{archived} older {archived, plural, one {run} other {runs}} archived", { archived: r.archived }), detail: tr("Nothing is deleted: findings, reports and history stay, and Restore brings the runs back.") };
              })
            }
          >
            {older > 0 ? tr("Archive the {older} older {older, plural, one {run} other {runs}}", { older }) : tr("Archive older runs")}
          </button>
        )}
        <button
          type="button"
          className="m2-btn"
          disabled={pending !== null || !v}
          onClick={() =>
            void run("report", async () => {
              await downloadRunReport(id);
              return session.fixture
                ? { tone: "info", title: tr("Fixture mode: no file is produced"), detail: "Outside fixture mode this saves the run's report from /reports/{run}/download." }
                : { tone: "ok", title: tr("Report downloading"), detail: tr("The browser saves it when the file is ready.") };
            })
          }
        >
          {tr("Download report")}
        </button>
        <CompareControl id={id} runs={timeline.data?.runs ?? []} />
      </div>
      {!canChange ? <p className="m2-prov">{tr("Pinning, archiving and restoring need the analyse permission.")}</p> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      {refusal ? (
        <PinRefusal
          refusal={refusal}
          canForce={canChange}
          pending={pending !== null}
          onForce={(reason) =>
            void run("pin", async () => {
              const r = await pinBaseline(id, true, { reason });
              setRefusal(null);
              refresh();
              return { tone: "ok", title: r.baseline ? tr("Pinned as the baseline, with the breach on record") : tr("Not pinned"), detail: tr("The reason and the breaches it overrode are in the audit log.") };
            })
          }
        />
      ) : null}

      <RunShape cells={cells} labelOf={labelOf} severity={v?.severity_counts ?? null} loading={land.isLoading || head.isPending} />

      <section className="m2-sec" aria-label={tr("By object")}>
        <div className="m2-sechead">
          <h2 className="m2-h2">{tr("By object")}</h2>
          <span className="m2-sub">{tr("Measured score, then the score shown after the cap")}</span>
        </div>
        {land.isLoading ? (
          <Skeleton width="100%" height={160} />
        ) : land.isError ? (
          <ErrorFrame onRetry={() => void land.refetch()}>{tr("The objects of this run could not be read.")}</ErrorFrame>
        ) : cells.length === 0 ? (
          <EmptyFrame action={<V2Link href="/runs" className="m2-btn">{tr("All runs")}</V2Link>}>
            {v?.status === "failed" ? tr("This run failed before it scored any object.") : tr("This run has no scored object.")}
          </EmptyFrame>
        ) : (
          <ObjectTable cells={cells} labelOf={labelOf} systemName={system?.name ?? ""} run={id} />
        )}
      </section>

      <ProveThree run={id} modules={[...new Set(cells.map((c) => c.module))]} />

      <RunJobs runId={id} />
    </>
  );
}
