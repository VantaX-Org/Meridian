"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { extractObjects, loadSystemConfig, testSystemConnection } from "@/lib/api/v2/runs";
import { createProfile, deleteProfile, updateProfile } from "@/lib/api/v2/sys";
import { extractModules, healthCheck, listSystemModules, syncConfig } from "@/lib/api/v2/connectivity";
import { getTriggerModules, triggerModules } from "@/lib/api/v2/syncTrigger";
import { useSystemExtractions, useSystemObjectList, useSystemProfiles } from "@/lib/v2/runs-queries";
import { useV2Session } from "@/lib/v2/hooks";
import { buildScope, dateError, EMPTY_SCOPE, SCOPE_LABEL, scopeSentence, type ScopeDraft } from "@/lib/v2/extract-scope";
import { cronError, describeCron, MODES, PRESETS } from "@/lib/v2/cron";
import { MODULE_LABELS, moduleDescription } from "@/lib/format";
import type { ScopeKey, SystemVersion } from "@/lib/api/system-objects";
import { t } from "@/lib/v2/i18n";
import { whole } from "@/lib/v2/format";
import { Button, Card, Chip, DataTable, EmptyState, ErrorState, Field, FieldChip, Input, Select, Skeleton, Toggle, TrendArea, useToast, type Column } from "@/ui/kit";
import { errMsg, when } from "./shared";

const label = (o: string): string => MODULE_LABELS[o] ?? moduleDescription(o) ?? "";
const total = (v: SystemVersion): number => Object.values(v.records).reduce((a, n) => a + (n ?? 0), 0);
const dqsOf = (v: SystemVersion): number | null => {
  const xs = Object.values(v.dqs).filter((x): x is number => typeof x === "number");
  return xs.length ? Math.round(xs.reduce((a, n) => a + n, 0) / xs.length) : null;
};

export function ExtractionsTab({ id, source }: { id: string; source: boolean }) {
  const fx = useFixture();
  const qc = useQueryClient();
  const toast = useToast();
  const me = useV2Session();
  const runs = useSystemExtractions(id);
  const objs = useSystemObjectList(id);
  const profiles = useSystemProfiles(id);
  const mods = useQuery({ queryKey: ["v2", "system-modules", fx, id] as const, queryFn: () => listSystemModules(id) });
  const trig = useQuery({ queryKey: ["v2", "sync-trigger", fx] as const, queryFn: getTriggerModules });
  const [picked, setPicked] = useState<string[]>([]);
  const [analyse, setAnalyse] = useState(true);
  const [delta, setDelta] = useState(false);
  const [scope, setScope] = useState<ScopeDraft>(EMPTY_SCOPE);
  const [busy, setBusy] = useState<string | null>(null);
  const [cron, setCron] = useState(PRESETS[1]?.value ?? "0 2 * * *");
  const [domain, setDomain] = useState("");
  const [mode, setMode] = useState<"full" | "delta">("full");
  const canRun = me.can("trigger_sync") || me.can("manage_systems");
  const canManage = me.can("manage_systems");

  const objects = useMemo(() => objs.data?.objects ?? [], [objs.data]);
  const chosen = useMemo(() => objects.filter((o) => picked.includes(o.object)), [objects, picked]);
  // Only the filters every chosen object accepts are offered; the date window shows when any chosen object has one.
  const filters = useMemo(() => (["company_codes", "plants", "sales_orgs", "purchasing_orgs"] as ScopeKey[]).filter((k) => chosen.length > 0 && chosen.every((o) => o.scope_filters.includes(k))), [chosen]);
  const windowed = chosen.some((o) => o.date_window.length > 0);
  const built = buildScope(scope, filters, windowed);
  const derr = dateError(scope.date_from, scope.date_to);

  const act = async (key: string, fn: () => Promise<string>) => {
    setBusy(key);
    try { toast(await fn(), "good"); await qc.invalidateQueries({ queryKey: ["v2"] }); } catch (e) { toast(errMsg(e), "bad"); } finally { setBusy(null); }
  };

  const versions = runs.data?.versions ?? [];
  const trend = [...versions].reverse().map((v) => ({ axis: v.id, title: v.label ?? when(v.run_at), value: dqsOf(v) }));

  const runCols: Column<SystemVersion>[] = [
    { key: "run", label: t("Run"), sort: (v) => v.run_at, render: (v) => <span>{v.label ?? when(v.run_at)}{v.baseline ? ` (${t("Version 1")})` : ""}</span> },
    { key: "status", label: t("Status"), render: (v) => (v.status === "completed" ? t("Completed") : v.status === "failed" ? t("Failed") : v.status === "running" ? t("Running") : v.status) },
    { key: "objects", label: t("Objects"), render: (v) => whole(v.objects.length) },
    { key: "records", label: t("Records"), align: "end", sort: total, render: (v) => whole(total(v)) },
    { key: "dqs", label: t("Quality score"), align: "end", sort: (v) => dqsOf(v) ?? -1, render: (v) => { const d = dqsOf(v); return d === null ? t("Not analysed") : `${d}%`; } },
    { key: "scope", label: t("Scope"), render: (v) => scopeSentence(v.scope) },
  ];

  const objCols: Column<(typeof objects)[number]>[] = [
    { key: "pick", label: t("Read"), render: (o) => <input type="checkbox" aria-label={t("Read {object}", { object: o.object })} checked={picked.includes(o.object)} onChange={(e) => setPicked(e.target.checked ? [...picked, o.object] : picked.filter((x) => x !== o.object))} /> },
    { key: "object", label: t("Object"), sort: (o) => o.object, render: (o) => <FieldChip code={o.object} description={label(o.object)} /> },
    { key: "tables", label: t("Tables"), align: "end", render: (o) => whole(o.tables.length) },
    { key: "last", label: t("Last download"), render: (o) => (o.last_download ? `${when(o.last_download.at)} (${whole(o.last_download.records ?? 0)})` : t("Never")) },
  ];

  if (runs.isLoading || objs.isLoading) return <Skeleton lines={6} label={t("Loading extractions")} />;
  if (runs.isError) return <ErrorState heading={t("Extractions could not be loaded")} retryLabel={t("Try again")} onRetry={() => void runs.refetch()} />;

  return (
    <div className="mx-col">
      <Card title={t("Connection")} sub={source ? t("Source system: Meridian reads from it.") : t("Target system: Meridian compares against it.")}>
        <div className="mx-links">
          <Button variant="secondary" disabled={busy === "test"} onClick={() => void act("test", async () => { const r = await testSystemConnection(id); return r.connected ? t("The system answered.") : t("The system did not answer: {why}", { why: r.message }); })}>{t("Test connection")}</Button>
          <Button variant="secondary" disabled={!canRun || busy === "health"} onClick={() => void act("health", async () => { await healthCheck(id); return t("Health check queued."); })}>{t("Check health")}</Button>
          <Button variant="secondary" disabled={!canRun || busy === "config"} onClick={() => void act("config", async () => { await loadSystemConfig(id); return t("Configuration load queued."); })}>{t("Load configuration")}</Button>
        </div>
      </Card>

      <Card title={t("Runs")} sub={t("Every extraction of this system, newest first.")}>
        <TrendArea points={trend} label={t("Quality score across runs")} emptyLabel={t("A trend shows after two analysed runs.")} />
        {versions.length === 0 ? <EmptyState heading={t("No extraction yet")} body={t("Choose objects below and read them to create Version 1.")} /> : <DataTable columns={runCols} rows={versions} rowKey={(v) => v.id} label={t("Extraction runs")} height={280} />}
      </Card>

      <Card title={t("Read objects")} sub={t("Choose what to read from the system. Split the scope by organisation or date.")}>
        {objects.length === 0 ? <EmptyState heading={t("No object is available")} body={t("The system lists no extractable object yet. Load its configuration first.")} /> : (
          <>
            <DataTable columns={objCols} rows={objects} rowKey={(o) => o.object} label={t("Extractable objects")} height={280} />
            {chosen.length > 0 ? (
              <div className="mx-col" data-testid="scope-editor">
                <h3>{t("Split scope")}</h3>
                {filters.length === 0 && !windowed ? <p className="mx-muted">{t("The chosen objects accept no organisational filter. They are read in full.")}</p> : null}
                {filters.map((k) => (
                  <Field key={k} label={SCOPE_LABEL[k]} hint={t("Comma-separated. Empty reads all.")}>
                    <Input value={scope.lists[k] ?? ""} placeholder="1000, 2000" onChange={(e) => setScope({ ...scope, lists: { ...scope.lists, [k]: e.target.value } })} />
                  </Field>
                ))}
                {windowed ? (
                  <>
                    <Field label={t("Documents from")}><Input type="date" value={scope.date_from} onChange={(e) => setScope({ ...scope, date_from: e.target.value })} /></Field>
                    <Field label={t("Documents to")} error={derr}><Input type="date" value={scope.date_to} onChange={(e) => setScope({ ...scope, date_to: e.target.value })} /></Field>
                  </>
                ) : null}
                <Toggle label={t("Skip records flagged for deletion")} checked={scope.exclude_deleted} onChange={(v) => setScope({ ...scope, exclude_deleted: v })} />
                <p className="mx-muted" data-testid="scope-sentence">{scopeSentence(built)}</p>
              </div>
            ) : null}
            <div className="mx-links">
              <Toggle label={t("Analyse after reading")} checked={analyse} onChange={setAnalyse} />
              <Toggle label={t("Read only what changed")} checked={delta} onChange={setDelta} />
              <Button variant="primary" disabled={!canRun || picked.length === 0 || Boolean(derr) || busy === "extract"} onClick={() => void act("extract", async () => { await extractObjects(id, picked, analyse, built, undefined, delta); return t("Extraction of {n} objects queued.", { n: picked.length }); })}>{t("Read {n} objects", { n: picked.length })}</Button>
            </div>
          </>
        )}
      </Card>

      <Card title={t("Extract by module")} sub={t("Reads modules with their configuration through the connectivity service.")}>
        {(mods.data ?? []).length === 0 ? <EmptyState heading={t("No module is listed")} body={t("The connectivity service lists no module for this system.")} /> : (
          <>
            <DataTable columns={[
              { key: "module", label: t("Module"), render: (m) => <FieldChip code={m.module} description={label(m.module)} /> },
              { key: "rows", label: t("Rows"), align: "end", render: (m) => whole(m.row_count) },
              { key: "sync", label: t("Last sync"), render: (m) => when(m.last_synced_at) },
              { key: "cfg", label: t("Configuration"), render: (m) => (m.config_synced ? t("Synced") : t("Not synced")) },
            ] as Column<NonNullable<typeof mods.data>[number]>[]} rows={mods.data ?? []} rowKey={(m) => m.module} label={t("Modules")} height={240} />
            <div className="mx-links">
              <Button variant="secondary" disabled={!canRun || busy === "sync"} onClick={() => void act("sync", async () => { await syncConfig(id, (mods.data ?? []).map((m) => m.module)); return t("Configuration sync queued."); })}>{t("Sync configuration")}</Button>
              <Button variant="primary" disabled={!canRun || busy === "mods"} onClick={() => void act("mods", async () => { await extractModules(id, (mods.data ?? []).filter((m) => m.enabled).map((m) => m.module)); return t("Module extraction queued."); })}>{t("Extract enabled modules")}</Button>
            </div>
          </>
        )}
      </Card>

      <Card title={t("Re-check objects")} sub={t("Scores the latest stored extraction again. Nothing is read from SAP.")}>
        {(trig.data ?? []).length === 0 ? <EmptyState heading={t("Nothing to re-check")} body={t("Run an extraction first, then re-check it.")} /> : (
          <>
            <DataTable columns={[
              { key: "m", label: t("Object"), render: (m) => <FieldChip code={m.module_id} description={m.label} /> },
              { key: "s", label: t("Status"), render: (m) => (m.status === "running" ? t("Running") : m.status === "failed" ? t("Failed") : m.status === "completed" ? t("Completed") : t("Idle")) },
              { key: "l", label: t("Last run"), render: (m) => when(m.last_run_at) },
            ] as Column<NonNullable<typeof trig.data>[number]>[]} rows={trig.data ?? []} rowKey={(m) => m.module_id} label={t("Re-check status")} height={240} />
            <Button variant="secondary" disabled={!canRun || busy === "trig"} onClick={() => void act("trig", async () => { const r = await triggerModules((trig.data ?? []).map((m) => m.module_id)); return t("{queued} queued, {skipped} skipped.", { queued: r.queued.length, skipped: r.skipped.length }); })}>{t("Re-check all")}</Button>
          </>
        )}
      </Card>

      <Card title={t("Schedules")} sub={t("Profiles read a domain on a schedule.")}>
        {profiles.isLoading ? <Skeleton lines={2} label={t("Loading schedules")} /> : (profiles.data ?? []).length === 0 ? <EmptyState heading={t("No schedule yet")} body={t("Add a profile to read a domain on a schedule.")} /> : (
          <DataTable columns={[
            { key: "d", label: t("Domain"), render: (p) => <FieldChip code={p.domain} description={label(p.domain)} /> },
            { key: "c", label: t("Schedule"), render: (p) => describeCron(p.schedule_cron) },
            { key: "m", label: t("Mode"), render: (p) => (p.extraction_mode === "delta" ? t("Changes only") : t("Full")) },
            { key: "n", label: t("Next run"), render: (p) => when(p.next_run_at) },
            { key: "a", label: t("Actions"), render: (p) => canManage ? (
              <span className="mx-links">
                <Button variant="ghost" onClick={() => void act(`p${p.id}`, async () => { await updateProfile(id, p.id, { active: !p.active }); return p.active ? t("Schedule paused.") : t("Schedule resumed."); })}>{p.active ? t("Pause") : t("Resume")}</Button>
                <Button variant="ghost" onClick={() => void act(`d${p.id}`, async () => { await deleteProfile(id, p.id); return t("Schedule deleted."); })}>{t("Delete")}</Button>
              </span>) : null },
          ] as Column<NonNullable<typeof profiles.data>[number]>[]} rows={profiles.data ?? []} rowKey={(p) => p.id} label={t("Schedules")} height={200} />
        )}
        {canManage ? (
          <div className="mx-col">
            <Field label={t("Domain")}><Input value={domain} placeholder="material_master" onChange={(e) => setDomain(e.target.value)} /></Field>
            <Field label={t("Schedule")} error={cronError(cron)}>
              <Select value={cron} options={PRESETS.filter((p) => p.value !== "custom").map((p) => ({ value: p.value, label: p.label }))} onChange={(e) => setCron(e.target.value)} />
            </Field>
            <div className="mx-links">{MODES.map((m) => <Chip key={m.value} selected={mode === m.value} onClick={() => setMode(m.value)}>{m.label}</Chip>)}</div>
            <Button variant="primary" disabled={!domain.trim() || Boolean(cronError(cron)) || busy === "prof"} onClick={() => void act("prof", async () => { await createProfile(id, { system_id: id, domain: domain.trim(), tables: [], schedule_cron: cron, extraction_mode: mode }); setDomain(""); return t("Schedule added."); })}>{t("Add schedule")}</Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

