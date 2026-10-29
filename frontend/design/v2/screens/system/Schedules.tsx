"use client";

import { useState } from "react";
import { formatDate, labelOf } from "@/lib/format";
import type { SyncProfile } from "@/types/api";
import { createProfile, deleteProfile, updateProfile } from "@/lib/api/v2/sys";
import { describeCron, PRESETS } from "@/lib/v2/cron";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { useSystemObjectList, useSystemProfiles } from "@/lib/v2/runs-queries";
import { useRefreshV2 } from "@/lib/v2/sys-queries";
import { useOutcome } from "../../inspector/shared";
import { ConfirmBar, Field, Gate } from "../../forms";
import { ScrollFrame } from "../object/ScrollFrame";
import { Dash, EmptyFrame, ErrorFrame, Skeleton, V2Link } from "../../parts";
import { ScheduleFields, scheduleValid, type ScheduleValue } from "./ScheduleFields";

/**
 * System › Schedules: the extraction schedules (sync profiles) of the system. Add one for an object, open one to change
 * its timetable and mode, pause and resume it, or delete it. Needs manage_systems; without it the table is read-only.
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
  const [value, setValue] = useState<ScheduleValue>({ cron: PRESETS[1].value, mode: "full" });
  const [removing, setRemoving] = useState<SyncProfile | null>(null);

  if (q.isLoading) return <Skeleton width="100%" height={120} />;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>The schedules could not be read.</ErrorFrame>;
  const profiles: SyncProfile[] = q.data ?? [];
  const scheduled = new Set(profiles.map((p) => p.domain));
  const addable = (objects.data?.objects ?? []).filter((o) => !scheduled.has(o.object));

  const add = () =>
    void run("add", async () => {
      const o = objects.data?.objects.find((x) => x.object === domain);
      const saved = await createProfile(id, { system_id: id, domain, tables: o?.tables ?? [], schedule_cron: value.cron.trim(), active: true, extraction_mode: value.mode });
      setDomain("");
      refresh();
      return { tone: "ok", title: "Schedule added", detail: `${labelOf(saved.domain)}: ${describeCron(saved.schedule_cron)}${saved.next_run_at ? `, next run ${formatDate(saved.next_run_at, "datetime")}` : ""}.` };
    });
  const toggle = (p: SyncProfile) =>
    void run(`toggle:${p.id}`, async () => {
      const saved = await updateProfile(id, p.id, { active: !p.active });
      refresh();
      return { tone: "ok", title: saved.active ? "Schedule resumed" : "Schedule paused", detail: `${labelOf(p.domain)}.` };
    });
  const remove = (p: SyncProfile) =>
    void run(`remove:${p.id}`, async () => {
      await deleteProfile(id, p.id);
      setRemoving(null);
      refresh();
      return { tone: "ok", title: "Schedule deleted", detail: `${labelOf(p.domain)} is no longer extracted on a schedule.` };
    });

  return (
    <>
      <p className="m2-note">Each schedule extracts the object again and re-runs its checks, so trends and alerts see every run. Times are UTC.</p>
      {profiles.length === 0 ? (
        <EmptyFrame>Nothing is scheduled for this system. Objects are only checked again when someone extracts them{allowed ? "; add a schedule below" : ""}.</EmptyFrame>
      ) : (
        <ScrollFrame label="Table 1, scrollable">
          <table className="m2-tbl" data-testid="system-schedules">
            <thead>
              <tr>
                <th scope="col">Object</th>
                <th scope="col">Schedule</th>
                <th scope="col">Mode</th>
                <th scope="col">Next</th>
                <th scope="col">Last</th>
                <th scope="col">State</th>
                {allowed ? <th scope="col"><span className="m2-sr">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {profiles.map((p) => (
                <tr key={p.id}>
                  <th scope="row">
                    <V2Link href={hrefFor({ kind: "syncschedule", id: `${id}:${p.id}` })}>{labelOf(p.domain)}</V2Link>
                  </th>
                  <td>{describeCron(p.schedule_cron)}</td>
                  <td>{p.extraction_mode === "delta" ? "Changes only" : "Full"}</td>
                  <td>{p.active && p.next_run_at ? formatDate(p.next_run_at, "datetime") : <Dash />}</td>
                  <td>{p.last_run_at ? formatDate(p.last_run_at, "datetime") : <Dash />}</td>
                  <td>{p.active ? "On" : "Paused"}</td>
                  {allowed ? (
                    <td>
                      <span className="m2-rowacts">
                        <button type="button" className="m2-btn m2-sm" disabled={pending !== null} onClick={() => toggle(p)} aria-label={`${p.active ? "Pause" : "Resume"} the ${labelOf(p.domain)} schedule`}>
                          {p.active ? "Pause" : "Resume"}
                        </button>
                        <button type="button" className="m2-btn m2-sm m2-ghost" onClick={() => setRemoving(p)} aria-label={`Delete the ${labelOf(p.domain)} schedule`}>
                          Delete
                        </button>
                      </span>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollFrame>
      )}
      {removing ? (
        <ConfirmBar
          message={`${labelOf(removing.domain)} is no longer extracted on a schedule (${describeCron(removing.schedule_cron)}). Its extraction log goes with it; runs and findings already analysed stay.`}
          confirmLabel="Delete schedule"
          pending={pending === `remove:${removing.id}`}
          onConfirm={() => remove(removing)}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
      {outcome ? (
        <p className="m2-result" role="status" data-tone={outcome.tone} data-testid="action-result">
          <span className="m2-result-t">{outcome.title}</span>
          <span>{outcome.detail}</span>
        </p>
      ) : null}
      {!allowed ? (
        <Gate>Adding, changing, pausing and deleting a schedule needs the manage systems permission.</Gate>
      ) : addable.length > 0 ? (
        <form
          className="m2-form6"
          style={{ marginTop: 16 }}
          aria-label="Add a schedule"
          onSubmit={(e) => {
            e.preventDefault();
            if (domain && scheduleValid(value)) add();
          }}
        >
          <h3>Add a schedule</h3>
          <Field label="Object">
            {(p) => (
              <select {...p} value={domain} onChange={(e) => setDomain(e.target.value)}>
                <option value="">Choose an object</option>
                {addable.map((o) => (
                  <option key={o.object} value={o.object}>{labelOf(o.object)}</option>
                ))}
              </select>
            )}
          </Field>
          <ScheduleFields value={value} onChange={setValue} />
          <div className="m2-acts">
            <button type="submit" className="m2-btn m2-strong" disabled={!domain || !scheduleValid(value) || pending !== null}>
              {pending === "add" ? "Adding…" : "Add schedule"}
            </button>
          </div>
        </form>
      ) : (
        <p className="m2-prov">Every object of this system has a schedule.</p>
      )}
    </>
  );
}
