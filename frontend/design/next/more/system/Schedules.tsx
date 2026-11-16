"use client";

import { useState } from "react";
import { createProfile, deleteProfile, updateProfile } from "@/lib/api/v2/sys";
import { formatDate, labelOf } from "@/lib/format";
import { cronError, CUSTOM, describeCron, isPreset, MODES, PRESETS } from "@/lib/v2/cron";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { useSystemObjectList, useSystemProfiles } from "@/lib/v2/runs-queries";
import { DASH } from "@/lib/v2/score";
import { useRefreshV2 } from "@/lib/v2/sys-queries";
import type { SyncProfile } from "@/types/api";
import { V2Link } from "@/design/v2/parts";
import { useOutcome } from "@/design/v2/inspector/shared";
import { Button, Chip, Confirm, DataTable, EmptyState, ErrorState, Skeleton, type Column } from "../../kit";
import { ExportTable } from "../ExportTable";

type Mode = "full" | "delta";

/** A schedule's timetable and mode: a preset or a custom cron, checked as you type, and full or changes only. */
function ScheduleInputs({ cron, mode, onCron, onMode }: { cron: string; mode: Mode; onCron: (v: string) => void; onMode: (v: Mode) => void }) {
  const [custom, setCustom] = useState(() => !isPreset(cron));
  const error = custom && cron.trim() ? cronError(cron) : custom ? t("Enter five fields: minute, hour, day, month, weekday") : undefined;
  return (
    <>
      <label className="nx-field">
        {t("Schedule")}
        <select className="nx-input" value={custom ? CUSTOM : cron} onChange={(e) => { if (e.target.value === CUSTOM) setCustom(true); else { setCustom(false); onCron(e.target.value); } }}>
          {PRESETS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
        </select>
        <span className="nx-sub">{t("Times are UTC; a due run starts within 5 minutes.")}</span>
      </label>
      {custom ? (
        <label className="nx-field">
          {t("Cron expression")}
          <input className="nx-input" value={cron} onChange={(e) => onCron(e.target.value)} placeholder="0 2 * * 1" aria-invalid={error ? true : undefined} />
          {error ? <span className="nx-error-line" role="alert">{error}</span> : <span className="nx-sub">{t("Minute hour day month weekday")}</span>}
        </label>
      ) : null}
      <label className="nx-field">
        {t("Mode")}
        <select className="nx-input" value={mode} onChange={(e) => onMode(e.target.value === "delta" ? "delta" : "full")}>
          {MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <span className="nx-sub">{t("Changes only reads the records SAP changed since the last download, with a full download at least once a week.")}</span>
      </label>
    </>
  );
}

/**
 * System, Schedules: the extraction schedules (sync profiles) of the system. Add one for an object, pause and resume it,
 * or delete it; the object name opens the schedule to change its timetable. Needs manage_systems; without it the table is read-only.
 */
export function Schedules({ id }: { id: string }) {
  const q = useSystemProfiles(id);
  const { can } = useV2Session();
  const allowed = can("manage_systems");
  const objects = useSystemObjectList(id, allowed);
  const refresh = useRefreshV2();
  const { hrefFor } = useOpenItem();
  const { outcome, pending, run } = useOutcome();
  const [domain, setDomain] = useState("");
  const [cron, setCron] = useState(PRESETS[1].value);
  const [mode, setMode] = useState<Mode>("full");
  const [removing, setRemoving] = useState<SyncProfile | null>(null);

  if (q.isLoading) return <Skeleton lines={4} label={t("Schedules")} />;
  if (q.isError) return <ErrorState sentence={t("The schedules could not be read.")} onRetry={() => void q.refetch()} />;
  const profiles: SyncProfile[] = q.data ?? [];
  const scheduled = new Set(profiles.map((p) => p.domain));
  const addable = (objects.data?.objects ?? []).filter((o) => !scheduled.has(o.object));

  const add = () =>
    void run("add", async () => {
      const o = objects.data?.objects.find((x) => x.object === domain);
      const saved = await createProfile(id, { system_id: id, domain, tables: o?.tables ?? [], schedule_cron: cron.trim(), active: true, extraction_mode: mode });
      setDomain("");
      refresh();
      return { tone: "ok", title: t("Schedule added"), detail: `${labelOf(saved.domain)}: ${describeCron(saved.schedule_cron)}${saved.next_run_at ? t(", next run {next_run_at}", { next_run_at: formatDate(saved.next_run_at, "datetime") }) : ""}.` };
    });
  const toggle = (p: SyncProfile) =>
    void run(`toggle:${p.id}`, async () => {
      const saved = await updateProfile(id, p.id, { active: !p.active });
      refresh();
      return { tone: "ok", title: saved.active ? t("Schedule resumed") : t("Schedule paused"), detail: `${labelOf(p.domain)}.` };
    });
  const remove = (p: SyncProfile) =>
    void run(`remove:${p.id}`, async () => {
      await deleteProfile(id, p.id);
      setRemoving(null);
      refresh();
      return { tone: "ok", title: t("Schedule deleted"), detail: t("{domain} is no longer extracted on a schedule.", { domain: labelOf(p.domain) }) };
    });

  const columns: Column<SyncProfile>[] = [
    { id: "object", label: t("Object"), cell: (p) => <V2Link className="nx-link" href={hrefFor({ kind: "syncschedule", id: `${id}:${p.id}` })}>{labelOf(p.domain)}</V2Link> },
    { id: "schedule", label: t("Schedule"), cell: (p) => describeCron(p.schedule_cron) },
    { id: "mode", label: t("Mode"), cell: (p) => (p.extraction_mode === "delta" ? t("Changes only") : t("Full")) },
    { id: "next", label: t("Next"), cell: (p) => (p.active && p.next_run_at ? formatDate(p.next_run_at, "datetime") : DASH) },
    { id: "last", label: t("Last"), cell: (p) => (p.last_run_at ? formatDate(p.last_run_at, "datetime") : DASH) },
    { id: "state", label: t("State"), cell: (p) => <Chip tone={p.active ? "good" : "neutral"}>{p.active ? t("On") : t("Paused")}</Chip> },
    {
      id: "actions",
      label: t("Actions"),
      hidden: !allowed,
      cell: (p) => (
        <span className="nx-row">
          <Button size={32} variant="secondary" disabled={pending !== null} loading={pending === `toggle:${p.id}`} onClick={() => toggle(p)} aria-label={p.active ? t("Pause the {domain} schedule", { domain: labelOf(p.domain) }) : t("Resume the {domain} schedule", { domain: labelOf(p.domain) })}>
            {p.active ? t("Pause") : t("Resume")}
          </Button>
          <Button size={32} variant="quiet" onClick={() => setRemoving(p)} aria-label={t("Delete the {domain} schedule", { domain: labelOf(p.domain) })}>{t("Delete")}</Button>
        </span>
      ),
    },
  ];

  return (
    <div className="nx-body" data-testid="n-schedules">
      <p className="nx-note">{t("Each schedule extracts the object again and re-runs its checks, so trends and alerts see every run. Times are UTC.")}</p>
      {profiles.length === 0 ? (
        <EmptyState heading={allowed ? t("Nothing is scheduled for this system. Objects are only checked again when someone extracts them; add a schedule below.") : t("Nothing is scheduled for this system. Objects are only checked again when someone extracts them.")} />
      ) : (
        <ExportTable>
          <div data-testid="system-schedules">
            <DataTable rows={profiles} columns={columns} rowKey={(p) => p.id} rowLabel={(p) => labelOf(p.domain)} caption={t("Schedules")} />
          </div>
        </ExportTable>
      )}
      <Confirm
        open={removing !== null}
        title={t("Delete schedule")}
        consequence={removing ? t("{domain} is no longer extracted on a schedule ({describeCron}). Its extraction log goes with it; runs and findings already analysed stay.", { domain: labelOf(removing.domain), describeCron: describeCron(removing.schedule_cron) }) : ""}
        confirmLabel={t("Delete schedule")}
        danger
        onConfirm={() => { if (removing) remove(removing); }}
        onCancel={() => setRemoving(null)}
      />
      {outcome ? (
        <p className="nx-note" role="status" data-tone={outcome.tone} data-testid="action-result">
          <strong>{outcome.title}</strong> {outcome.detail}
        </p>
      ) : null}
      {!allowed ? (
        <p className="nx-note">{t("Adding, changing, pausing and deleting a schedule needs the manage systems permission.")}</p>
      ) : addable.length > 0 ? (
        <form className="nx-body" aria-label={t("Add a schedule")} onSubmit={(e) => { e.preventDefault(); if (domain && !cronError(cron)) add(); }}>
          <h3>{t("Add a schedule")}</h3>
          <label className="nx-field">
            {t("Object")}
            <select className="nx-input" value={domain} onChange={(e) => setDomain(e.target.value)}>
              <option value="">{t("Choose an object")}</option>
              {addable.map((o) => <option key={o.object} value={o.object}>{labelOf(o.object)}</option>)}
            </select>
          </label>
          <ScheduleInputs cron={cron} mode={mode} onCron={setCron} onMode={setMode} />
          <div className="nx-row">
            <Button type="submit" size={32} variant="primary" disabled={!domain || Boolean(cronError(cron)) || pending !== null} loading={pending === "add"}>{t("Add schedule")}</Button>
          </div>
        </form>
      ) : (
        <p className="nx-sub">{t("Every object of this system has a schedule.")}</p>
      )}
    </div>
  );
}
