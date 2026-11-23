"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { fixtureActive, useFixture, withFixture } from "@/lib/api/v2/fixture";
import { t } from "@/lib/v2/i18n";
import { moduleText } from "@/lib/v2/labels";
import { getSystemsExtended } from "@/lib/api/v2/runs";
import { getSystemObjects } from "@/lib/api/system-objects";
import { startRun, useRunsPage } from "@/lib/api/next/runs";
import { FIXTURE_MODULES } from "@/lib/api/next/runs-fixture";
import { checkCleaned, checksOf, needsParent, uploadCleaned, uploadSentence } from "@/lib/api/v2/roundtrip";
import { validationOf } from "@/lib/api/v2/upload-checks";
import { getRunExtractTarget, openExtractTargetFile, refillExtractTarget } from "@/lib/api/v2/extract-target";
import { Button, Chip, DataTable, EmptyState, Field, Select, Skeleton, Toggle, useSheet, useToast, type Column, type SheetDef, ExportMenu, ImportSheet } from "@/ui/kit";
import { runPath, runTitle } from "./util";
import "./runs.css";


function Cycle() {
  const fx = useFixture();
  const router = useRouter();
  const toast = useToast();
  const sheet = useSheet();
  const systems = useQuery({ queryKey: ["next", "sheet", "systems", fx], queryFn: getSystemsExtended });
  const [sys, setSys] = useState("");
  const system = sys || systems.data?.[0]?.id || "";
  const objs = useQuery({
    queryKey: ["next", "sheet", "objects", system, fx],
    queryFn: async () => (fixtureActive() ? [...FIXTURE_MODULES] : (await getSystemObjects(system)).objects.filter((o) => o.licensed !== false).map((o) => o.object)),
    enabled: !!system,
  });
  const [picked, setPicked] = useState<string[]>([]);
  const [analyse, setAnalyse] = useState(true);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await startRun(system, { objects: picked, scope: {}, analyse }); toast(t("Run started"), "good"); sheet.close(); router.push(withFixture("/runs?view=jobs", fx)); }
    catch { toast(t("The run could not start."), "bad"); } finally { setBusy(false); }
  };
  if (systems.isLoading) return <Skeleton lines={4} label={t("Loading the systems")} />;
  if (!systems.data?.length) return <EmptyState heading={t("No system connected")} body={t("Connect a system first.")} />;
  return (
    <div className="rn-stack">
      <Field label={t("System")}><Select value={system} onChange={(e) => { setSys(e.target.value); setPicked([]); }} options={systems.data.map((s) => ({ value: s.id, label: s.name }))} /></Field>
      <Field label={t("Objects to pull")}>
        <div className="rn-filters">{(objs.data ?? []).map((o) => <Chip key={o} selected={picked.includes(o)} onClick={() => setPicked((p) => (p.includes(o) ? p.filter((x) => x !== o) : [...p, o]))}>{moduleText(o)}</Chip>)}</div>
      </Field>
      <Toggle label={t("Score the data when the pull ends")} checked={analyse} onChange={setAnalyse} />
      <Button disabled={!picked.length || busy} onClick={go}>{t("Start the run")}</Button>
    </div>
  );
}

function Upload({ arg }: { arg: unknown }) {
  const a = (arg ?? {}) as { run?: string; module?: string };
  const qc = useQueryClient();
  const sheet = useSheet();
  const fx = useFixture();
  const router = useRouter();
  return (
    <ImportSheet accept=".xlsx,.csv" fileLabel={t("Cleaned file")} hint={t("Drop the Excel file you cleaned.")} target={t("PROD")}
      onDirty={sheet.guard}
      validate={async (f) => {
        try { return validationOf(await checkCleaned(f, a.run, a.module)); }
        catch (e) {
          const c = checksOf(e);
          if (c) return validationOf(c);
          throw new Error(needsParent(e) && !a.run ? t("The file does not say which run it came from. Open this sheet from a run.") : uploadSentence(e, t("The file could not be checked.")));
        }
      }}
      apply={async (f, v) => {
        const r = await uploadCleaned(f, a.run, a.module, (v?.warnings ?? 0) > 0);
        qc.invalidateQueries({ queryKey: ["next"] });
        sheet.close();
        router.push(withFixture(runPath(r.version_id), fx));
        return t("Uploaded. {n} values changed.", { n: r.applied });
      }} />
  );
}

function Compare({ arg }: { arg: unknown }) {
  const a = ((arg ?? {}) as { run?: string }).run ?? "";
  const fx = useFixture();
  const router = useRouter();
  const sheet = useSheet();
  const runs = useRunsPage({ limit: 50 });
  const [b, setB] = useState("");
  const list = (runs.data?.versions ?? []).filter((r) => r.id !== a);
  const pick = b || list[0]?.id || "";
  if (runs.isLoading) return <Skeleton lines={3} label={t("Loading the runs")} />;
  if (!list.length) return <EmptyState heading={t("No other run to compare")} body={t("Pull the object again to get a second run.")} />;
  return (
    <div className="rn-stack">
      <Field label={t("Compare with")}><Select value={pick} onChange={(e) => setB(e.target.value)} options={list.map((r) => ({ value: r.id, label: runTitle(r) }))} /></Field>
      <Button onClick={() => { sheet.close(); router.push(withFixture(`${runPath(a)}/vs/${pick}`, fx)); }}>{t("Compare")}</Button>
    </div>
  );
}

function ExtractTarget({ arg }: { arg: unknown }) {
  const id = ((arg ?? {}) as { run?: string }).run ?? "";
  const fx = useFixture();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["next", "run", id, "extract-target", fx], queryFn: () => getRunExtractTarget(id), enabled: !!id });
  if (q.isLoading) return <Skeleton lines={4} label={t("Loading the target files")} />;
  const rows = q.data?.templates ?? [];
  if (!rows.length) return <EmptyState heading={t("No target files")} body={t("This run was not set up to fill a target template.")} />;
  const stat = (s: string) => ({ pending: t("Waiting"), filled: t("Filled"), failed: t("Failed"), skipped: t("Skipped") })[s] ?? s;
  const cols: Column<(typeof rows)[number]>[] = [
    { key: "m", label: t("Object"), render: (r) => moduleText(r.module) },
    { key: "t", label: t("Template"), render: (r) => r.template_name ?? r.template_id },
    { key: "s", label: t("Status"), render: (r) => stat(r.status) },
    { key: "e", label: t("Problem"), render: (r) => r.error ?? "" },
    { key: "a", label: t("Actions"), render: (r) => (
      <span className="rn-row-actions">
        {r.status === "filled" ? <ExportMenu label={t("Open file")} formats={[{ id: "xlsx", label: t("Excel workbook") }]} onExport={() => openExtractTargetFile(id, r.module)} /> : null}
        <Button variant="ghost" onClick={async () => { try { await refillExtractTarget(id, r.module); qc.invalidateQueries({ queryKey: ["next", "run", id, "extract-target"] }); toast(t("Filled again"), "good"); } catch { toast(t("It could not be filled again."), "bad"); } }}>{t("Fill again")}</Button>
      </span>
    ) },
  ];
  return <DataTable columns={cols} rows={rows} rowKey={(r) => r.module} label={t("Target files")} height={320} />;
}

export const RUN_SHEETS: Record<string, SheetDef> = {
  cycle: { label: t("Start a run"), render: () => <Cycle /> },
  upload: { label: t("Upload a cleaned file"), render: (arg) => <Upload arg={arg} /> },
  compare: { label: t("Compare runs"), render: (arg) => <Compare arg={arg} /> },
  "extract-target": { label: t("Target files"), render: (arg) => <ExtractTarget arg={arg} /> },
};
