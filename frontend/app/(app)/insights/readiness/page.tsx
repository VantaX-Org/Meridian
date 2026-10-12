// frontend/app/(app)/insights/readiness/page.tsx
"use client";

import { Fragment } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Button, Card, DrillLink, Pill, type PillTone } from "@/design";
import { getReadiness, type ReadinessCell } from "@/lib/api/insights";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { formatModuleName } from "@/lib/format";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { InsightFrame, useRunLabel } from "../_components/InsightFrame";

const VERDICT_TONE: Record<ReadinessCell["verdict"], PillTone> = {
  go: "go",
  at_risk: "at-risk",
  no_go: "no-go",
};

const VERDICT_LABEL: Record<ReadinessCell["verdict"], string> = {
  go: "Go",
  at_risk: "At risk",
  no_go: "No-go",
};

export default function ReadinessPage() {
  const search = useSearchParams();
  const run = search.get("run") ?? undefined;
  const dayOne = useDayOne();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.insights("readiness", run),
    queryFn: () => getReadiness({ version_id: run }),
  });

  let state: "loading" | "empty" | "error" | undefined;
  if (isLoading || dayOne.status === "loading") {
    state = "loading";
  } else if (isListFailure({ isError, error })) {
    state = "error";
  } else if (data && data.cells.length === 0) {
    state = "empty";
  }

  const emptyTitle = data && !data.configured
    ? "Readiness waves not set"
    : "No readiness data yet";
  const emptyDetail = data && !data.configured
    ? "Set readiness waves under Settings > Alert Thresholds."
    : dayOne.step?.detail;
  const emptyAction = data && !data.configured
    ? <Button render={<Link href="/rules/scoring">Scoring and alerts</Link>} />
    : <DayOneAction step={dayOne.step} fallbackHref="/runs" fallbackLabel="Open runs" />;

  const modules = Array.from(new Set(data?.cells.map((c) => c.module) ?? []));
  const waves = Array.from(new Set(data?.cells.map((c) => c.wave) ?? []));

  const runLabel = useRunLabel(data?.version_id);
  const noGo = data?.cells.filter((c) => c.verdict === "no_go").length ?? 0;
  const blocked = data?.cells.reduce((n, c) => n + c.records_blocked, 0) ?? 0;

  return (
    <InsightFrame
      title="Readiness"
      meta={runLabel}
      insight={{
        situation: { sentence: `${noGo} of ${data?.cells.length ?? 0} wave and object cells are no-go`, tone: noGo ? "no-go" : "go" },
        changed: { sentence: `Threshold is ${data?.threshold ?? "—"}% readiness` },
        why: { sentence: `${blocked.toLocaleString("en-ZA")} records are blocked from loading` },
        next: { sentence: noGo ? "Fix blockers in the worst cell first" : "Hold the line", action: { label: "Open inbox", href: "/inbox" } },
      }}
      state={state}
      emptyProps={{ title: emptyTitle, detail: emptyDetail, action: emptyAction, ghost: "grid" }}
      errorProps={{ message: apiErrorMessage(error), onRetry: () => void refetch() }}
    >
      <Card title="Readiness by wave">
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <th scope="col" className="text-left p-2">Object</th>
              {waves.map((w) => (
                <Fragment key={w}>
                  <th scope="col" className="text-left p-2">{w}</th>
                  {/* Sub-headers repeat their wave name so each cell's accessible name
                      is unambiguous to screen readers when there are 2+ waves. */}
                  <th scope="col" className="text-right p-2">{`${w} readiness`}</th>
                  <th scope="col" className="text-right p-2">{`${w} records blocked`}</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map((module) => (
              <tr key={module}>
                <td className="p-2">{formatModuleName(module)}</td>
                {waves.map((wave) => {
                  const cell = data?.cells.find((c) => c.module === module && c.wave === wave);
                  if (!cell) {
                    return (
                      <Fragment key={wave}>
                        <td className="p-2">—</td>
                        <td className="text-right tabular-nums">—</td>
                        <td className="text-right tabular-nums">—</td>
                      </Fragment>
                    );
                  }
                  return (
                    <Fragment key={wave}>
                      <td className="p-2">
                        {/* DrillLink filters is Record<string, string>; stringify the boolean */}
                        <DrillLink object={module} filters={{ blocking: "true" }} run={run}>
                          <Pill tone={VERDICT_TONE[cell.verdict]}>{VERDICT_LABEL[cell.verdict]}</Pill>
                        </DrillLink>
                      </td>
                      <td className="text-right tabular-nums">
                        {cell.score === null ? "—" : <DrillLink object={module} filters={{ blocking: "true" }} run={run}>{`${cell.score.toFixed(1)}%`}</DrillLink>}
                      </td>
                      <td className="text-right tabular-nums">
                        <DrillLink object={module} filters={{ blocking: "true" }} run={run}>{cell.records_blocked.toLocaleString()}</DrillLink>
                      </td>
                    </Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[13px]" style={{ color: "var(--m-ink-2)" }}>Select a cell to see its blocking records.</p>
      </Card>
    </InsightFrame>
  );
}
