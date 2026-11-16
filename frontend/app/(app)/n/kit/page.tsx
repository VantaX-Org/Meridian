"use client";

/**
 * The kit gallery: every shared component once, with sample data, at /n/kit?fixture=1. Builders copy from here.
 * It is a developer page, so its sample copy is not translated (each literal line is marked i18n-ignore).
 */
import { useState, type ReactNode } from "react";
import {
  BarList, Button, Card, Chip, Confirm, DataTable, Field, Input, Search, Select, SeverityPill, SeverityStrip, Split, Stepper, Toggle, useAletheia, useSheet, useToast,
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
    </div>
  );
}
