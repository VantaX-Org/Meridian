"use client";

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Bar, Button, Card, DataTable, Dialog, Drawer, EmptyState, ErrorState, Field, Heatmap, InsightHeader, Input, Line, Notice, PageHeader, Radar, Select, Sparkline, Tabs, Waterfall,
  type ChartPoint } from "@/design";

const SERIES: ChartPoint[] = [
  { x: "W1", y: 72 }, { x: "W2", y: 76 }, { x: "W3", y: 74 }, { x: "W4", y: 81 }, { x: "W5", y: 85 },
];
const STEPS: ChartPoint[] = [
  { x: "Start", y: 100, total: true }, { x: "Dupes", y: -12 }, { x: "Gaps", y: -8 }, { x: "End", y: 80, total: true },
];

interface DemoRow { id: string; object: string; owner: string }
const ROWS: DemoRow[] = [
  { id: "1", object: "Material", owner: "Stewards" }, { id: "2", object: "Vendor", owner: "Finance" }, { id: "3", object: "Customer", owner: "Sales" },
];
const COLS: ColumnDef<DemoRow, unknown>[] = [
  { id: "object", header: "Object", cell: ({ row }) => row.original.object },
  { id: "owner", header: "Owner", cell: ({ row }) => row.original.owner },
];

/** Gallery body for the composite primitives, overlays and charts. Client-side because overlays hold state. */
export function GalleryMore() {
  const [sel, setSel] = useState("a");
  const [dialog, setDialog] = useState(false);
  const [drawer, setDrawer] = useState(false);
  return (
    <>
      <Card title="Page header" padding="sm">
        <PageHeader title="Page title" meta="One line of context" actions={<Button variant="secondary">Action</Button>} />
      </Card>
      <Card title="Insight header" padding="sm">
        <InsightHeader
          situation={{ sentence: "Quality is 81, up from 72 over five weeks", tone: "go" }}
          changed={{ sentence: "Duplicates fell by 12" }}
          why={{ sentence: "Two sources were merged" }}
          next={{ sentence: "Review the 8 remaining gaps", action: { label: "Open gaps" } }}
        />
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Card" meta="meta">Card body.</Card>
        <Card title="Critical card" tone="critical">Card with a critical edge.</Card>
      </div>
      <Card title="Notices" padding="sm">
        <div className="flex flex-col gap-2">
          <Notice tone="info" title="Info">Neutral notice.</Notice>
          <Notice tone="success">Success notice.</Notice>
          <Notice tone="warning">Warning notice.</Notice>
          <Notice tone="danger" title="Danger">Danger notice.</Notice>
        </div>
      </Card>
      <Card title="Tabs">
        <Tabs items={[
          { value: "one", label: "One", content: <p>First panel.</p> },
          { value: "two", label: "Two", count: 4, content: <p>Second panel.</p> },
        ]} />
      </Card>
      <Card title="Fields and overlays">
        <div className="flex flex-wrap gap-4 items-end">
          <Field label="Field"><Input defaultValue="Value" /></Field>
          <Select label="Sample option" value={sel} onValueChange={setSel} options={[{ value: "a", label: "Option A" }, { value: "b", label: "Option B" }]} />
          <Button variant="secondary" onClick={() => setDialog(true)}>Open dialog</Button>
          <Button variant="secondary" onClick={() => setDrawer(true)}>Open drawer</Button>
        </div>
      </Card>
      {dialog && <Dialog open onOpenChange={setDialog} title="Dialog">Dialog body.</Dialog>}
      {drawer && <Drawer open onOpenChange={setDrawer} title="Drawer">Drawer body.</Drawer>}
      <Card title="Data table" meta="Tab to the table, arrow keys move between rows, Enter opens" padding="sm">
        <DataTable columns={COLS} data={ROWS} getRowId={(r) => r.id} onRowClick={() => {}} height="auto" />
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Empty state with action" padding="sm">
          <EmptyState title="Nothing here yet" detail="Designed fresh-install sentence." ghost="grid" action={<Button>Add the first one</Button>} />
        </Card>
        <Card title="Error state" padding="sm">
          <ErrorState message="The request failed" onRetry={() => {}} />
        </Card>
      </div>
      <Card title="Charts">
        <div className="grid gap-4 md:grid-cols-2">
          <Line data={SERIES} height={160} label="Line" />
          <Bar data={SERIES} height={160} label="Bar" />
          <Waterfall data={STEPS} label="Waterfall" />
          <Radar data={SERIES} label="Radar" />
          <Heatmap rows={["A", "B"]} cols={["x", "y"]} cells={[{ row: "A", col: "x", value: "go" }, { row: "B", col: "y", value: "no-go" }]} />
          <Sparkline data={SERIES} />
        </div>
      </Card>
    </>
  );
}
