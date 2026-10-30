"use client";

import { formatDate } from "@/lib/format";
import { useCompareSummary, useTimeline, useVersionHead } from "@/lib/v2/runs-queries";
import { int } from "@/lib/v2/score";
import { Actions, Fact, Facts, InspectorFrame } from "../Inspector";
import { kindWord } from "../RunTimeline";
import { duration } from "../shell/StatusStrip";
import { EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";
import { t as tr } from "@/lib/v2/i18n";

function Since({ prev, id }: { prev: string; id: string }) {
  const q = useCompareSummary(prev, id);
  const t = q.data?.totals;
  if (q.isError) return <EmptyFrame>{tr("The change since the run before could not be read.")}</EmptyFrame>;
  if (!t) return <Skeleton width="100%" height={48} />;
  return (
    <ul className="m2-breaches" data-testid="run-since">
      <li>
        {tr("{failing} rules started failing, {fixed} stopped", { failing: int(t.newly_failing), fixed: int(t.fixed) })}
      </li>
      <li>
        {tr("{worse} failing rules got worse, {better} got better", { worse: int(t.worse), better: int(t.better) })}
      </li>
    </ul>
  );
}

/** `?open=run:<id>`: the run in brief, and the way to its canvas and to a comparison with the run before it. */
export function RunInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const head = useVersionHead(id);
  const timeline = useTimeline(null, 50);
  const runs = timeline.data?.runs ?? [];
  const at = runs.findIndex((r) => r.id === id);
  const run = at >= 0 ? runs[at] : null;
  const prev = at > 0 ? runs[at - 1] : null;
  const v = head.data;
  return (
    <InspectorFrame title={v ? tr("Run {run_at}", { run_at: formatDate(v.run_at, "datetime") }) : tr("Run")} status={v ? (v.metadata?.baseline ? tr("Baseline") : v.status === "failed" ? tr("Failed") : undefined) : undefined} onClose={onClose}>
      {head.isLoading ? (
        <Skeleton width="100%" height={120} />
      ) : head.isError || !v ? (
        <ErrorFrame onRetry={() => void head.refetch()}>{tr("This run could not be read. It may belong to another tenant or have been removed.")}</ErrorFrame>
      ) : (
        <>
          <Facts>
            <Fact label={tr("Run")}>
              <Mono>{id}</Mono>
            </Fact>
            <Fact label={tr("Started by")}>{kindWord(run?.kind ?? v.metadata?.trigger)}</Fact>
            <Fact label={tr("Records checked")}>{int(run?.records_checked)}</Fact>
            <Fact label={tr("Took")}>{run?.duration_s == null ? "—" : duration(run.duration_s)}</Fact>
          </Facts>
          {prev ? (
            <>
              <h3>{tr("Since")}{" "}{formatDate(prev.run_at, "date")}</h3>
              <Since prev={prev.id} id={id} />
            </>
          ) : null}
          <Actions>
            <V2Link href={`/run/${id}`} className="m2-btn m2-strong">
              {tr("Open the run")}
            </V2Link>
            {prev ? (
              <V2Link href={`/run/${prev.id}/vs/${id}`} className="m2-btn">
                {tr("Compare with the run before")}
              </V2Link>
            ) : null}
          </Actions>
        </>
      )}
    </InspectorFrame>
  );
}
