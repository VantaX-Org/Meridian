/**
 * Aurora WS3 data-primitive gallery.
 *
 * Renders every data primitive (Table, Stat, KpiRail, charts, ProcessGraph)
 * with realistic sample data for visual regression. All tokens resolve from
 * `data-theme="dark"` on the root `<div>` so the gallery reads as Aurora.
 *
 * Retires at WS8 cutover alongside the other playground pages.
 */

"use client";

import { useMemo, useState } from "react";
import {
  AreaChart,
  BarChart,
  DataTable,
  DonutChart,
  KpiRail,
  LineChart,
  ProcessGraph,
  Sparkline,
  Stack,
  Stat,
  Text,
  type ProcessAlignment,
  type ProcessStepKind,
} from "@/components/aurora";
import type { ColumnDef } from "@tanstack/react-table";

interface FindingRow {
  id: string;
  checkId: string;
  recordId: string;
  severity: "critical" | "high" | "medium" | "low";
  module: string;
  message: string;
  status: "open" | "assigned" | "resolved";
  age: number;
}

const SEVERITIES: FindingRow["severity"][] = ["critical", "high", "medium", "low"];
const MODULES = [
  "BP · BUT000",
  "MM · MARA",
  "FI · LFA1",
  "SD · KNA1",
  "HR · PA0001",
];
const MESSAGES = [
  "Missing tax ID on partner record",
  "Duplicate material across plants",
  "Bank detail validation failed",
  "Customer credit limit exceeds policy",
  "Employee hire date predates org unit",
];
const STATUSES: FindingRow["status"][] = ["open", "assigned", "resolved"];

function makeRows(count: number): FindingRow[] {
  const rows: FindingRow[] = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({
      id: `f-${String(i).padStart(5, "0")}`,
      checkId: `C${String(100 + (i % 180)).padStart(3, "0")}`,
      recordId: `${1000 + (i * 17) % 900000}`,
      severity: SEVERITIES[i % SEVERITIES.length],
      module: MODULES[i % MODULES.length],
      message: MESSAGES[i % MESSAGES.length],
      status: STATUSES[i % STATUSES.length],
      age: (i * 3) % 48,
    });
  }
  return rows;
}

const TIME_SERIES = Array.from({ length: 28 }, (_, i) => ({
  day: `D${i + 1}`,
  readiness: 72 + Math.round(Math.sin(i / 3) * 6 + (i / 4)),
  criticals: Math.max(0, 12 - Math.floor(i / 3) + (i % 3)),
}));

const BAR_SERIES = MODULES.map((m, i) => ({
  module: m.split(" · ")[0],
  open: 24 + (i * 7) % 20,
  closed: 8 + (i * 5) % 14,
}));

const DONUT = [
  { name: "Aligned", value: 412 },
  { name: "Drifting", value: 98 },
  { name: "Blocked", value: 24 },
  { name: "Unknown", value: 16 },
];

const SPARK = Array.from({ length: 14 }, (_, i) => ({
  t: i,
  v: 60 + Math.round(Math.cos(i / 2) * 8 + i),
}));

const PROCESS_NODES: Array<{
  id: string;
  data: {
    label: string;
    kind: ProcessStepKind;
    alignment: ProcessAlignment;
    stepId?: string;
    secondary?: string;
  };
}> = [
  {
    id: "source",
    data: {
      stepId: "L3.1",
      label: "Create purchase requisition",
      secondary: "ME51N · 128 cases / 30d",
      kind: "source",
      alignment: "aligned",
    },
  },
  {
    id: "transform",
    data: {
      stepId: "L3.2",
      label: "Release strategy",
      secondary: "3 variants · 124 cases",
      kind: "transform",
      alignment: "drifting",
    },
  },
  {
    id: "decision",
    data: {
      stepId: "L3.3",
      label: "Approval threshold?",
      kind: "decision",
      alignment: "aligned",
    },
  },
  {
    id: "approval",
    data: {
      stepId: "L3.4",
      label: "Manager approval",
      kind: "approval",
      alignment: "drifting",
    },
  },
  {
    id: "sink",
    data: {
      stepId: "L3.5",
      label: "Create purchase order",
      secondary: "ME21N · 118 cases",
      kind: "sink",
      alignment: "blocked",
    },
  },
];

const PROCESS_EDGES = [
  { id: "e1", source: "source", target: "transform" },
  { id: "e2", source: "transform", target: "decision" },
  { id: "e3", source: "decision", target: "approval", label: "> 10k EUR" },
  { id: "e4", source: "approval", target: "sink" },
  { id: "e5", source: "decision", target: "sink", label: "≤ 10k EUR" },
];

function Section({
  title,
  spec,
  children,
}: {
  title: string;
  spec: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        padding: "24px 0",
        borderBottom: "1px solid var(--aurora-canvas-line)",
      }}
    >
      <Stack direction="column" gap={1} className="aurora-section__head">
        <Text variant="text-micro" tone="tertiary">
          {spec}
        </Text>
        <Text variant="display-sm">{title}</Text>
      </Stack>
      <Stack direction="column" gap={4} className="aurora-section__body">
        {children}
      </Stack>
    </section>
  );
}

export default function DataPlayground() {
  const [focused, setFocused] = useState<FindingRow | null>(null);
  const rows = useMemo(() => makeRows(5000), []);

  const columns = useMemo<ColumnDef<FindingRow, unknown>[]>(
    () => [
      {
        id: "id",
        header: "Finding",
        accessorKey: "id",
        meta: { sticky: "start", width: 140 },
      },
      {
        id: "checkId",
        header: "Check",
        accessorKey: "checkId",
        meta: { width: 96, numeric: true },
      },
      {
        id: "recordId",
        header: "Record",
        accessorKey: "recordId",
        meta: { width: 112, numeric: true },
      },
      {
        id: "severity",
        header: "Severity",
        accessorKey: "severity",
        meta: { width: 108 },
        cell: (ctx) => (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color:
                ctx.getValue() === "critical"
                  ? "var(--aurora-status-danger-500)"
                  : ctx.getValue() === "high"
                    ? "var(--aurora-status-warning-500)"
                    : "var(--aurora-fg-tertiary)",
            }}
          >
            {ctx.getValue() as string}
          </span>
        ),
      },
      {
        id: "module",
        header: "Module",
        accessorKey: "module",
        meta: { width: 140 },
      },
      { id: "message", header: "Message", accessorKey: "message" },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        meta: { width: 104 },
      },
      {
        id: "age",
        header: "Age (h)",
        accessorKey: "age",
        meta: { width: 88, numeric: true, align: "end" },
      },
    ],
    [],
  );

  return (
    <div
      data-theme="dark"
      data-density="default"
      style={{
        background: "var(--aurora-canvas-base)",
        color: "var(--aurora-fg-primary)",
        padding: "40px 56px",
        minHeight: "100vh",
        fontFamily: "var(--aurora-font-ui)",
      }}
    >
      <Stack direction="column" gap={2} className="aurora-page__head">
        <Text variant="text-micro" tone="tertiary">
          §6 — data primitives (WS3)
        </Text>
        <Text variant="display-lg">Data primitive gallery</Text>
        <Text variant="text-lead" tone="secondary">
          Virtualised table (5k rows, J / K, Enter), stats + KPI rail, chart
          family, and the Aurora process graph.
        </Text>
      </Stack>

      <Section title="KPI rail + stats" spec="§6.4 — Stat + KpiRail">
        <KpiRail>
          <Stat
            label="Readiness · overall"
            value="82"
            unit="/ 100"
            delta={{ value: 1.4, direction: "up", semantic: "success" }}
            sparkline={<Sparkline data={SPARK} xKey="t" yKey="v" />}
          />
          <Stat
            label="Open criticals"
            value="14"
            delta={{ value: -3.2, direction: "down", semantic: "success" }}
            tone="danger"
          />
          <Stat
            label="Records cleaned · 30d"
            value="8.4"
            unit="k"
            delta={{ value: 12.0, direction: "up", semantic: "success" }}
            tone="success"
          />
          <Stat
            label="Aligned processes"
            value="412"
            delta={{ value: 0, direction: "flat" }}
          />
        </KpiRail>
      </Section>

      <Section title="Charts" spec="§6.5 — Recharts wrapped in Aurora theme">
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 24,
          }}
        >
          <LineChart
            data={TIME_SERIES}
            xKey="day"
            series={[
              { key: "readiness", label: "Readiness" },
              { key: "criticals", label: "Criticals" },
            ]}
            ariaLabel="Readiness and criticals over 28 days"
          />
          <BarChart
            data={BAR_SERIES}
            xKey="module"
            series={[
              { key: "open", label: "Open" },
              { key: "closed", label: "Closed" },
            ]}
            stacked
            ariaLabel="Findings by module, stacked by status"
          />
          <AreaChart
            data={TIME_SERIES}
            xKey="day"
            series={[{ key: "readiness", label: "Readiness" }]}
            ariaLabel="Readiness area over 28 days"
          />
          <DonutChart data={DONUT} ariaLabel="Process alignment breakdown" />
        </div>
      </Section>

      <Section
        title="Virtualised table"
        spec="§6.3 — TanStack Table + TanStack Virtual, J/K nav, Enter to activate"
      >
        <Stack direction="column" gap={2}>
          <Text variant="text-small" tone="secondary">
            {rows.length.toLocaleString()} rows. Focus the grid and use{" "}
            <kbd>J</kbd> / <kbd>K</kbd> to move, <kbd>Enter</kbd> to activate.
            Focused row:{" "}
            <Text as="span" numeric tone="accent" variant="text-small">
              {focused ? focused.id : "none"}
            </Text>
          </Text>
          <DataTable
            data={rows}
            columns={columns}
            getRowId={(row) => row.id}
            onRowFocus={setFocused}
            onRowActivate={(row) => window.alert(`Activate ${row.id}`)}
            ariaLabel="Findings grid"
            maxHeight={420}
          />
        </Stack>
      </Section>

      <Section title="Process graph" spec="§6.6 — React Flow + Dagre">
        <ProcessGraph
          nodes={PROCESS_NODES}
          edges={PROCESS_EDGES}
          direction="LR"
          height={360}
        />
      </Section>
    </div>
  );
}
