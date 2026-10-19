"use client";

import { useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import {
  Bar, Button, Card, DataTable, Dialog, Drawer, EmptyState, ErrorState, Field, Heatmap, ICONS, InsightHeader, Input, Line, Notice, ObjectMap, PageHeader, Radar, Rule, Score, Select, Sparkline, Tabs, Waterfall,
  type ChartPoint, type ObjectMapItem } from "@/design";

const SERIES: ChartPoint[] = [
  { x: "W1", y: 72 }, { x: "W2", y: 76 }, { x: "W3", y: 74 }, { x: "W4", y: 81 }, { x: "W5", y: 85 },
];
const STEPS: ChartPoint[] = [
  { x: "Start", y: 100, total: true }, { x: "Dupes", y: -12 }, { x: "Gaps", y: -8 }, { x: "End", y: 80, total: true },
];

const OBJECTS: ObjectMapItem[] = [
  { id: "bp", label: "Business partner", score: 91.2, records: 100000, verdict: "go", meta: "100,000 records" },
  { id: "mm", label: "Material master", score: 68.4, records: 25000, verdict: "no-go", meta: "MM045, 4,210 records" },
  { id: "ap", label: "Accounts payable", score: 82.7, records: 18000, verdict: "at-risk", meta: "AP012, 1,930 records" },
  { id: "ar", label: "Accounts receivable", score: 88.1, records: 12000, verdict: "at-risk" },
  { id: "gl", label: "FI general ledger", score: 94.6, records: 9000, verdict: "go" },
  { id: "fa", label: "Asset accounting", score: 90.3, records: 4000, verdict: "go" },
  { id: "pm", label: "Plant maintenance", score: 57.9, records: 2500, verdict: "no-go" },
  { id: "qm", label: "Quality management", score: null, records: 800, verdict: "neutral" },
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
      <Card title="Icons" meta={`${Object.keys(ICONS).length} glyphs on one 24 grid, one 1.6 stroke, currentColor`} padding="sm">
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(84px,1fr))] gap-1">
          {Object.entries(ICONS).map(([name, Icon]) => (
            <li key={name} className="m-ink-2 flex flex-col items-center gap-1.5 py-3">
              <Icon size={20} />
              <span className="m-text-micro m-ink-3">{name}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="The Rule" meta="One instrument for every score: hero, row and inline share one geometry">
        <div className="flex flex-col gap-6">
          <Score size="hero" value={71.7} cap={70} criticals={6} versionId="gallery" />
          <div className="flex flex-wrap items-center gap-6">
            <span className="inline-flex items-center gap-2"><Rule size="row" value={92.4} /><span className="m-numeric">92.4</span></span>
            <span className="inline-flex items-center gap-2"><Rule size="row" value={64.3} /><span className="m-numeric">64.3</span></span>
            <span className="inline-flex items-center gap-2"><Rule size="row" value={82} cap={70} /><span className="m-numeric">82.0</span></span>
            <Score size="sm" value={55.1} />
            <Score size="sm" value={95} />
          </div>
        </div>
      </Card>
      <Card title="Object map" meta="Area is records, tint is the verdict">
        <ObjectMap items={OBJECTS} columns={6} rowHeight={56} />
      </Card>
      <Card title="Index bar" meta="The shell is two rows">
        <ul className="m-text-body m-ink-2 flex flex-col gap-1">
          <li>The index bar is one row: the brand, the places a person goes as pills with live counts, More for every other page, and search, notifications, help and the user on the right.</li>
          <li>The scope bar under it carries the page title and the scope the page publishes.</li>
          <li>A page is one column: the figure first, the ledger of what moves it second, the one action that follows.</li>
        </ul>
      </Card>
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
