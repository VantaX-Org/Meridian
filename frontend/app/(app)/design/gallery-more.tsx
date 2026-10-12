"use client";

import { useState } from "react";
import {
  Bar, Button, Card, Dialog, Drawer, EmptyState, ErrorState, Field, Heatmap, Line, Notice, Radar, Select, Sparkline, Tabs, Waterfall,
  type ChartPoint, Input } from "@/design";

const SERIES: ChartPoint[] = [
  { x: "W1", y: 72 }, { x: "W2", y: 76 }, { x: "W3", y: 74 }, { x: "W4", y: 81 }, { x: "W5", y: 85 },
];
const STEPS: ChartPoint[] = [
  { x: "Start", y: 100, total: true }, { x: "Dupes", y: -12 }, { x: "Gaps", y: -8 }, { x: "End", y: 80, total: true },
];

/** Gallery body for the composite primitives, overlays and charts. Client-side because overlays hold state. */
export function GalleryMore() {
  const [sel, setSel] = useState("a");
  const [dialog, setDialog] = useState(false);
  const [drawer, setDrawer] = useState(false);
  return (
    <>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Card" meta="meta">Card body.</Card>
        <Card title="Critical card" tone="critical">Card with a critical edge.</Card>
      </div>
      <div className="flex flex-col gap-2">
        <Notice tone="info" title="Info">Neutral notice.</Notice>
        <Notice tone="success">Success notice.</Notice>
        <Notice tone="warning">Warning notice.</Notice>
        <Notice tone="danger" title="Danger">Danger notice.</Notice>
      </div>
      <Tabs items={[
        { value: "one", label: "One", content: <p>First panel.</p> },
        { value: "two", label: "Two", count: 4, content: <p>Second panel.</p> },
      ]} />
      <div className="flex flex-wrap gap-4 items-end">
        <Field label="Field"><Input defaultValue="Value" /></Field>
        <Select label="Sample option" value={sel} onValueChange={setSel} options={[{ value: "a", label: "Option A" }, { value: "b", label: "Option B" }]} />
        <Button variant="secondary" onClick={() => setDialog(true)}>Open dialog</Button>
        <Button variant="secondary" onClick={() => setDrawer(true)}>Open drawer</Button>
      </div>
      {dialog && <Dialog open onOpenChange={setDialog} title="Dialog">Dialog body.</Dialog>}
      {drawer && <Drawer open onOpenChange={setDrawer} title="Drawer">Drawer body.</Drawer>}
      <div className="grid gap-4 md:grid-cols-2">
        <EmptyState title="Nothing here yet." detail="Designed fresh-install sentence." ghost="grid" />
        <ErrorState message="The request failed." />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Line data={SERIES} height={160} label="Line" />
        <Bar data={SERIES} height={160} label="Bar" />
        <Waterfall data={STEPS} label="Waterfall" />
        <Radar data={SERIES} label="Radar" />
        <Heatmap rows={["A", "B"]} cols={["x", "y"]} cells={[{ row: "A", col: "x", value: "go" }, { row: "B", col: "y", value: "no-go" }]} />
        <Sparkline data={SERIES} />
      </div>
    </>
  );
}
