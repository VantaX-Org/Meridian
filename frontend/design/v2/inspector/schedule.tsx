"use client";

import { useState } from "react";
import { formatDate, labelOf } from "@/lib/format";
import { deleteProfile, updateProfile } from "@/lib/api/v2/sys";
import { describeCron } from "@/lib/v2/cron";
import { useV2Session } from "@/lib/v2/hooks";
import { useSystemProfiles } from "@/lib/v2/runs-queries";
import { useRefreshV2 } from "@/lib/v2/sys-queries";
import { Actions, Fact, Facts, InspectorFrame } from "../Inspector";
import { ConfirmBar, Gate } from "../forms";
import { Dash, EmptyFrame, ErrorFrame, Skeleton, V2Link } from "../parts";
import { ScheduleFields, scheduleValid, type ScheduleValue } from "../screens/system/ScheduleFields";
import { useOutcome } from "./shared";

function Body({ system, profileId, onClose }: { system: string; profileId: string; onClose: () => void }) {
  const q = useSystemProfiles(system);
  const { can } = useV2Session();
  const allowed = can("manage_systems");
  const refresh = useRefreshV2();
  const { outcome, pending, run } = useOutcome();
  const p = q.data?.find((x) => x.id === profileId);
  const [edit, setEdit] = useState<ScheduleValue | null>(null);
  const [removing, setRemoving] = useState(false);
  if (q.isLoading) return <Skeleton width="100%" height={120} />;
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>The schedule could not be read.</ErrorFrame>;
  if (!p) return <EmptyFrame>This schedule is not on the system any more. It may have been deleted.</EmptyFrame>;
  const value: ScheduleValue = edit ?? { cron: p.schedule_cron ?? "0 2 * * 1", mode: p.extraction_mode ?? "full" };
  const dirty = edit !== null && (edit.cron !== (p.schedule_cron ?? "") || edit.mode !== p.extraction_mode);

  const save = () =>
    void run("save", async () => {
      const saved = await updateProfile(system, p.id, { schedule_cron: value.cron.trim(), extraction_mode: value.mode });
      setEdit(null);
      refresh();
      return { tone: "ok", title: "Schedule saved", detail: `${describeCron(saved.schedule_cron)}${saved.next_run_at ? `, next run ${formatDate(saved.next_run_at, "datetime")}` : ""}.` };
    });
  const toggle = () =>
    void run("toggle", async () => {
      const saved = await updateProfile(system, p.id, { active: !p.active });
      refresh();
      return { tone: "ok", title: saved.active ? "Schedule resumed" : "Schedule paused" };
    });
  const remove = () =>
    void run("remove", async () => {
      await deleteProfile(system, p.id);
      refresh();
      onClose();
      return { tone: "ok", title: "Schedule deleted" };
    });

  return (
    <>
      <Facts>
        <Fact label="Object">{labelOf(p.domain)}</Fact>
        <Fact label="Schedule">{describeCron(p.schedule_cron)}</Fact>
        <Fact label="Mode">{p.extraction_mode === "delta" ? "Changes only" : "Full"}</Fact>
        <Fact label="State">{p.active ? "On" : "Paused"}</Fact>
        <Fact label="Next run">{p.active && p.next_run_at ? formatDate(p.next_run_at, "datetime") : <Dash />}</Fact>
        <Fact label="Last run">{p.last_run_at ? formatDate(p.last_run_at, "datetime") : <Dash />}</Fact>
        <Fact label="Tables">{p.tables.length ? p.tables.join(", ") : <Dash />}</Fact>
      </Facts>
      {allowed ? (
        <>
          <h3>Change the schedule</h3>
          <form
            className="m2-form6"
            aria-label="Change the schedule"
            onSubmit={(e) => {
              e.preventDefault();
              if (dirty && scheduleValid(value)) save();
            }}
          >
            <ScheduleFields value={value} onChange={setEdit} />
            <div className="m2-acts">
              <button type="submit" className="m2-btn m2-strong" disabled={!dirty || !scheduleValid(value) || pending !== null}>
                {pending === "save" ? "Saving…" : "Save schedule"}
              </button>
            </div>
          </form>
          <Actions>
            <button type="button" className="m2-btn" disabled={pending !== null} onClick={toggle}>
              {p.active ? "Pause" : "Resume"}
            </button>
            <button type="button" className="m2-btn m2-ghost" aria-expanded={removing} onClick={() => setRemoving((x) => !x)}>
              Delete schedule
            </button>
          </Actions>
          {removing ? (
            <ConfirmBar
              message="The object is no longer extracted on a schedule. Its extraction log goes with it; runs and findings already analysed stay."
              confirmLabel="Delete schedule"
              pending={pending === "remove"}
              onConfirm={remove}
              onCancel={() => setRemoving(false)}
            />
          ) : null}
        </>
      ) : (
        <Gate>Changing, pausing and deleting a schedule needs the manage systems permission.</Gate>
      )}
      {outcome ? (
        <p className="m2-result" role="status" data-tone={outcome.tone} data-testid="action-result">
          <span className="m2-result-t">{outcome.title}</span>
          {outcome.detail ? <span>{outcome.detail}</span> : null}
        </p>
      ) : null}
      <p className="m2-prov">
        <V2Link href={`/v2/s/${system}?tab=schedules`}>All schedules of the system</V2Link>
      </p>
    </>
  );
}

/** `?open=syncschedule:<system>:<profile>`: one extraction schedule, its timetable and mode, pause, resume and delete. */
export function ScheduleInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const at = id.indexOf(":");
  const system = at > 0 ? id.slice(0, at) : "";
  const profile = at > 0 ? id.slice(at + 1) : "";
  return (
    <InspectorFrame title="Schedule" status="Extraction schedule" onClose={onClose}>
      {system && profile ? <Body system={system} profileId={profile} onClose={onClose} /> : <EmptyFrame>This address does not name a schedule.</EmptyFrame>}
    </InspectorFrame>
  );
}
