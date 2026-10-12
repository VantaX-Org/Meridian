// frontend/app/(app)/insights/readiness/page.tsx
"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, DataTable, DrillLink, EmptyState, Heatmap, Pill, type PillTone } from "@/design";
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

const HEAT: Record<ReadinessCell["verdict"], "go" | "at-risk" | "no-go"> = { go: "go", at_risk: "at-risk", no_go: "no-go" };

const VERDICT_LABEL: Record<ReadinessCell["verdict"], string> = {
  go: "Go",
  at_risk: "At risk",
  no_go: "No-go",
};

const blockerColumns = (run?: string): ColumnDef<ReadinessCell>[] => [
  { id: "module", header: "Object", accessorFn: (c) => formatModuleName(c.module) },
  { accessorKey: "wave", header: "Wave" },
  { id: "verdict", header: "Readiness", accessorFn: (c) => VERDICT_LABEL[c.verdict], cell: ({ row }) => <Pill tone={VERDICT_TONE[row.original.verdict]}>{VERDICT_LABEL[row.original.verdict]}</Pill> },
  { accessorKey: "blocker_count", header: "Blocking gaps", meta: { numeric: true } },
  {
    accessorKey: "records_blocked",
    header: "Records blocked",
    meta: { numeric: true },
    cell: ({ row }) => (
      <DrillLink object={row.original.module} filters={{ blocking: "true" }} run={run}>{row.original.records_blocked.toLocaleString("en-ZA")}</DrillLink>
    ),
  },
];

export default function ReadinessPage() {
  const router = useRouter();
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

  const blockers = (data?.cells ?? []).filter((c) => c.records_blocked > 0 || c.blocker_count > 0).sort((a, b) => b.records_blocked - a.records_blocked);
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
      <Card title="Which waves are blocked">
        <Heatmap
          rows={modules.map(formatModuleName)}
          cols={waves}
          cells={(data?.cells ?? []).map((c) => ({ row: formatModuleName(c.module), col: c.wave, value: HEAT[c.verdict] }))}
          onPointClick={(cell) => {
            const mod = modules.find((m) => formatModuleName(m) === cell.row);
            if (mod) router.push(`/objects/${mod}?${new URLSearchParams({ ...(run ? { run } : {}), wave: cell.col })}`);
          }}
        />
        <p className="mt-2 text-[13px]" style={{ color: "var(--m-ink-2)" }}>Select a cell to see its blocking records.</p>
      </Card>
      <Card title="Blockers">
        {blockers.length === 0 ? (
          <EmptyState title="No blockers in this run" detail="Every wave and object cell can load." action={<Button render={<Link href="/objects">Open objects</Link>} />} ghost="grid" />
        ) : (
          <DataTable
            columns={blockerColumns(run)}
            data={blockers}
            getRowId={(c) => `${c.module}-${c.wave}`}
            hideToolbar
            dense
            height="auto"
          />
        )}
      </Card>
    </InsightFrame>
  );
}
