"use client";

import { useState } from "react";
import { createRunSchedule, deleteRunSchedule, patchRunSchedule, pauseRunSchedule, resumeRunSchedule, type RunSchedule, type SchedulePreset } from "@/lib/api/v2/admin";
import { useProfiles, useRunSchedule, useRunSchedules, useSyncRuns } from "@/lib/v2/admin-queries";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { t, tx } from "@/lib/v2/i18n";
import { Button, Card, Code, DataTable, EmptyState, ErrorState, Field, Input, Select, Sheet, Skeleton } from "@/ui/kit";
import { Row, Sec, useAct, when } from "./shared";

export function Schedules() {
  const q = useRunSchedules();
  const sys = useSystemsExtended();
  const { run, busy } = useAct("runschedules");
  const [system, setSystem] = useState("");
  const [modules, setModules] = useState("");
  const [preset, setPreset] = useState<SchedulePreset>("daily");
  const [edit, setEdit] = useState("");
  const [look, setLook] = useState("");
  const rows = q.data?.schedules ?? [];
  const systems = (sys.data as { id: string; name: string }[] | undefined) ?? [];
  return (
    <Sec title={t("Extraction schedules")} scope="schedules" q={[q]} context={t("{n} schedules", { n: rows.length })}
      facts={[t("{n} extraction schedules are set.", { n: rows.length })]}>
      <Card title={t("Schedules")}>
        {rows.length === 0 ? <EmptyState heading={t("No extraction schedules yet.")} body={t("Add a schedule to extract on a regular day.")} /> : (
          <DataTable label={t("Extraction schedules")} rows={rows} rowKey={(r) => r.id} height={340}
            columns={[
              { key: "name", label: t("Schedule"), render: (r) => <Code code={r.name ?? r.id} description={r.system_name} /> },
              { key: "modules", label: t("Objects"), render: (r) => r.modules.map((m) => <Code key={m} code={m} />) },
              { key: "cadence", label: t("Runs"), render: (r) => r.cadence.preset ?? r.cadence.cron ?? "" },
              { key: "mode", label: t("Mode"), render: (r) => (r.extraction_mode === "delta" ? t("Changes only") : t("Full")) },
              { key: "next", label: t("Next run"), render: (r) => (r.active ? when(r.next_run_at) : t("Paused")) },
              { key: "last", label: t("Last run"), render: (r) => when(r.last_run_at) },
              { key: "act", label: t("Actions"), render: (r) => (
                <Row>
                  <Button variant="secondary" disabled={busy} onClick={() => run(() => (r.active ? pauseRunSchedule(r.id) : resumeRunSchedule(r.id)), r.active ? t("Schedule paused.") : t("Schedule resumed."))}>{r.active ? t("Pause") : t("Resume")}</Button>
                  <Button variant="ghost" onClick={() => setEdit(r.id)}>{t("Edit")}</Button>
                  <Button variant="ghost" disabled={busy} onClick={() => run(() => deleteRunSchedule(r.id), t("Schedule removed."))}>{t("Remove")}</Button>
                </Row>
              ) },
            ]} />
        )}
      </Card>
      <Card title={t("Add a schedule")}>
        <Row>
          <Field label={t("System")}>
            <Select value={system} onChange={(e) => setSystem(e.target.value)} options={[{ value: "", label: t("Choose a system") }, ...systems.map((s) => ({ value: s.id, label: s.name }))]} />
          </Field>
          <Field label={t("Objects")} hint={t("Object keys, separated by commas.")}><Input value={modules} onChange={(e) => setModules(e.target.value)} /></Field>
          <Field label={t("Runs")}>
            <Select value={preset} onChange={(e) => setPreset(e.target.value as SchedulePreset)} options={[{ value: "hourly", label: t("Hourly") }, { value: "daily", label: t("Daily") }, { value: "weekdays", label: t("Weekdays") }, { value: "weekly", label: t("Weekly") }, { value: "monthly", label: t("Monthly") }]} />
          </Field>
          <Button variant="primary" disabled={busy || !system || !modules.trim()}
            onClick={() => run(() => createRunSchedule({ system_id: system, modules: modules.split(",").map((m) => m.trim()).filter(Boolean), preset }), t("Schedule added."))}>{t("Add")}</Button>
        </Row>
      </Card>
      <Card title={t("Extraction history")} sub={t("Profiles and sync runs of one system.")}>
        <Field label={t("System")}>
          <Select value={look} onChange={(e) => setLook(e.target.value)} options={[{ value: "", label: t("Choose a system") }, ...systems.map((s) => ({ value: s.id, label: s.name }))]} />
        </Field>
        {look && <History key={look} systemId={look} />}
      </Card>
      <Sheet open={!!edit} onClose={() => setEdit("")} label={t("Edit schedule")} closeLabel={t("Close")}>
        {edit && <EditSchedule key={edit} id={edit} onDone={() => setEdit("")} />}
      </Sheet>
    </Sec>
  );
}

const presets = (): { value: SchedulePreset; label: string }[] => [
  { value: "hourly", label: t("Hourly") }, { value: "daily", label: t("Daily") }, { value: "weekdays", label: t("Weekdays") }, { value: "weekly", label: t("Weekly") }, { value: "monthly", label: t("Monthly") },
];

/** Reads the schedule from the server, then sends only the keys the person changed. */
function EditSchedule({ id, onDone }: { id: string; onDone: () => void }) {
  const q = useRunSchedule(id);
  if (q.isError) return <ErrorState heading={t("This could not be loaded")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton lines={4} label={t("Loading {screen}", { screen: t("Edit schedule") })} />;
  return <EditForm s={q.data} onDone={onDone} />;
}

function EditForm({ s, onDone }: { s: RunSchedule; onDone: () => void }) {
  const { run, busy } = useAct("runschedules");
  const [name, setName] = useState(s.name ?? "");
  const [modules, setModules] = useState(s.modules.join(", "));
  const [preset, setPreset] = useState<string>(s.cadence.preset ?? "");
  const [mode, setMode] = useState<string>(s.extraction_mode);
  const list = modules.split(",").map((m) => m.trim()).filter(Boolean);
  const body = {
    ...(name.trim() !== (s.name ?? "") ? { name: name.trim() } : {}),
    ...(list.join(",") !== s.modules.join(",") ? { modules: list } : {}),
    ...(preset && preset !== (s.cadence.preset ?? "") ? { preset: preset as SchedulePreset } : {}),
    ...(mode !== s.extraction_mode ? { extraction_mode: mode as "full" | "delta" } : {}),
  };
  const save = async () => { if (await run(() => patchRunSchedule(s.id, body), t("Schedule saved."))) onDone(); };
  return (
    <form className="mx-col" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <p className="mx-muted">{s.system_name}</p>
      <Field label={t("Name")}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t("Objects")} hint={t("Object keys, separated by commas.")}><Input value={modules} onChange={(e) => setModules(e.target.value)} /></Field>
      <Field label={t("Runs")} hint={s.cadence.preset ? undefined : t("Now on a custom cron: {cron}.", { cron: s.cadence.cron ?? "" })}>
        <Select value={preset} onChange={(e) => setPreset(e.target.value)} options={[{ value: "", label: s.cadence.preset ? t("Choose a cadence") : t("Keep the cron") }, ...presets()]} />
      </Field>
      <Field label={t("Mode")}>
        <Select value={mode} onChange={(e) => setMode(e.target.value)} options={[{ value: "full", label: t("Full") }, { value: "delta", label: t("Changes only") }]} />
      </Field>
      <div><Button variant="primary" type="submit" disabled={busy || Object.keys(body).length === 0 || list.length === 0}>{t("Save schedule")}</Button></div>
    </form>
  );
}

/** The system's sync profiles and its latest sync runs. */
function History({ systemId }: { systemId: string }) {
  const p = useProfiles(systemId);
  const r = useSyncRuns(systemId);
  if (p.isError || r.isError) return <ErrorState heading={t("This could not be loaded")} retryLabel={t("Try again")} onRetry={() => { void p.refetch(); void r.refetch(); }} />;
  if (p.isLoading || r.isLoading) return <Skeleton lines={4} label={t("Loading {screen}", { screen: t("Extraction history") })} />;
  const profiles = p.data ?? [];
  const runs = r.data ?? [];
  const name = (id: string) => profiles.find((x) => x.id === id)?.domain ?? id;
  return (
    <>
      {profiles.length === 0 ? <EmptyState heading={t("No sync profiles for this system.")} body={t("Profiles appear when a schedule has run.")} /> : (
        <DataTable label={t("Sync profiles")} rows={profiles} rowKey={(x) => x.id} height={200}
          columns={[
            { key: "domain", label: t("Object"), render: (x) => <Code code={x.domain} description={x.tables.join(", ")} /> },
            { key: "cron", label: t("Runs"), render: (x) => x.schedule_cron ?? t("Manual") },
            { key: "mode", label: t("Mode"), render: (x) => (x.extraction_mode === "delta" ? t("Changes only") : t("Full")) },
            { key: "state", label: t("Status"), render: (x) => (x.active ? t("Active") : t("Paused")) },
            { key: "last", label: t("Last run"), render: (x) => when(x.last_run_at) },
          ]} />
      )}
      {runs.length === 0 ? <EmptyState heading={t("No sync runs yet.")} body={t("Runs are listed here once an extraction has started.")} /> : (
        <DataTable label={t("Sync runs")} rows={runs} rowKey={(x) => x.id} height={240}
          columns={[
            { key: "obj", label: t("Object"), render: (x) => name(x.profile_id) },
            { key: "start", label: t("Started"), render: (x) => when(x.started_at) },
            { key: "rows", label: t("Rows read"), render: (x) => x.rows_extracted },
            { key: "status", label: t("Status"), render: (x) => <>{tx(x.status)}{x.error_detail ? `: ${x.error_detail}` : ""}</> },
          ]} />
      )}
    </>
  );
}
