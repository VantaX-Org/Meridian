"use client";

import { Fragment, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import type { LandscapeCell } from "@/lib/api/v2/types";
import { archiveRuns, downloadRunReport, pinBaseline, restoreRuns, type TimelineRun } from "@/lib/api/v2/runs";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { JOB_KIND_LABEL, JOB_STATUS_LABEL, jobObject, jobSeconds } from "@/lib/v2/jobs";
import { useLandscape } from "@/lib/v2/queries";
import { useTimeline, useV2Jobs, useVersionHead, useVersionsPage } from "@/lib/v2/runs-queries";
import { f1, int, moduleSlug, systemSlug, VERDICT_LABEL } from "@/lib/v2/score";
import { VerdictMark } from "../marks";
import { Dash, Dot, EmptyFrame, ErrorFrame, PageTitle, Skeleton, V2Link } from "../parts";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { kindWord } from "../RunTimeline";
import { duration } from "../shell/StatusStrip";

/** The "Compare with" control: the other runs of the scope, newest first, and the link that opens the pair. */
export function CompareControl({ id, runs }: { id: string; runs: readonly TimelineRun[] }) {
  const others = useMemo(() => runs.filter((r) => r.id !== id).reverse(), [runs, id]);
  const base = others.find((r) => r.baseline);
  const prev = useMemo(() => {
    const at = runs.findIndex((r) => r.id === id);
    return at > 0 ? runs[at - 1] : others[0];
  }, [runs, id, others]);
  const [picked, setPicked] = useState<string | null>(null);
  const other = picked ?? (base ?? prev)?.id ?? null;
  if (others.length === 0) return null;
  const t = (rid: string) => new Date(runs.find((r) => r.id === rid)?.run_at ?? 0).getTime();
  const [a, b] = other ? (t(other) <= t(id) ? [other, id] : [id, other]) : [id, id];
  return (
    <span className="m2-pop-cmp">
      <label htmlFor="run-compare-with" className="m2-meta">
        Compare with
      </label>
      <select id="run-compare-with" className="m2-sel" value={other ?? ""} onChange={(e) => setPicked(e.target.value)}>
        {others.map((r) => (
          <option key={r.id} value={r.id}>
            {`${formatDate(r.run_at, "datetime")}${r.baseline ? " (baseline)" : ""}`}
          </option>
        ))}
      </select>
      <V2Link href={`/v2/run/${a}/vs/${b}`} className="m2-btn">
        Compare
      </V2Link>
    </span>
  );
}

function ObjectTable({ cells, labelOf, systemName, run }: { cells: LandscapeCell[]; labelOf: (m: string) => string; systemName: string; run: string }) {
  return (
    <div className="m2-frame">
      <table className="m2-tbl" data-testid="run-objects">
        <thead>
          <tr>
            <th scope="col">Object</th>
            <th scope="col" className="m2-r" title="The score before any cap">
              Measured
            </th>
            <th scope="col" className="m2-r" title="The score after the critical cap">
              Shown
            </th>
            <th scope="col">Verdict</th>
            <th scope="col" className="m2-r">
              Records checked
            </th>
            <th scope="col" className="m2-r">
              Rules
            </th>
            <th scope="col" className="m2-r">
              Open work
            </th>
          </tr>
        </thead>
        <tbody>
          {cells.map((c) => (
            <tr key={c.module}>
              <th scope="row">
                <V2Link href={`/v2/o/${systemSlug(systemName)}/${moduleSlug(c.module)}?run=${run}`}>{labelOf(c.module)}</V2Link>
              </th>
              <td className="m2-r">{f1(c.raw_score)}</td>
              <td className="m2-r">
                {f1(c.score)}
                {c.capped ? <span className="m2-meta"> capped</span> : null}
              </td>
              <td>
                <span className="m2-v">
                  <VerdictMark verdict={c.verdict} />
                  {VERDICT_LABEL[c.verdict]}
                </span>
              </td>
              <td className="m2-r">{int(c.records_checked)}</td>
              <td className="m2-r">{int(c.rules_measured)}</td>
              <td className="m2-r">{c.open_work == null ? <Dash why="Open work is counted for the objects with a work ledger" /> : int(c.open_work)}</td>
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
    <section className="m2-sec" aria-label="Jobs">
      <div className="m2-sechead">
        <h2 className="m2-h2">Jobs</h2>
        <span className="m2-sub">The extraction and analysis that made this run</span>
      </div>
      {jobs.isLoading ? (
        <Skeleton width="100%" height={64} />
      ) : mine.length === 0 ? (
        <EmptyFrame>No job record is kept for this run. The registry holds jobs for 7 days, and the 200 most recent.</EmptyFrame>
      ) : (
        <div className="m2-frame">
          <table className="m2-tbl" data-testid="run-jobs">
            <thead>
              <tr>
                <th scope="col">Job</th>
                <th scope="col">State</th>
                <th scope="col">Started</th>
                <th scope="col" className="m2-r">
                  Took
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
 * `/v2/run/{id}`: one run. Its status line, what it scored object by object, the actions on it and the jobs that made
 * it. Scores are the run's own (the landscape read scoped to it), never the current state.
 */
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
        <PageTitle>Run</PageTitle>
        <div className="m2-sec">
          <ErrorFrame onRetry={() => void head.refetch()}>This run could not be read. It may belong to another tenant or have been removed.</ErrorFrame>
        </div>
      </>
    );
  }

  const parts: string[] = v
    ? [
        system?.name ?? "",
        strip ? `${int(strip.records_checked)} records checked` : "",
        strip ? `${int(strip.rules_measured)} rules measured` : "",
        meta?.duration_s != null ? `scored in ${duration(meta.duration_s)}` : "",
        `trigger ${kindWord(meta?.kind ?? v.metadata?.trigger).toLowerCase()}`,
      ].filter(Boolean)
    : [];

  return (
    <>
      <PageTitle sub={system?.name}>{v ? `Run ${formatDate(v.run_at, "datetime")}` : "Run"}</PageTitle>
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
              <span className="m2-v">Baseline</span>
            ) : null}
            {archived ? (
              <span>Archived</span>
            ) : null}
            {v.status === "failed" ? (
              <span className="m2-v">
                <VerdictMark verdict="no-go" />
                Failed
              </span>
            ) : null}
          </>
        ) : (
          <Skeleton width={420} height={14} />
        )}
      </p>
      {cells.length > 0 ? (
        <p className="m2-finding" data-testid="run-sentence">
          {`${cells.length} ${cells.length === 1 ? "object" : "objects"} scored: ${counts.go ?? 0} go, ${counts["at-risk"] ?? 0} at risk, ${counts["no-go"] ?? 0} no-go.`}
        </p>
      ) : null}

      <div className="m2-cta" data-testid="run-actions">
        <V2Link href={`/v2?run=${id}`} className="m2-btn m2-next">
          Show scores from this run
        </V2Link>
        <button
          type="button"
          className="m2-btn"
          disabled={!canChange || pending !== null || !v}
          onClick={() =>
            void run("pin", async () => {
              const r = await pinBaseline(id, !baseline);
              refresh();
              return { tone: "ok", title: r.baseline ? "Pinned as the baseline" : "Baseline unpinned", detail: r.baseline ? "Later runs of this system compare with it by default." : "Later runs compare with the run before them." };
            })
          }
        >
          {baseline ? "Unpin baseline" : "Pin as baseline"}
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
                return { tone: "ok", title: `${r.restored} ${r.restored === 1 ? "run" : "runs"} restored`, detail: "Every archived run is back in the lists." };
              })
            }
          >
            Restore archived runs
          </button>
        ) : (
          <button
            type="button"
            className="m2-btn"
            disabled={!canChange || pending !== null || older === 0}
            title={older === 0 ? "No run is older than this one" : undefined}
            onClick={() =>
              void run("archive", async () => {
                const r = await archiveRuns(rank + 1);
                refresh();
                return { tone: "ok", title: `${r.archived} older ${r.archived === 1 ? "run" : "runs"} archived`, detail: "Nothing is deleted: findings, reports and history stay, and Restore brings the runs back." };
              })
            }
          >
            {older > 0 ? `Archive the ${older} older ${older === 1 ? "run" : "runs"}` : "Archive older runs"}
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
                ? { tone: "info", title: "Fixture mode: no file is produced", detail: "Outside fixture mode this saves the run's report from /reports/{run}/download." }
                : { tone: "ok", title: "Report downloading", detail: "The browser saves it when the file is ready." };
            })
          }
        >
          Download report
        </button>
        <CompareControl id={id} runs={timeline.data?.runs ?? []} />
      </div>
      {!canChange ? <p className="m2-prov">Pinning, archiving and restoring need the analyse permission.</p> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}

      <section className="m2-sec" aria-label="By object">
        <div className="m2-sechead">
          <h2 className="m2-h2">By object</h2>
          <span className="m2-sub">Measured score, then the score shown after the cap</span>
        </div>
        {land.isLoading ? (
          <Skeleton width="100%" height={160} />
        ) : land.isError ? (
          <ErrorFrame onRetry={() => void land.refetch()}>The objects of this run could not be read.</ErrorFrame>
        ) : cells.length === 0 ? (
          <EmptyFrame action={<V2Link href="/v2/runs" className="m2-btn">All runs</V2Link>}>
            {v?.status === "failed" ? "This run failed before it scored any object." : "This run has no scored object."}
          </EmptyFrame>
        ) : (
          <ObjectTable cells={cells} labelOf={labelOf} systemName={system?.name ?? ""} run={id} />
        )}
      </section>

      <RunJobs runId={id} />
    </>
  );
}
