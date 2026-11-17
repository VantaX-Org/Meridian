"use client";

/**
 * The kit gallery: every shared component once, with sample data, at /kit?fixture=1. Builders copy from here.
 * It is a developer page, so its sample copy is not translated (each literal line is marked i18n-ignore).
 */
import { useState, type ReactNode } from "react";
import {
  BarList, Badge, Button, Card, Chip, CodeView, CommentsPanel, Confirm, CycleStepper, DataTable, DiffView, Field, FileDrop, Graph, Hairline, Input, Search, Select, SeverityPill, SeverityStrip, Split, Stepper, Textarea, Timeline, Toggle, UndoToast, useAletheia, useSheet, useToast,
  type Column,
} from "@/ui/kit";
import { SHEETS } from "@/ui/sheets";

interface Row { id: string; rule: string; sev: "critical" | "high" | "medium" | "low"; records: number }
const ROWS: Row[] = Array.from({ length: 2000 }, (_, i) => ({ id: `R${i}`, rule: `Rule ${String(i).padStart(4, "0")}`, sev: (["critical", "high", "medium", "low"] as const)[i % 4], records: (i * 37) % 900 })); // i18n-ignore
const COLS: Column<Row>[] = [
  { key: "rule", label: "Rule", sort: (r) => r.rule }, // i18n-ignore
  { key: "sev", label: "Severity", render: (r) => <SeverityPill sev={r.sev} label={r.sev} />, sort: (r) => r.sev },
  { key: "records", label: "Records", align: "end", sort: (r) => r.records }, // i18n-ignore
];

function Block({ name, children }: { name: string; children: ReactNode }) {
  return <Card title={name}>{children}</Card>; // i18n-ignore
}

export default function KitGallery() {
  const toast = useToast();
  const sheet = useSheet();
  const chat = useAletheia();
  const [sel, setSel] = useState<string | null>("R3");
  const [q, setQ] = useState("");
  const [chip, setChip] = useState(true);
  const [on, setOn] = useState(false);
  const [ask, setAsk] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [notes, setNotes] = useState([{ id: "n1", body: "Checked with the plant team.", author: "Ana", when: "Today" }]); // i18n-ignore
  SHEETS.demo ??= { label: "Demo sheet", render: (a) => <p>Opened with {String(a)}</p> }; // i18n-ignore
  return (
    <div className="mx-kit-gallery">
      <h2>Kit gallery</h2>{/* i18n-ignore */}
      <Block name="Split">
        <Split leftLabel="Left" rightLabel="Right" left={<p>Left column</p>} right={<p>Right column</p>} />{/* i18n-ignore */}
      </Block>
      <Block name="SeverityPill and SeverityStrip">
        <div className="mx-chips">{(["critical", "high", "medium", "low", "info"] as const).map((s) => <SeverityPill key={s} sev={s} label={s} />)}</div>
        <SeverityStrip rulesLabel={(n) => `${n} rules`} tiles={[{ sev: "critical", label: "Critical", rules: 2, records: "120 records" }, { sev: "high", label: "High", rules: 5, records: "800 records" }, { sev: "medium", label: "Medium", rules: 9, records: "3k records" }, { sev: "low", label: "Low", rules: 4, records: "40 records" }]} />{/* i18n-ignore */}
      </Block>
      <Block name="BarList">
        <BarList label="Records by rule" items={[{ id: "a", label: "Missing base unit", value: 800, display: "800", sev: "high" }, { id: "b", label: "Duplicate description", value: 420, display: "420", sev: "medium" }, { id: "c", label: "No plant data", value: 120, display: "120", sev: "critical" }]} />{/* i18n-ignore */}
      </Block>
      <Block name="DataTable (2,000 rows, virtualised, sort, select, arrow keys)">
        <DataTable columns={COLS} rows={ROWS} rowKey={(r) => r.id} label="Rules" selected={sel} onSelect={(r) => setSel(r.id)} />{/* i18n-ignore */}
      </Block>
      <Block name="Stepper">
        <Stepper label="Clean cycle" current={1} steps={[{ id: "1", label: "Pull" }, { id: "2", label: "Clean" }, { id: "3", label: "Upload" }, { id: "4", label: "Rescore" }]} />{/* i18n-ignore */}
      </Block>
      <Block name="Chip, Search">
        <div className="mx-chips"><Chip selected={chip} count={12} onClick={() => setChip(!chip)}>Failing</Chip><Chip selected={!chip} onClick={() => setChip(!chip)}>Passing</Chip></div>{/* i18n-ignore */}
        <Search value={q} onChange={setQ} label="Search rules" clearLabel="Clear" placeholder="Search rules" />{/* i18n-ignore */}
      </Block>
      <Block name="Field, Input, Select, Toggle">
        <Field label="Name" hint="Shown in lists"><Input placeholder="Material master" /></Field>{/* i18n-ignore */}
        <Field label="Plant" error="Plant is required"><Input aria-invalid="true" /></Field>{/* i18n-ignore */}
        <Field label="System"><Select options={[{ value: "ecc", label: "ECC production" }, { value: "s4", label: "S/4 sandbox" }]} /></Field>{/* i18n-ignore */}
        <Toggle label="Clean automatically" checked={on} onChange={setOn} />{/* i18n-ignore */}
      </Block>
      <Block name="Toast, SheetHost, Confirm, Aletheia">
        <div className="mx-chips">
          <Button variant="secondary" onClick={() => toast("Saved", "good")}>Show toast</Button>{/* i18n-ignore */}
          <Button variant="secondary" onClick={() => sheet.open("demo", "R3")}>Open sheet</Button>{/* i18n-ignore */}
          <Button variant="secondary" onClick={() => setAsk(true)}>Confirm</Button>{/* i18n-ignore */}
          <Button variant="secondary" tone="aletheia" onClick={() => chat.setOpen(true)}>Open Aletheia</Button>{/* i18n-ignore */}
        </div>
        <p className="mx-muted">Press Ctrl+K or Cmd+K for the command palette.</p>{/* i18n-ignore */}
        <Confirm open={ask} title="Delete this run?" confirmLabel="Delete" cancelLabel="Keep" danger onConfirm={() => { setAsk(false); toast("Deleted", "bad"); }} onCancel={() => setAsk(false)}>{/* i18n-ignore */}
          <p>This cannot be undone.</p>{/* i18n-ignore */}
        </Confirm>
      </Block>
      <Block name="Badge, Textarea, FileDrop, UndoToast">
        <p>Tab count <Badge>12</Badge> <Badge tone="good">Passing</Badge> <Badge tone="bad">3</Badge></p>{/* i18n-ignore */}
        <Textarea aria-label="Notes" rows={3} placeholder="Write a note" />{/* i18n-ignore */}
        <FileDrop accept=".xlsx,.csv" onFile={setFile} label="Cleaned file" status={file ? file.name : "Drop the Excel file you cleaned."} />{/* i18n-ignore */}
        <UndoToast message="The record was changed." actionLabel="Undo" onAction={() => toast("Undone", "good")} />{/* i18n-ignore */}
      </Block>
      <Block name="CodeView, DiffView, Timeline, Hairline">
        <CodeView label="Rule definition" text={"id: MM-001\nseverity: high"} />{/* i18n-ignore */}
        <DiffView label="Changes" diff={"  id: MM-001\n- severity: high\n+ severity: critical"} />{/* i18n-ignore */}
        <Timeline label="History" events={[{ id: "a", at: "1 Nov", title: "Run started" }, { id: "b", at: "2 Nov", title: "Run done", note: "DQS 82" }]} />{/* i18n-ignore */}
        <Hairline label="Jobs" items={[{ id: "j1", label: "Material run", meta: "40%", pct: 40 }, { id: "j2", label: "Customer run", meta: "Working", pct: null }]} />{/* i18n-ignore */}
      </Block>
      <Block name="Graph, CycleStepper, CommentsPanel">
        <Graph layout="columns" label="Lineage" nodes={[{ id: "a", label: "MARA", column: 0, emphasis: true }, { id: "b", label: "MARC", column: 1 }]} edges={[{ id: "e", source: "a", target: "b" }]} />{/* i18n-ignore */}
        <Graph layout="circle" label="Cluster" nodes={[{ id: "a", label: "A", emphasis: true }, { id: "b", label: "B" }, { id: "c", label: "C" }]} edges={[{ id: "e1", source: "a", target: "b", label: "92%", tone: "good" }, { id: "e2", source: "b", target: "c", label: "40%", tone: "bad", dashed: true }]} onPick={(e) => toast(e.id)} />{/* i18n-ignore */}
        <CycleStepper label="Clean cycle" step="clean" labels={{ pull: "Pull", clean: "Clean", upload: "Upload", score: "Score", compare: "Compare" }} />{/* i18n-ignore */}
        <CommentsPanel listLabel="Notes" deleteLabel="Delete" items={notes.map((n) => ({ ...n, onDelete: () => setNotes((x) => x.filter((y) => y.id !== n.id)) }))} empty={<p className="mx-muted">No notes yet.</p>} composer={{ label: "New note", submitLabel: "Add note", onSubmit: (t) => setNotes((x) => [...x, { id: String(x.length + 1) + t, body: t, author: "You", when: "Now" }]) }} />{/* i18n-ignore */}
        <DataTable label="Expandable rows" height={160} rows={ROWS.slice(0, 20)} columns={COLS} rowKey={(r) => r.id} selected={open} onSelect={(r) => setOpen(open === r.id ? null : r.id)} expand={{ id: open, height: 60, render: (r) => <p>Detail for {r.rule}</p> }} />{/* i18n-ignore */}
      </Block>
    </div>
  );
}
