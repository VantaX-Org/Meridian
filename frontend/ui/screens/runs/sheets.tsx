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
import { checkCleaned, checksOf, needsParent, uploadCleaned, uploadSentence, type UploadChecks } from "@/lib/api/v2/roundtrip";
import { getRunExtractTarget, openExtractTargetFile, refillExtractTarget } from "@/lib/api/v2/extract-target";
import { Button, Chip, DataTable, EmptyState, Field, Select, Skeleton, Toggle, useSheet, useToast, type Column, type SheetDef } from "@/ui/kit";
import { FileDrop } from "./FileDrop";
import { runPath, runTitle } from "./util";
import "./runs.css";

const checkText = (id: string) =>
  ({ fingerprint: t("File is from this system"), run: t("Run is known"), template: t("Template matches"), columns: t("Columns match"), rows: t("Rows match"), keys: t("Keys match"), values: t("Values are valid"), formulas: t("No formulas in the data") })[id] ?? id;
const verdictText = (s: string) => (s === "pass" ? t("Passed") : s === "warn" ? t("Warning") : t("Failed"));

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
    try { await startRun(system, { objects: picked, scope: {}, analyse }); toast(t("Run started"), "good"); sheet.close(); router.push(withFixture("/n/runs?view=jobs", fx)); }
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
  const toast = useToast();
  const sheet = useSheet();
  const fx = useFixture();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [checks, setChecks] = useState<UploadChecks | null>(null);
  const [msg, setMsg] = useState("");
  const [parent, setParent] = useState(false);
  const [busy, setBusy] = useState(false);
  const pick = async (f: File | null) => {
    setFile(f); setChecks(null); setMsg("");
    if (!f) return;
    try { setChecks(await checkCleaned(f, a.run, a.module)); }
    catch (e) { if (needsParent(e)) setParent(true); const c = checksOf(e); setMsg(c ? t("The file did not pass its checks.") : uploadSentence(e, t("The file could not be checked."))); }
  };
  const send = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await uploadCleaned(file, a.run, a.module, checks?.verdict === "warn");
      qc.invalidateQueries({ queryKey: ["next"] });
      toast(t("Uploaded. {n} values changed.", { n: r.applied }), "good");
      sheet.close();
      router.push(withFixture(runPath(r.version_id), fx));
    } catch (e) { setMsg(uploadSentence(e, t("The upload did not work."))); } finally { setBusy(false); }
  };
  const cols: Column<UploadChecks["checks"][number]>[] = [
    { key: "c", label: t("Check"), render: (c) => checkText(c.id) },
    { key: "s", label: t("Result"), render: (c) => verdictText(c.status) },
    { key: "d", label: t("Detail"), render: (c) => c.detail },
  ];
  return (
    <div className="rn-stack">
      <FileDrop accept=".xlsx,.csv" file={file} onFile={pick} label={t("Cleaned file")} hint={t("Drop the Excel file you cleaned.")} />
      {parent && !a.run ? <p className="mx-muted">{t("The file does not say which run it came from. Open this sheet from a run.")}</p> : null}
      {checks ? <DataTable columns={cols} rows={checks.checks} rowKey={(c) => c.id} label={t("File checks")} height={300} /> : null}
      {msg ? <p role="alert">{msg}</p> : null}
      <Button disabled={!file || !checks || checks.verdict === "fail" || busy} onClick={send}>{checks?.verdict === "warn" ? t("Upload with warnings") : t("Upload and score")}</Button>
    </div>
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
        {r.status === "filled" ? <Button variant="ghost" onClick={async () => { try { toast(t("Saved {name}", { name: await openExtractTargetFile(id, r.module) }), "good"); } catch { toast(t("The file could not be opened."), "bad"); } }}>{t("Open file")}</Button> : null}
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
