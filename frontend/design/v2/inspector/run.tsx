"use client";

import { formatDate } from "@/lib/format";
import { useCompareSummary, useTimeline, useVersionHead } from "@/lib/v2/runs-queries";
import { int } from "@/lib/v2/score";
import { Actions, Fact, Facts, InspectorFrame } from "../Inspector";
import { kindWord } from "../RunTimeline";
import { duration } from "../shell/StatusStrip";
import { EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";

function Since({ prev, id }: { prev: string; id: string }) {
  const q = useCompareSummary(prev, id);
  const t = q.data?.totals;
  if (q.isError) return <EmptyFrame>The change since the run before could not be read.</EmptyFrame>;
  if (!t) return <Skeleton width="100%" height={48} />;
  return (
    <ul className="m2-breaches" data-testid="run-since">
      <li>
        {int(t.newly_failing)} rules started failing, {int(t.fixed)} stopped
      </li>
      <li>
        {int(t.worse)} failing rules got worse, {int(t.better)} got better
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
    <InspectorFrame title={v ? `Run ${formatDate(v.run_at, "datetime")}` : "Run"} status={v ? (v.metadata?.baseline ? "Baseline" : v.status === "failed" ? "Failed" : undefined) : undefined} onClose={onClose}>
      {head.isLoading ? (
        <Skeleton width="100%" height={120} />
      ) : head.isError || !v ? (
        <ErrorFrame onRetry={() => void head.refetch()}>This run could not be read. It may belong to another tenant or have been removed.</ErrorFrame>
      ) : (
        <>
          <Facts>
            <Fact label="Run">
              <Mono>{id}</Mono>
            </Fact>
            <Fact label="Started by">{kindWord(run?.kind ?? v.metadata?.trigger)}</Fact>
            <Fact label="Records checked">{int(run?.records_checked)}</Fact>
            <Fact label="Took">{run?.duration_s == null ? "—" : duration(run.duration_s)}</Fact>
          </Facts>
          {prev ? (
            <>
              <h3>Since {formatDate(prev.run_at, "date")}</h3>
              <Since prev={prev.id} id={id} />
            </>
          ) : null}
          <Actions>
            <V2Link href={`/v2/run/${id}`} className="m2-btn m2-strong">
              Open the run
            </V2Link>
            {prev ? (
              <V2Link href={`/v2/run/${prev.id}/vs/${id}`} className="m2-btn">
                Compare with the run before
              </V2Link>
            ) : null}
          </Actions>
        </>
      )}
    </InspectorFrame>
  );
}
