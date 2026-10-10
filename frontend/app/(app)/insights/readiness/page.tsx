// frontend/app/(app)/insights/readiness/page.tsx
"use client";

import { Fragment } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Button, DrillLink, ExplorerPage, Pill, type PillTone } from "@/design";
import { getReadiness, type ReadinessCell } from "@/lib/api/insights";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";

const VERDICT_TONE: Record<ReadinessCell["verdict"], PillTone> = {
  go: "go",
  at_risk: "at-risk",
  no_go: "no-go",
};

const VERDICT_LABEL: Record<ReadinessCell["verdict"], string> = {
  go: "go",
  at_risk: "at_risk",
  no_go: "no_go",
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
  } else if (isError) {
    state = "error";
  } else if (data && data.cells.length === 0) {
    state = "empty";
  }

  const emptyTitle = data && !data.configured
    ? "Readiness waves not set."
    : "No readiness data for this run yet.";
  const emptyDetail = data && !data.configured
    ? "Set readiness waves under Settings > Alert Thresholds."
    : dayOne.step?.detail;
  const emptyAction = data && !data.configured
    ? <Button render={<Link href="/rules/scoring">Scoring and alerts</Link>} />
    : <DayOneAction step={dayOne.step} fallbackHref="/runs" fallbackLabel="Open runs" />;

  const modules = Array.from(new Set(data?.cells.map((c) => c.module) ?? []));
  const waves = Array.from(new Set(data?.cells.map((c) => c.wave) ?? []));

  return (
    <ExplorerPage
      table={
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
                <td className="p-2">{module}</td>
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
                      <td className="text-right tabular-nums">{cell.score === null ? "—" : `${cell.score.toFixed(1)}%`}</td>
                      <td className="text-right tabular-nums">{cell.records_blocked.toLocaleString()}</td>
                    </Fragment>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      }
      state={state}
      emptyProps={{ title: emptyTitle, detail: emptyDetail, action: emptyAction, ghost: "grid" }}
      errorProps={{
        message: apiErrorMessage(error),
        onRetry: () => refetch(),
      }}
    />
  );
}
