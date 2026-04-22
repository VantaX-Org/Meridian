"use client";

/**
 * Design playground — NOT linked from the nav.
 *
 * A smoke-test surface for every new primitive introduced in the phase-1
 * redesign. Visit `/_design-playground` manually to exercise KpiRail,
 * NarrativeStrip, SmallMultiplesChart, DenseDataTable, DriftSparkline,
 * FilterChipBar, SavedView, SectionHeader, and InfoHint against mock data.
 *
 * Mock data deliberately stays inside this file so it cannot drift into
 * production bundles that don't import this page.
 */

import { useMemo, useState } from "react";
import { KpiRail } from "@/components/ui/kpi-rail";
import { NarrativeStrip } from "@/components/ui/narrative-strip";
import { SectionHeader } from "@/components/ui/section-header";
import { InfoHint } from "@/components/ui/info-hint";
import { SavedView } from "@/components/ui/saved-view";
import { FilterChipBar } from "@/components/ui/filter-chip-bar";
import { SmallMultiplesChart } from "@/components/charts/small-multiples";
import { DenseDataTable, type DenseColumnDef } from "@/components/ui/dense-data-table";
import { DriftSparkline } from "@/components/charts/drift-sparkline";

interface DemoRow {
  module: string;
  score: number;
  critical: number;
  high: number;
  records: number;
  trend: number[];
}

function randomTrend(seed: number, length = 20): number[] {
  const out: number[] = [];
  let v = 70 + (seed % 20);
  for (let i = 0; i < length; i++) {
    v += ((seed * (i + 1)) % 7) - 3;
    out.push(Math.max(20, Math.min(100, v)));
  }
  return out;
}

const DEMO_ROWS: DemoRow[] = Array.from({ length: 25 }, (_, i) => ({
  module: `module_${String(i + 1).padStart(2, "0")}`,
  score: 60 + ((i * 7) % 40),
  critical: (i * 3) % 11,
  high: (i * 5) % 17,
  records: 1_000 + ((i * 101) % 12_000),
  trend: randomTrend(i + 1),
}));

const DEMO_COLUMNS: DenseColumnDef<DemoRow>[] = [
  { accessorKey: "module", header: "Module" },
  {
    accessorKey: "score",
    header: "DQS",
    cell: ({ getValue }) => (getValue() as number).toFixed(1),
  },
  {
    accessorKey: "critical",
    header: "Critical",
    cell: ({ getValue }) => (
      <span className="text-[#DC2626] tabular-nums">{getValue() as number}</span>
    ),
  },
  {
    accessorKey: "high",
    header: "High",
    cell: ({ getValue }) => (
      <span className="text-[#EA580C] tabular-nums">{getValue() as number}</span>
    ),
  },
  {
    accessorKey: "records",
    header: "Records",
    cell: ({ getValue }) => (getValue() as number).toLocaleString(),
  },
  {
    accessorKey: "trend",
    header: "Drift",
    enableSorting: false,
    cell: ({ getValue }) => (
      <DriftSparkline data={getValue() as number[]} band={{ min: 70, max: 90 }} />
    ),
  },
];

export default function DesignPlaygroundPage() {
  const [severity, setSeverity] = useState<string[]>([]);
  const [modules, setModules] = useState<string[]>([]);

  const series = useMemo(
    () =>
      ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"].map(
        (dim, i) => ({
          key: dim,
          label: dim,
          data: randomTrend(i + 3, 14).map((y, x) => ({ x, y })),
          value: 80 + i,
          delta: i % 2 === 0 ? 1.2 : -0.8,
        }),
      ),
    [],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-foreground">Design playground</h1>
          <p className="text-sm text-muted-foreground">
            Unlinked smoke-test surface for phase-1 redesign primitives.{" "}
            <InfoHint>Exercise every primitive against mock data; do not ship mock data elsewhere.</InfoHint>
          </p>
        </div>
        <SavedView routeKey="design-playground" />
      </div>

      <FilterChipBar
        groups={[
          {
            key: "severity",
            label: "Severity",
            selected: severity,
            onChange: setSeverity,
            options: [
              { value: "critical", label: "Critical", count: 12 },
              { value: "high", label: "High", count: 43 },
              { value: "medium", label: "Medium", count: 128 },
              { value: "low", label: "Low", count: 512 },
            ],
          },
          {
            key: "modules",
            label: "Module",
            selected: modules,
            onChange: setModules,
            options: DEMO_ROWS.slice(0, 10).map((r) => ({ value: r.module, label: r.module })),
          },
        ]}
      />

      <KpiRail
        items={[
          { label: "DQS", value: "78.4", delta: 1.2, deltaLabel: " pts", spark: randomTrend(1), tone: "pos" },
          { label: "Critical", value: 12, delta: -4, deltaLabel: "", spark: randomTrend(2), tone: "pos" },
          { label: "High", value: 43, delta: 5, deltaLabel: "", spark: randomTrend(3), tone: "neg" },
          { label: "Systems", value: "7/7", spark: randomTrend(4) },
          { label: "LLM saved", value: "42%", delta: 3.1, spark: randomTrend(5), tone: "pos" },
          { label: "Runs (24h)", value: 3 },
        ]}
      />

      <NarrativeStrip
        headline="DQS up 1.2 pts vs last run — 12 new criticals concentrated on material_master."
        detail="94% of them are missing valuation_class — candidate for automated cleaning."
        tone="info"
        cta={{ label: "Triage", href: "/findings" }}
      />

      <div>
        <SectionHeader
          title="Small multiples"
          caption="6 DQS dimensions over the last 14 runs — shared y-axis"
        />
        <div className="mt-3">
          <SmallMultiplesChart series={series} normaliseY columns={6} />
        </div>
      </div>

      <div>
        <SectionHeader
          title="Dense data table"
          caption="Sortable, keyboard-nav, auto-virtualized above 500 rows"
        />
        <div className="mt-3">
          <DenseDataTable<DemoRow>
            data={DEMO_ROWS}
            columns={DEMO_COLUMNS}
            onRowClick={(r) => console.log("clicked", r.module)}
          />
        </div>
      </div>
    </div>
  );
}
