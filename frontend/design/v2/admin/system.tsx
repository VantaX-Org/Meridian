"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Job } from "@/types/jobs";
import * as api from "@/lib/api/v2/admin";
import { useFixture } from "@/lib/api/v2/fixture";
import { formatDate } from "@/lib/format";
import { useOpenItem } from "@/lib/v2/hooks";
import { refreshAdmin, useDoctor, useHealth, useUpdateStatus } from "@/lib/v2/admin-queries";
import { JOB_KIND_LABEL, JOB_STATUS_LABEL, jobDoing, jobSeconds } from "@/lib/v2/jobs";
import { useV2Jobs } from "@/lib/v2/runs-queries";
import { type GridColumn } from "../Grid";
import { EmptyFrame, ErrorFrame, Mono } from "../parts";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { AdminPage, Block, Confirm, Fld, Kv, Loaded, Note, StatusWord, useCan } from "./kit";
import { ToolGrid } from "../GridTools";
import { DiagnosticsBlock } from "./enterprise";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";

const JOB_TONE: Record<Job["status"], "go" | "at-risk" | "no-go" | "neutral"> = { queued: "neutral", running: "at-risk", completed: "go", failed: "no-go" };
const DOCTOR_TONE = { ok: "go", warn: "at-risk", fail: "no-go" } as const;
const DOCTOR_WORD = { get ok() { return t("Passing"); }, get warn() { return t("Warning"); }, get fail() { return t("Failing"); } } as const;

const dur = (s: number | null): string => (s == null ? "—" : s < 60 ? `${s} s` : s < 3600 ? t("{floor} min {value} s", { floor: Math.floor(s / 60), value: s % 60 }) : t("{floor} h {floor2} min", { floor: Math.floor(s / 3600), floor2: Math.floor((s % 3600) / 60) }));

const JOB_COLUMNS: GridColumn<Job>[] = [
  { id: "job", get header() { return t("Job"); }, width: 300, pin: true, locked: true, cell: (j) => jobDoing(j) },
  { id: "kind", get header() { return t("Kind"); }, width: 150, cell: (j) => JOB_KIND_LABEL[j.kind] ?? labelText(j.kind) },
  { id: "status", get header() { return t("Status"); }, width: 120, cell: (j) => <StatusWord tone={JOB_TONE[j.status]}>{JOB_STATUS_LABEL[j.status]}</StatusWord> },
  { id: "started", get header() { return t("Started"); }, width: 170, cell: (j) => formatDate(j.started_at * 1000, "datetime") },
  { id: "dur", get header() { return t("Duration"); }, width: 110, numeric: true, cell: (j) => dur(jobSeconds(j)) },
  { id: "msg", get header() { return t("Detail"); }, width: 320, cell: (j) => (j.status === "failed" ? (j.error ?? j.message) : j.message) || "—" },
];

function Update() {
  const can = useCan();
  const qc = useQueryClient();
  const fixture = useFixture();
  const manage = can("manage_system");
  const q = useUpdateStatus(manage);
  const health = useHealth();
  const { outcome, pending, run } = useOutcome();
  const [ask, setAsk] = useState(false);
  const [watching, setWatching] = useState(false);
  const progress = useQuery({ queryKey: ["v2", "admin", fixture, "system", "progress"], queryFn: api.getUpdateProgress, enabled: manage && watching, refetchInterval: watching ? 3000 : false, retry: false });
  const state = progress.data?.status;
  const finished = state === "done" || state === "failed" || state === "rolled_back";
  const live = watching && !finished;
  useEffect(() => {
    if (watching && finished) void refreshAdmin(qc, "system");
  }, [watching, finished, qc]);
  const s = q.data;
  return (
    <Block title={t("Platform version")} hint={t("The version this deployment runs, and whether Meridian HQ knows a newer one.")}>
      {manage ? (
        <Loaded q={q} what={t("The update status")} rows={2}>
          {(u) => (
            <>
              <Kv
                rows={[
                  [t("Running"), <Mono key="r">{u.current_version}</Mono>],
                  [t("Latest"), u.update_available ? <span key="l"><Mono>{u.latest_version}</Mono>{" "}<StatusWord tone="at-risk">{t("Update available")}</StatusWord></span> : <StatusWord tone="go">{t("Up to date")}</StatusWord>],
                  [t("Updater"), u.updater_configured ? t("Set up on this deployment") : t("Not set up on this deployment")],
                  [t("Model"), health.data ? `${health.data.llm_provider}, ${health.data.llm_connected ? t("connected") : t("not connected")}` : "—"],
                  [t("Email"), health.data ? (health.data.email_backend ? String(health.data.email_backend) : t("No email backend configured")) : "—"],
                ]}
              />
              {u.update_available && u.release_notes ? <p className="m2-anote">{u.release_notes}</p> : null}
              {u.update_available && !u.updater_configured ? <Note tone="warn">{t("Version {latest_version} is available, but automatic updates are not set up on this deployment. Run the update script, or contact support.", { latest_version: u.latest_version })}</Note> : null}
            </>
          )}
        </Loaded>
      ) : (
        <Kv rows={[[t("Running"), health.data ? <Mono key="v">{health.data.version}</Mono> : "—"], [t("Updates"), t("Running an update needs the manage system permission.")]]} />
      )}
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      {watching && state ? (
        <p className="m2-prov" role="status">
          {t("Update {state}{value}.", { state, value: progress.data?.message ? `: ${progress.data.message}` : "" })}
        </p>
      ) : null}
      {manage && s?.update_available && s.updater_configured ? (
        <div className="m2-adm-acts">
          <button type="button" className="m2-btn m2-next" disabled={pending !== null || live} onClick={() => setAsk(true)}>
            {live ? t("Updating…") : t("Update to {latest_version}", { latest_version: s.latest_version })}
          </button>
        </div>
      ) : null}
      {ask && s ? (
        <Confirm
          title={t("Update to {latest_version}", { latest_version: s.latest_version })}
          body={t("The services restart one after another and the database migrates. Screens may be unavailable for a few minutes. If a step fails, the previous version is restored.")}
          confirm={t("Run the update")}
          pending={pending === "update"}
          onCancel={() => setAsk(false)}
          onConfirm={() =>
            void run("update", async () => {
              const r = await api.triggerUpdate();
              setAsk(false);
              setWatching(true);
              return r.status === "started" ? { tone: "ok", title: t("Update started"), detail: t("Progress shows here; the job line follows it too.") } : { tone: "info", title: t("An update is already running"), detail: t("Progress shows here.") };
            })
          }
        />
      ) : null}
    </Block>
  );
}

function Doctor() {
  const can = useCan();
  const q = useDoctor(can("manage_system"));
  if (!can("manage_system")) return null;
  return (
    <Block title={t("Health checks")} hint={t("Each check says what it found and what needs fixing. They refresh every 30 seconds.")}>
      <Loaded q={q} what={t("The health checks")} rows={3}>
        {(d) => {
          const items = d.items.filter((i) => i.id !== "llm");
          const warn = items.filter((i) => i.status === "warn").length;
          const fail = items.filter((i) => i.status === "fail").length;
          return (
            <>
              <p className="m2-prov" role="status" style={{ marginTop: 0 }}>{t("{count} passing{value}{value2}. Last checked {last_checked}.", { count: items.length - warn - fail, value: warn ? t(", {warn} warning", { warn }) : "", value2: fail ? t(", {fail} failing", { fail }) : "", last_checked: formatDate(d.last_checked, "datetime") })}</p>
              <div className="m2-frame" tabIndex={0}>
                <table className="m2-tbl" aria-label={t("Health checks")}>
                  <thead>
                    <tr>
                      <th scope="col">{t("Check")}</th>
                      <th scope="col">{t("Result")}</th>
                      <th scope="col">{t("Detail")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.id}>
                        <th scope="row">{i.label.replace(/\s*\(\s*\)/g, "")}</th>
                        <td><StatusWord tone={DOCTOR_TONE[i.status]}>{DOCTOR_WORD[i.status]}</StatusWord></td>
                        <td style={{ whiteSpace: "normal" }}>{i.detail ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="m2-adm-acts">
                <button type="button" className="m2-btn" onClick={() => void q.refetch()}>
                  {t("Check again")}
                </button>
              </div>
            </>
          );
        }}
      </Loaded>
    </Block>
  );
}

type JobFilter = "all" | "active" | "failed";

/** Admin › Jobs and system update: what is running, what failed, the platform version and the health checks. */
export function SystemSection() {
  const { openItem, open } = useOpenItem();
  const jobs = useV2Jobs();
  const [filter, setFilter] = useState<JobFilter>("all");
  const [kind, setKind] = useState("");
  const shown = jobs.jobs.filter((j) => (filter === "all" || (filter === "active" ? j.status === "queued" || j.status === "running" : j.status === "failed")) && (!kind || j.kind === kind));
  const kinds = [...new Set(jobs.jobs.map((j) => j.kind))];
  const failed = jobs.jobs.filter((j) => j.status === "failed").length;
  return (
    <AdminPage title={t("Jobs and system update")} lead={t("{activeCount} running or queued, {failed} failed. The newest jobs are kept; open one to read why it stopped and to run it again.", { activeCount: jobs.active.length, failed })}>
      <Block title={t("Jobs")}>
        <div className="m2-fbar" role="search" aria-label={t("Filter jobs")}>
          <Fld label={t("Show")}>
            <select value={filter} onChange={(e) => setFilter(e.target.value as JobFilter)}>
              <option value="all">{t("All jobs")}</option>
              <option value="active">{t("Running or queued")}</option>
              <option value="failed">{t("Failed")}</option>
            </select>
          </Fld>
          <Fld label={t("Kind")}>
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">{t("Any kind")}</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {JOB_KIND_LABEL[k] ?? labelText(k)}
                </option>
              ))}
            </select>
          </Fld>
        </div>
        <ToolGrid<Job>
          toolsTitle={t("Background jobs")}
          id="admin-jobs"
          ariaLabel={t("Jobs")}
          columns={JOB_COLUMNS}
          rows={shown}
          rowId={(j) => j.id}
          loading={jobs.isPending}
          error={jobs.isError ? <ErrorFrame onRetry={() => void jobs.refetch()}>{t("The jobs could not be read.")}</ErrorFrame> : undefined}
          emptyFrame={<EmptyFrame>{jobs.jobs.length ? t("No job matches these filters.") : t("No job has run yet. Extractions, analyses and uploads appear here.")}</EmptyFrame>}
          onOpen={(j) => openItem({ kind: "job", id: j.id })}
          openRowId={open?.kind === "job" ? open.id : null}
          fixedColumns
        />
      </Block>
      <Update />
      <Doctor />
      <DiagnosticsBlock />
    </AdminPage>
  );
}
