// frontend/app/(app)/insights/readiness/page.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { DrillLink, ExplorerPage, Pill, type PillTone } from "@/design";
import { getReadiness, type ReadinessCell } from "@/lib/api/insights";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";

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

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.insights("readiness", run),
    queryFn: () => getReadiness({ version_id: run }),
  });

  let state: "loading" | "empty" | "error" | undefined;
  if (isLoading) {
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
    : undefined;

  const modules = Array.from(new Set(data?.cells.map((c) => c.module) ?? []));
  const waves = Array.from(new Set(data?.cells.map((c) => c.wave) ?? []));

  return (
    <ExplorerPage
      table={
        <table className="w-full text-[13px]">
          <thead>
            <tr>
              <th className="text-left p-2">Object</th>
              {waves.map((w) => (
                <th key={w} className="text-left p-2">{w}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {modules.map((module) => (
              <tr key={module}>
                <td className="p-2">{module}</td>
                {waves.map((wave) => {
                  const cell = data?.cells.find((c) => c.module === module && c.wave === wave);
                  if (!cell) return <td key={wave} className="p-2">—</td>;
                  return (
                    <td key={wave} className="p-2">
                      {/* DrillLink filters is Record<string, string>; stringify the boolean */}
                      <DrillLink object={module} filters={{ blocking: "true" }} run={run}>
                        <Pill tone={VERDICT_TONE[cell.verdict]}>{VERDICT_LABEL[cell.verdict]}</Pill>
                      </DrillLink>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      }
      state={state}
      emptyProps={{ title: emptyTitle, detail: emptyDetail, ghost: "grid" }}
      errorProps={{
        message: apiErrorMessage(error),
        onRetry: () => refetch(),
      }}
    />
  );
}
