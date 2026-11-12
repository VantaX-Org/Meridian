"use client";

import { formatDate } from "@/lib/format";
import { exportRunSteps, type ExportFormat, type RunStep } from "@/lib/api/v2/run-ops";
import { useV2Session } from "@/lib/v2/hooks";
import { useRunSteps } from "@/lib/v2/runs-queries";
import { VerdictMark } from "../marks";
import { Dash, EmptyFrame, ErrorFrame, Skeleton } from "../parts";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { duration } from "../shell/StatusStrip";
import { t as tr } from "@/lib/v2/i18n";
import { CcHBars } from "./cc-parts";
import { TableExport } from "@/design/v2/TableExport";

const STATUS_WORD = { get completed() { return tr("Done"); }, get failed() { return tr("Failed"); }, get running() { return tr("Running"); }, get pending() { return tr("Waiting"); } } as Record<string, string>;

const seconds = (s: RunStep): number => (s.duration_ms ?? 0) / 1000;

function StepsExport({ id }: { id: string }) {
  const session = useV2Session();
  const { outcome, pending, run } = useOutcome();
  const allowed = session.can("export");
  const go = (format: ExportFormat) =>
    void run(format, async () => {
      await exportRunSteps(id, format);
      return session.fixture ? { tone: "info", title: tr("Fixture mode: no file is produced") } : { tone: "ok", title: tr("Steps downloading") };
    });
  return (
    <span className="m2-cta" data-testid="run-steps-export">
      {(["xlsx", "csv"] as const).map((f) => (
        <button key={f} type="button" className="m2-btn" disabled={!allowed || pending !== null} title={allowed ? tr("Export steps") : undefined} aria-describedby={allowed ? undefined : "run-steps-export-why"} onClick={() => go(f)}>
          {f === "xlsx" ? tr("Export steps to Excel") : tr("Export steps to CSV")}
        </button>
      ))}
      {allowed ? null : <span id="run-steps-export-why" className="m2-prov">{tr("Exporting steps needs the export permission")}</span>}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
    </span>
  );
}

/** What each step of a run did and how long it took: bars on one scale, the status of each, and the error where one stopped. */
export function RunSteps({ runId }: { runId: string }) {
  const q = useRunSteps(runId);
  const steps = q.data?.steps ?? [];
  return (
    <section className="m2-sec" aria-label={tr("Steps")} data-testid="run-steps">
      <div className="m2-sechead">
        <h2 className="m2-h2">{tr("Steps")}</h2>
        <span className="m2-sub">{tr("How long each step of the analysis took")}</span>
        <StepsExport id={runId} />
      </div>
      {q.isLoading ? (
        <Skeleton width="100%" height={96} />
      ) : q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{tr("The steps of this run could not be read.")}</ErrorFrame>
      ) : steps.length === 0 ? (
        <EmptyFrame>{tr("No step timings are kept for this run.")}</EmptyFrame>
      ) : (
        <>
          <CcHBars
            label={tr("Step duration")}
            testId="run-steps-bars"
            rows={steps.map((s) => ({
              key: String(s.step_number),
              label: `${s.step_number}. ${s.step_name}`,
              value: seconds(s),
              text: s.duration_ms == null ? "—" : duration(seconds(s)),
              tone: s.status === "failed" ? "crit" : "data",
            }))}
          />
          <div className="m2-frame">
            <TableExport><table className="m2-tbl" data-testid="run-steps-table">
              <thead>
                <tr>
                  <th scope="col">{tr("Step")}</th>
                  <th scope="col">{tr("State")}</th>
                  <th scope="col">{tr("Started")}</th>
                  <th scope="col" className="m2-r">{tr("Took")}</th>
                </tr>
              </thead>
              <tbody>
                {steps.map((s) => (
                  <tr key={s.step_number}>
                    <th scope="row">
                      {s.step_number}. {s.step_name}
                      {s.error_detail ? <div className="m2-sub" role="alert">{s.error_detail}</div> : null}
                    </th>
                    <td>
                      <span className="m2-v">
                        {s.status === "completed" ? <VerdictMark verdict="go" /> : s.status === "failed" ? <VerdictMark verdict="no-go" /> : null}
                        {STATUS_WORD[s.status] ?? s.status}
                      </span>
                    </td>
                    <td>{formatDate(s.started_at, "datetime")}</td>
                    <td className="m2-r">{s.duration_ms == null ? <Dash /> : duration(seconds(s))}</td>
                  </tr>
                ))}
              </tbody>
            </table></TableExport>
          </div>
        </>
      )}
    </section>
  );
}
