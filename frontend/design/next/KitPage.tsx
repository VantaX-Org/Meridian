"use client";

import { useState } from "react";
import { t } from "@/lib/v2/i18n";
import {
  Button, Chip, Code, CommandPalette, Confirm, DataTable, DropZone, EmptyState, ErrorState, ProgressBar, RunSwitcher,
  CheckList, Composer, FeedCard, LargeTitle, ObjectSegments, Toolbar,
  SegmentedControl, SidePanel, Skeleton, StatCard, Stepper, Tabs, useToast,
  type Column, type RunOption, type StepItem,
} from "./kit";

type Theme = "light" | "dark";
type Mat = { code: string; text: string; plant: string; records: number; dqs: number };

const MATS: Mat[] = [
  { code: "100-200", text: "Hydraulic hose, 2 in", plant: "1000", records: 1840, dqs: 92 }, // i18n-ignore
  { code: "100-310", text: "Bearing, tapered roller", plant: "1000", records: 640, dqs: 71 }, // i18n-ignore
  { code: "200-044", text: "Filter element, fuel", plant: "2000", records: 2210, dqs: 84 }, // i18n-ignore
  { code: "300-901", text: "Seal kit, boom cylinder", plant: "2000", records: 95, dqs: 58 }, // i18n-ignore
];
const RUNS: RunOption[] = [
  { id: "r15", number: 15, status: "done", kind: "Cleaned", parentNumber: 14, dateLabel: "11 Nov", dqs: "88.4", chips: [{ tone: "resolved", count: 312, label: "resolved" }, { tone: "new", count: 12, label: "new" }, { tone: "regressed", count: 3, label: "regressed" }] }, // i18n-ignore
  { id: "r14", number: 14, status: "done", kind: "Extracted", dateLabel: "9 Nov", dqs: "81.0" }, // i18n-ignore
  { id: "r13", number: 13, status: "failed", kind: "Extracted", dateLabel: "2 Nov" }, // i18n-ignore
  { id: "r12", number: 12, status: "running", kind: "Cleaned", parentNumber: 11, dateLabel: "1 Nov" }, // i18n-ignore
];
const STEPS: StepItem[] = [
  { id: "connect", label: "Connect", state: "done", detail: "Connected 9 Nov" }, // i18n-ignore
  { id: "pull", label: "Pull", state: "done", detail: "184,220 records" }, // i18n-ignore
  { id: "clean", label: "Clean", state: "current" }, // i18n-ignore
  { id: "check", label: "Check", state: "running", detail: "42 percent" }, // i18n-ignore
  { id: "load", label: "Load", state: "failed", detail: "Target refused the file" }, // i18n-ignore
];
const FUTURE: StepItem[] = [{ id: "later", label: "Later", state: "future" }]; // i18n-ignore

const COLS: Column<Mat>[] = [
  { id: "code", label: "Material", cell: (r) => <Code code={r.code} text={r.text} />, compare: (a, b) => a.code.localeCompare(b.code) }, // i18n-ignore
  { id: "plant", label: "Plant", cell: (r) => <Code code={r.plant} />, hidden: true }, // i18n-ignore
  { id: "records", label: "Records", cell: (r) => r.records.toLocaleString("en"), compare: (a, b) => a.records - b.records, align: "end" }, // i18n-ignore
  { id: "dqs", label: "DQS", cell: (r) => r.dqs, compare: (a, b) => a.dqs - b.dqs, align: "end" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="nx-kit-sec">
      <h2 className="nx-kit-h2">{title}</h2>
      {children}
    </section>
  );
}

const CHECKS = [
  { code: "marker", level: "pass" as const, text: "The file belongs to this object and run." }, // i18n-ignore
  { code: "rows", level: "warn" as const, text: "12 rows are new and will be added.", fix: { label: "See the rows", href: "#rows" } }, // i18n-ignore
  { code: "cols", level: "block" as const, text: "Column Plant is missing.", fix: { label: "Download the template", href: "#template" } }, // i18n-ignore
];
const OBJS = [{ id: "mm", label: "Material master" }, { id: "cu", label: "Customer master" }]; // i18n-ignore
const VERS = [{ id: "v1", label: "Version 1" }, { id: "v2", label: "Version 2" }]; // i18n-ignore

function ContentKit() {
  const toast = useToast();
  const [v, setV] = useState({ object: "mm", version: "v2", run: "r15" });
  return (
    <>
      <Section title={t("LargeTitle and Toolbar")}>
        <div data-title-scope>
          <Toolbar title="Material master" actions={[{ id: "a", label: t("Download"), onClick: () => undefined }, { id: "b", label: t("Share"), onClick: () => undefined }, { id: "c", label: t("Compare"), onClick: () => undefined }, { id: "d", label: t("Export"), onClick: () => undefined }]} /> {/* i18n-ignore */}
          <LargeTitle title="Material master" subtitle="184,220 records in 14 runs" primary={{ label: t("Start a cycle"), onClick: () => undefined }} /> {/* i18n-ignore */}
        </div>
      </Section>
      <Section title={t("ObjectSegments")}>
        <ObjectSegments objects={OBJS} versions={VERS} runs={RUNS} value={v} onChange={setV} />
      </Section>
      <Section title={t("FeedCard")}>
        <FeedCard tone="warn" title="Seal kit, boom cylinder" reason="Its score fell 6 points since run 14." meta={[{ label: "Score", value: "58" }, { label: "Records", value: "95" }]} href="#card" actions={[{ label: t("Open"), onClick: () => undefined, primary: true }]} /> {/* i18n-ignore */}
      </Section>
      <Section title={t("Composer")}>
        <Composer label={t("Note")} placeholder={t("Add a note for the steward")} submitLabel={t("Send")} doneText={t("Note sent")} onSubmit={() => toast({ text: t("Sent") })} />
      </Section>
      <Section title={t("CheckList")}>
        <CheckList checks={CHECKS} />
      </Section>
    </>
  );
}

function Showcase() {
  const toast = useToast();
  const [run, setRun] = useState("r15");
  const [tab, setTab] = useState("overview");
  const [seg, setSeg] = useState("table");
  const [panel, setPanel] = useState(false);
  const [confirm, setConfirm] = useState<"plain" | "live" | null>(null);
  const [palette, setPalette] = useState(false);
  const [stat, setStat] = useState(184220);

  return (
    <>
      <Section title={t("Button")}>
        <div className="nx-kit-row">
          <Button variant="primary">{t("Primary")}</Button>
          <Button variant="secondary">{t("Secondary")}</Button>
          <Button variant="quiet">{t("Quiet")}</Button>
          <Button variant="danger">{t("Danger")}</Button>
        </div>
        <div className="nx-kit-row">
          <Button variant="primary" size={32}>{t("Small")}</Button>
          <Button variant="primary" loading>{t("Saving")}</Button>
          <Button variant="secondary" disabled reason={t("Pick a run first")}>{t("Disabled")}</Button>
        </div>
      </Section>
      <Section title={t("Chip")}>
        <div className="nx-kit-row">
          <Chip>{t("Neutral")}</Chip>
          <Chip tone="accent">{t("Accent")}</Chip>
          <Chip tone="new" count={12}>{t("new")}</Chip>
          <Chip tone="resolved" count={312}>{t("resolved")}</Chip>
          <Chip tone="regressed" count={3}>{t("regressed")}</Chip>
          <Chip tone="warn">{t("Warning")}</Chip>
          <Chip tone="bad">{t("Failed")}</Chip>
          <Chip tone="aletheia">{t("Aletheia")}</Chip>
          <Chip onClick={() => undefined} pressed>{t("Filter on")}</Chip>
        </div>
      </Section>
      <Section title={t("StatCard")}>
        <div className="nx-kit-grid">
          <StatCard label={t("Records")} value={stat} delta={{ value: 1204, tone: "good", against: t("since run 14") }} spark={[3, 4, 4, 6, 5, 8, 9]} />
          <StatCard label={t("Open issues")} value={4210} delta={{ value: -312, tone: "good", against: t("since run 14") }} />
          <StatCard label={t("Regressions")} value={3} delta={{ value: 3, tone: "bad" }} />
        </div>
        <div className="nx-kit-row"><Button variant="quiet" size={32} onClick={() => setStat((s) => s + 5000)}>{t("Change the number")}</Button></div>
      </Section>
      <Section title={t("Stepper")}>
        <Stepper label={t("Migration steps")} steps={[...STEPS, ...FUTURE]} onSelect={() => undefined} />
        <Stepper label={t("Migration steps, vertical")} orientation="vertical" steps={STEPS.slice(0, 3)} />
      </Section>
      <Section title={t("RunSwitcher")}>
        <RunSwitcher runs={RUNS} value={run} onChange={setRun} onCompare={() => toast({ text: t("Comparison opens here") })} />
      </Section>
      <Section title={t("DataTable")}>
        <DataTable rows={MATS} columns={COLS} rowKey={(r) => r.code} rowLabel={(r) => t("material {code}", { code: r.code })} caption={t("Materials in run 15")} total={184220} selectable onOpenRow={() => setPanel(true)} bulkActions={(keys) => <Button size={32} variant="secondary" onClick={() => toast({ text: t("{n} queued", { n: keys.length }) })}>{t("Queue fixes")}</Button>} />
        <DataTable rows={[]} columns={COLS} rowKey={(r) => r.code} rowLabel={(r) => r.code} caption={t("Empty table")} empty={{ heading: t("No materials in this run"), text: t("Pull data to fill this table.") }} />
        <DataTable rows={[]} columns={COLS} rowKey={(r) => r.code} rowLabel={(r) => r.code} caption={t("Failed table")} error={{ sentence: t("The system did not answer. Try again."), onRetry: () => undefined }} />
        <DataTable rows={[]} columns={COLS} rowKey={(r) => r.code} rowLabel={(r) => r.code} caption={t("Loading table")} loading />
      </Section>
      <Section title={t("SidePanel, Confirm, Toast, CommandPalette")}>
        <div className="nx-kit-row">
          <Button onClick={() => setPanel(true)}>{t("Open panel")}</Button>
          <Button onClick={() => setConfirm("plain")}>{t("Ask to confirm")}</Button>
          <Button variant="danger" onClick={() => setConfirm("live")}>{t("Write to live system")}</Button>
          <Button onClick={() => toast({ text: t("Run 15 saved"), tone: "good" })}>{t("Show toast")}</Button>
          <Button onClick={() => toast({ text: t("12 fixes discarded"), onUndo: () => toast({ text: t("Restored") }) })}>{t("Toast with Undo")}</Button>
          <Button onClick={() => setPalette(true)} icon="command">{t("Command palette")}</Button>
        </div>
        <SidePanel open={panel} onClose={() => setPanel(false)} title={t("Material 100-200")} footer={<Button variant="primary" onClick={() => setPanel(false)}>{t("Done")}</Button>}>
          <p>{t("Details of the row open here. The page behind stays usable.")}</p>
        </SidePanel>
        <Confirm open={confirm === "plain"} title={t("Discard 12 fixes?")} consequence={t("12 fixes in run 15 are removed. You can undo this for 6 seconds.")} confirmLabel={t("Discard")} danger onCancel={() => setConfirm(null)} onConfirm={() => setConfirm(null)} />
        {/* i18n-ignore */}
        <Confirm open={confirm === "live"} title={t("Write to the live system?")} consequence={t("This writes 4,210 records to the live system.")} confirmLabel={t("Write 4,210 records")} danger phrase="WRITE LIVE" onCancel={() => setConfirm(null)} onConfirm={() => setConfirm(null)} />
        <CommandPalette open={palette} onClose={() => setPalette(false)} groups={[
          { id: "go", label: t("Go to"), items: [{ id: "runs", label: t("Runs"), run: () => undefined }, { id: "rules", label: t("Rules"), hint: "G R", run: () => undefined }] },
          { id: "do", label: t("Do"), items: [{ id: "pull", label: t("Pull data"), run: () => undefined }] },
        ]} />
      </Section>
      <Section title={t("EmptyState, ErrorState, Skeleton")}>
        <EmptyState heading={t("No runs yet")} action={<Button variant="primary">{t("Pull data")}</Button>}>{t("A run is one pull from your system.")}</EmptyState>
        <ErrorState sentence={t("The system did not answer. Try again.")} onRetry={() => undefined} />
        <Skeleton lines={3} />
      </Section>
      <Section title={t("Tabs, SegmentedControl")}>
        <Tabs label={t("Sections")} value={tab} onChange={setTab} items={[{ id: "overview", label: t("Overview") }, { id: "issues", label: t("Issues"), badge: "12" }, { id: "history", label: t("History") }]} />
        <SegmentedControl label={t("View")} value={seg} onChange={setSeg} items={[{ value: "table", label: t("Table") }, { value: "chart", label: t("Chart") }]} />
      </Section>
      <Section title={t("Code")}>
        <div className="nx-kit-row"><Code code="MM-0042" text={t("Base unit of measure is missing")} /><Code code="1000" text={t("Plant North")} /></div>
      </Section>
      <Section title={t("DropZone")}>
        <DropZone onFiles={(f) => toast({ text: t("{n} file received", { n: f.length }) })} hint={t("Excel workbook, .xlsx, up to 50 MB")} accept=".xlsx" />
      </Section>
      <Section title={t("ProgressBar")}>
        <ProgressBar label={t("Pulling records")} value={42} text={t("Pulled 77,000 of 184,220 records")} />
        <ProgressBar label={t("Checking")} text={t("Waiting for the system to answer")} />
      </Section>
      <ContentKit />
    </>
  );
}

export function KitPage() {
  const [show, setShow] = useState<"both" | Theme>("both");
  const themes: Theme[] = show === "both" ? ["light", "dark"] : [show];
  return (
    <main className="nx-kit">
      <header className="nx-kit-head">
        <h1 className="nx-kit-h1">{t("Kit")}</h1>
        <SegmentedControl label={t("Theme")} value={show} onChange={setShow} items={[{ value: "both", label: t("Both") }, { value: "light", label: t("Light") }, { value: "dark", label: t("Dark") }]} />
      </header>
      <div className="nx-kit-panes">
        {themes.map((th) => (
          <div key={th} className="nx-root nx-kit-pane" data-nx-theme={th} data-testid={`pane-${th}`}>
            <Showcase />
          </div>
        ))}
      </div>
    </main>
  );
}
