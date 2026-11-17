"use client";

import { useState } from "react";
import { createRunSchedule, deleteRunSchedule, pauseRunSchedule, resumeRunSchedule, type SchedulePreset } from "@/lib/api/v2/admin";
import { useRunSchedules } from "@/lib/v2/admin-queries";
import { useSystemsExtended } from "@/lib/v2/runs-queries";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Code, DataTable, Field, Input, Select, EmptyState } from "@/ui/kit";
import { Row, Sec, useAct, when } from "./shared";

export function Schedules() {
  const q = useRunSchedules();
  const sys = useSystemsExtended();
  const { run, busy } = useAct("runschedules");
  const [system, setSystem] = useState("");
  const [modules, setModules] = useState("");
  const [preset, setPreset] = useState<SchedulePreset>("daily");
  const rows = q.data?.schedules ?? [];
  const systems = (sys.data as { id: string; name: string }[] | undefined) ?? [];
  return (
    <Sec title={t("Extraction schedules")} scope="schedules" q={[q]} context={t("{n} schedules", { n: rows.length })}
      facts={[t("{n} extraction schedules are set.", { n: rows.length })]}>
      <Card title={t("Schedules")}>
        {rows.length === 0 ? <EmptyState heading={t("No extraction schedules yet.")} /> : (
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
    </Sec>
  );
}
