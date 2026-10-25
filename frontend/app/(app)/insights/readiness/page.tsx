// frontend/app/(app)/insights/readiness/page.tsx
"use client";

import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Button, Card, DataTable, DrillLink, EmptyState, Heatmap, Status, statusLabel } from "@/design";
import { getS4Readiness, type S4Area } from "@/lib/api/migration";
import { getReadiness, type ReadinessCell } from "@/lib/api/insights";
import { apiErrorMessage, isListFailure } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { formatModuleName, plural } from "@/lib/format";
import { useDayOne, DayOneAction } from "@/hooks/use-day-one";
import { useInsightScope, withScope } from "../_components/useInsightScope";
import { CardSkeleton, InsightFrame } from "../_components/InsightFrame";
import { PAGE_PURPOSE } from "../_components/InsightViews";


const HEAT: Record<ReadinessCell["verdict"], "go" | "at-risk" | "no-go"> = { go: "go", at_risk: "at-risk", no_go: "no-go" };


const blockerColumns = (run?: string): ColumnDef<ReadinessCell>[] => [
  { id: "module", header: "Object", accessorFn: (c) => formatModuleName(c.module) },
  { accessorKey: "wave", header: "Wave" },
  { id: "verdict", header: "Readiness", accessorFn: (c) => statusLabel("verdict", c.verdict), cell: ({ row }) => (
      <DrillLink href={`/objects/${row.original.module}?${new URLSearchParams({ ...(run ? { run } : {}), tab: "rules", blocking: "true", wave: row.original.wave })}`}>
        <span aria-label={`${formatModuleName(row.original.module)}, wave ${row.original.wave}: ${statusLabel("verdict", row.original.verdict)}`}>
          <Status kind="verdict" value={row.original.verdict} />
        </span>
      </DrillLink>
    ) },
  {
    accessorKey: "blocker_count",
    header: "Blocking gaps",
    meta: { numeric: true },
    cell: ({ row }) => <DrillLink object={row.original.module} filters={{ blocking: "true" }} run={run}>{row.original.blocker_count.toLocaleString()}</DrillLink>,
  },
  {
    accessorKey: "records_blocked",
    header: "Records blocked",
    meta: { numeric: true },
    cell: ({ row }) => (
      <DrillLink object={row.original.module} filters={{ blocking: "true" }} run={run}>{row.original.records_blocked.toLocaleString()}</DrillLink>
    ),
  },
  {
    id: "action", header: "", enableSorting: false,
    cell: ({ row }) => (
      <Link href={`/objects/${row.original.module}?${new URLSearchParams({ ...(run ? { run } : {}), tab: "rules", blocking: "true", wave: row.original.wave })}`} className="m-ink-accent underline underline-offset-2">Fix</Link>
    ),
  },
];

/** Without waves, the blockers table lists the S/4 simplification areas whose rules fail. */
const areaColumns = (run?: string): ColumnDef<S4Area>[] => [
  { accessorKey: "label", header: "S/4 area" },
  { accessorKey: "blocking_failing", header: "Blocking rules", meta: { numeric: true }, cell: ({ row }) => <DrillLink href={withScope("/insights/rules", { run, s4: "yes" })}>{row.original.blocking_failing.toLocaleString()}</DrillLink> },
  { accessorKey: "warning_failing", header: "Warning rules", meta: { numeric: true }, cell: ({ row }) => row.original.warning_failing.toLocaleString() },
  { accessorKey: "failing_records", header: "Records failing", meta: { numeric: true }, cell: ({ row }) => row.original.failing_records.toLocaleString() },
  { id: "action", header: "", enableSorting: false, cell: () => <Link href={withScope("/insights/rules", { run, s4: "yes" })} className="m-ink-accent underline underline-offset-2">Open rules</Link> },
];

export default function ReadinessPage() {
  const router = useRouter();
  const { run } = useInsightScope();
  const dayOne = useDayOne();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: queryKeys.insights("readiness", run),
    queryFn: () => getReadiness({ version_id: run }),
  });

  // The S/4 strip follows the run even when no wave is defined yet.
  const s4Run = data?.version_id ?? run;
  const s4 = useQuery({
    queryKey: queryKeys.insights("s4-readiness", s4Run),
    queryFn: () => getS4Readiness(s4Run ?? ""),
    enabled: !!s4Run,
  });
  const areas = s4.data?.areas ?? [];
  let blockingGaps = 0;
  let warningGaps = 0;
  for (const a of areas) {
    blockingGaps += a.blocking_failing;
    warningGaps += Math.max(0, a.failing - a.blocking_failing);
  }
  const failingAreas = areas.filter((a) => a.failing > 0).sort((a, b) => b.blocking_failing - a.blocking_failing || b.failing_records - a.failing_records);

  let state: "loading" | "empty" | "error" | undefined;
  if (isLoading || dayOne.status === "loading") {
    state = "loading";
  } else if (isListFailure({ isError, error })) {
    state = "error";
  } else if (data && data.cells.length === 0 && !s4Run) {
    // Nothing to score at all: no run and no waves. With a run, the S/4 strip still renders below.
    state = "empty";
  }

  const configured = data?.configured ?? true;
  const cells = data?.cells ?? [];
  const modules = Array.from(new Set(cells.map((c) => c.module)));
  const waves = Array.from(new Set(cells.map((c) => c.wave)));

  const blockers = cells.filter((c) => c.records_blocked > 0 || c.blocker_count > 0).sort((a, b) => b.records_blocked - a.records_blocked);
  const worst = blockers[0];
  const noGo = cells.filter((c) => c.verdict === "no_go").length;
  const blocked = cells.reduce((n, c) => n + c.records_blocked, 0);

  const waveEmpty = !configured ? (
    <EmptyState
      title="Readiness is not set up yet"
      detail="Readiness needs a wave: the set of objects you move together. Create one in the migration cockpit and set its minimum readiness there. Each object then gets a go or no-go here."
      action={<Button render={<Link href="/migration">Open migration cockpit</Link>} />}
      ghost="grid"
    />
  ) : (
    <EmptyState
      title="No waves yet"
      detail="A wave is the set of objects you move together. Create one in the migration cockpit and every object in it gets a go or no-go here."
      action={<Button render={<Link href="/migration">Create wave</Link>} />}
      ghost="grid"
    />
  );

  return (
    <InsightFrame
      title="Waves"
      purpose={PAGE_PURPOSE["/insights/readiness"]}
      scope
      run={run}
      insight={{
        situation: {
          sentence: cells.length
            ? `${noGo} of ${plural(cells.length, "object and wave pair", "object and wave pairs")} ${noGo === 1 ? "is" : "are"} not ready to load`
            : s4.data ? `${plural(blockingGaps, "rule")} would block an S/4 load, and no wave is set up yet` : "No waves set up yet",
          tone: noGo || blockingGaps ? "no-go" : "go",
        },
        changed: { sentence: s4.data ? `${blockingGaps.toLocaleString()} blocking and ${warningGaps.toLocaleString()} warning rules fail` : "Blocking rules are being counted", href: withScope("/insights/rules", { run, s4: "yes" }) },
        why: { sentence: cells.length ? `${plural(blocked, "record is", "records are")} blocked from loading${typeof data?.threshold === "number" ? `; an object needs ${data.threshold}% of its records passing to load` : ""}` : "Until there is a wave, no object gets a go or no-go" },
        next: worst
          ? { sentence: `Fix blockers in ${formatModuleName(worst.module)}, ${worst.wave} first`, action: { label: "Open object", href: withScope(`/objects/${worst.module}`, { run, tab: "rules", blocking: "true" }) } }
          : cells.length
            ? { sentence: "Nothing blocks loading", action: { label: "Open objects", href: withScope("/objects", { run }) } }
            : { sentence: "Create the first wave in the migration cockpit", action: { label: "Create wave", href: "/migration" } },
      }}
      state={state}
      skeleton={
        <>
          <CardSkeleton height={240} />
          <CardSkeleton height={200} />
        </>
      }
      emptyProps={{ title: "No readiness data yet", detail: dayOne.step?.detail ?? "Readiness needs a finished run.", action: <DayOneAction step={dayOne.step} fallbackHref="/runs" fallbackLabel="Open runs" />, ghost: "grid" }}
      errorProps={{ message: apiErrorMessage(error), onRetry: () => void refetch() }}
    >
      <Card
        title="Blocked objects"
        meta={s4.data ? (
          // What the ledger's rules do to an S/4 load, as two drills into the rules; the counts are not a second stat row.
          <span data-testid="s4-strip" className="inline-flex flex-wrap items-center gap-x-4">
            <Link href={withScope("/insights/rules", { run, s4: "yes" })} className="underline-offset-2 hover:underline"><span>Blockers</span><span className="ml-1 font-medium m-numeric">{blockingGaps.toLocaleString()}</span></Link>
            <Link href={withScope("/insights/rules", { run })} className="underline-offset-2 hover:underline"><span>Warnings</span><span className="ml-1 font-medium m-numeric">{warningGaps.toLocaleString()}</span></Link>
          </span>
        ) : cells.length ? undefined : failingAreas.length ? "By S/4 simplification area, since no wave is defined" : undefined}
      >
        {blockers.length > 0 ? (
          <div role="region" aria-label="Blockers by wave and object" tabIndex={0} className="overflow-x-auto">
            <DataTable
              columns={blockerColumns(run)}
              data={blockers}
              getRowId={(c) => `${c.module}-${c.wave}`}
              hideToolbar
              dense
              height="auto"
            />
          </div>
        ) : cells.length === 0 && failingAreas.length > 0 ? (
          <div role="region" aria-label="Blockers by S/4 area" tabIndex={0} className="overflow-x-auto">
            <DataTable columns={areaColumns(run)} data={failingAreas} getRowId={(a) => a.area} hideToolbar dense height="auto" />
          </div>
        ) : (
          <EmptyState variant="inline" title="No blockers in this run" detail={cells.length ? "Every object can load in its wave." : "No failing rule would stop an S/4 load."} action={<Link href={withScope("/objects", { run })} className="underline-offset-2 hover:underline">Open objects</Link>} />
        )}
      </Card>
      <Card title="Which waves are blocked" meta="Go, at risk or no-go for every object in every wave">
        {cells.length === 0 ? waveEmpty : (
          <>
            <Heatmap
              rows={modules.map(formatModuleName)}
              cols={waves}
              cells={cells.map((c) => ({ row: formatModuleName(c.module), col: c.wave, value: HEAT[c.verdict] }))}
              onPointClick={(cell) => {
                const mod = modules.find((m) => formatModuleName(m) === cell.row);
                if (mod) router.push(`/objects/${mod}?${new URLSearchParams({ ...(run ? { run } : {}), tab: "rules", blocking: "true", wave: cell.col })}`);
              }}
            />
            <p className="mt-2 m-text-body m-ink-2">Each cell is one object in one wave. Select a cell to open the rules that block it.</p>
          </>
        )}
      </Card>
    </InsightFrame>
  );
}
