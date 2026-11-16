"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Job } from "@/types/jobs";
import * as api from "@/lib/api/v2/admin";
import * as ent from "@/lib/api/v2/enterprise";
import { useFixture } from "@/lib/api/v2/fixture";
import { apiErrorMessage } from "@/lib/error";
import { formatDate } from "@/lib/format";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { refreshAdmin, useDoctor, useHealth, useUpdateStatus } from "@/lib/v2/admin-queries";
import { JOB_KIND_LABEL, JOB_STATUS_LABEL, jobDoing, jobSeconds } from "@/lib/v2/jobs";
import { useV2Jobs } from "@/lib/v2/runs-queries";
import { t } from "@/lib/v2/i18n";
import { labelText } from "@/lib/v2/labels";
import { Button, Chip, Confirm, DataTable, useToast, type Column } from "../kit";
import { Notes, OpsBlock, OpsLoaded, OpsPage, TONE, type V2Tone } from "./ops-kit";

const JOB_TONE: Record<Job["status"], V2Tone> = { queued: "neutral", running: "at-risk", completed: "go", failed: "no-go", cancelled: "neutral" };
const DOCTOR_TONE = { ok: "go", warn: "at-risk", fail: "no-go" } as const;
const DOCTOR_WORD = { get ok() { return t("Passing"); }, get warn() { return t("Warning"); }, get fail() { return t("Failing"); } } as const;

const dur = (s: number | null): string => (s == null ? "—" : s < 60 ? `${s} s` : s < 3600 ? t("{floor} min {value} s", { floor: Math.floor(s / 60), value: s % 60 }) : t("{floor} h {floor2} min", { floor: Math.floor(s / 3600), floor2: Math.floor((s % 3600) / 60) }));
const kindText = (k: string) => (JOB_KIND_LABEL as Record<string, string | undefined>)[k] ?? labelText(k);

const jobColumns = (): Column<Job>[] => [
  { id: "job", label: t("Job"), cell: (j) => jobDoing(j) },
  { id: "kind", label: t("Kind"), cell: (j) => kindText(j.kind) },
  { id: "status", label: t("Status"), cell: (j) => <Chip tone={TONE[JOB_TONE[j.status]]}>{JOB_STATUS_LABEL[j.status]}</Chip> },
  { id: "started", label: t("Started"), cell: (j) => formatDate(j.started_at * 1000, "datetime"), compare: (a, b) => a.started_at - b.started_at },
  { id: "dur", label: t("Duration"), align: "end", cell: (j) => dur(jobSeconds(j)) },
  { id: "msg", label: t("Detail"), cell: (j) => (j.status === "failed" ? (j.error ?? j.message) : j.message) || "—" },
];

function Update() {
  const { can } = useV2Session();
  const qc = useQueryClient();
  const toast = useToast();
  const fixture = useFixture();
  const manage = can("manage_system");
  const q = useUpdateStatus(manage);
  const health = useHealth();
  const [ask, setAsk] = useState(false);
  const [starting, setStarting] = useState(false);
  const [watching, setWatching] = useState(false);
  const progress = useQuery({ queryKey: ["v2", "admin", fixture, "system", "progress"], queryFn: api.getUpdateProgress, enabled: manage && watching, refetchInterval: watching ? 3000 : false, retry: false });
  const state = progress.data?.status;
  const finished = state === "done" || state === "failed" || state === "rolled_back";
  const live = watching && !finished;
  useEffect(() => {
    if (watching && finished) void refreshAdmin(qc, "system");
  }, [watching, finished, qc]);
  const s = q.data;
  const start = async () => {
    setStarting(true);
    try {
      const r = await api.triggerUpdate();
      setAsk(false);
      setWatching(true);
      toast(r.status === "started" ? { tone: "good", text: `${t("Update started")}. ${t("Progress shows here; the job line follows it too.")}` } : { text: `${t("An update is already running")}. ${t("Progress shows here.")}` });
    } catch (e) {
      toast({ tone: "bad", text: apiErrorMessage(e) });
    } finally {
      setStarting(false);
    }
  };
  return (
    <OpsBlock
      title={t("Platform version")}
      hint={t("The version this deployment runs, and whether Meridian HQ knows a newer one.")}
      actions={
        manage && s?.update_available && s.updater_configured ? (
          <Button variant="primary" disabled={live} loading={starting} onClick={() => setAsk(true)}>
            {live ? t("Updating…") : t("Update to {latest_version}", { latest_version: s.latest_version })}
          </Button>
        ) : undefined
      }
    >
      {manage ? (
        <OpsLoaded q={q} what={t("The update status")} rows={2}>
          {(u) => (
            <>
              <Notes
                rows={[
                  [t("Running"), <span key="r" className="nx-mono">{u.current_version}</span>],
                  [t("Latest"), u.update_available ? <span key="l"><span className="nx-mono">{u.latest_version}</span>{" "}<Chip tone="warn">{t("Update available")}</Chip></span> : <Chip tone="good">{t("Up to date")}</Chip>],
                  [t("Updater"), u.updater_configured ? t("Set up on this deployment") : t("Not set up on this deployment")],
                  [t("Model"), health.data ? `${health.data.llm_provider}, ${health.data.llm_connected ? t("connected") : t("not connected")}` : "—"],
                  [t("Email"), health.data ? (health.data.email_backend ? String(health.data.email_backend) : t("No email backend configured")) : "—"],
                ]}
              />
              {u.update_available && u.release_notes ? <p className="nx-note">{u.release_notes}</p> : null}
              {u.update_available && !u.updater_configured ? <p className="nx-note" role="status">{t("Version {latest_version} is available, but automatic updates are not set up on this deployment. Run the update script, or contact support.", { latest_version: u.latest_version })}</p> : null}
            </>
          )}
        </OpsLoaded>
      ) : (
        <Notes rows={[[t("Running"), health.data ? <span key="v" className="nx-mono">{health.data.version}</span> : "—"], [t("Updates"), t("Running an update needs the manage system permission.")]]} />
      )}
      {watching && state ? (
        <p className="nx-note" role="status">
          {t("Update {state}{value}.", { state, value: progress.data?.message ? `: ${progress.data.message}` : "" })}
        </p>
      ) : null}
      <Confirm
        open={ask && !!s}
        title={s ? t("Update to {latest_version}", { latest_version: s.latest_version }) : ""}
        consequence={t("The services restart one after another and the database migrates. Screens may be unavailable for a few minutes. If a step fails, the previous images are put back. The database is not restored automatically: a backup taken before the update is kept, and an administrator can restore it.")}
        confirmLabel={t("Run the update")}
        blocked={starting ? t("Working…") : undefined}
        onConfirm={() => void start()}
        onCancel={() => setAsk(false)}
      />
    </OpsBlock>
  );
}

function Doctor() {
  const { can } = useV2Session();
  const q = useDoctor(can("manage_system"));
  if (!can("manage_system")) return null;
  return (
    <OpsBlock title={t("Health checks")} hint={t("Each check says what it found and what needs fixing. They refresh every 30 seconds.")} actions={<Button size={32} onClick={() => void q.refetch()}>{t("Check again")}</Button>}>
      <OpsLoaded q={q} what={t("The health checks")} rows={3}>
        {(d) => {
          const items = d.items.filter((i) => i.id !== "llm");
          const warn = items.filter((i) => i.status === "warn").length;
          const fail = items.filter((i) => i.status === "fail").length;
          return (
            <>
              <p className="nx-note" role="status">{t("{count} passing{value}{value2}. Last checked {last_checked}.", { count: items.length - warn - fail, value: warn ? t(", {warn} warning", { warn }) : "", value2: fail ? t(", {fail} failing", { fail }) : "", last_checked: formatDate(d.last_checked, "datetime") })}</p>
              <DataTable
                caption={t("Health checks")}
                rows={items}
                rowKey={(i) => i.id}
                rowLabel={(i) => i.label}
                columns={[
                  { id: "check", label: t("Check"), cell: (i) => i.label.replace(/\s*\(\s*\)/g, "") },
                  { id: "result", label: t("Result"), cell: (i) => <Chip tone={TONE[DOCTOR_TONE[i.status]]}>{DOCTOR_WORD[i.status]}</Chip> },
                  { id: "detail", label: t("Detail"), cell: (i) => i.detail ?? "—" },
                ]}
              />
            </>
          );
        }}
      </OpsLoaded>
    </OpsBlock>
  );
}

/** Admin > System: the bundle support asks for, as one zip. */
function Diagnostics() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const zip = async () => {
    setBusy(true);
    try {
      const file = await ent.downloadDiagnostics();
      toast({ tone: "good", text: `${t("Saved {file}", { file })}. ${t("Attach it to your support request.")}` });
    } catch (e) {
      toast({ tone: "bad", text: apiErrorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <OpsBlock title={t("Support")} hint={t("The diagnostics bundle holds versions, health checks, recent errors and configuration with every secret removed. It holds no SAP record values.")}>
      <div className="nx-ops-actions">
        <Button loading={busy} loadingLabel={t("Preparing…")} onClick={() => void zip()}>{t("Download diagnostics bundle")}</Button>
      </div>
    </OpsBlock>
  );
}

type JobFilter = "all" | "active" | "failed";

/** Admin > Platform and updates: what is running, what failed, the platform version and the health checks. */
export function OpsPlatform() {
  const { openItem } = useOpenItem();
  const jobs = useV2Jobs();
  const [filter, setFilter] = useState<JobFilter>("all");
  const [kind, setKind] = useState("");
  const shown = jobs.jobs.filter((j) => (filter === "all" || (filter === "active" ? j.status === "queued" || j.status === "running" : j.status === "failed")) && (!kind || j.kind === kind));
  const kinds = [...new Set(jobs.jobs.map((j) => j.kind))];
  const failed = jobs.jobs.filter((j) => j.status === "failed").length;
  return (
    <OpsPage lead={t("{activeCount} running or queued, {failed} failed. The newest jobs are kept; open one to read why it stopped and to run it again.", { activeCount: jobs.active.length, failed })}>
      <OpsBlock title={t("Jobs")}>
        <div className="nx-ops-form" role="search" aria-label={t("Filter jobs")}>
          <label className="nx-field">
            <span>{t("Show")}</span>
            <select className="nx-input" value={filter} onChange={(e) => setFilter(e.target.value as JobFilter)}>
              <option value="all">{t("All jobs")}</option>
              <option value="active">{t("Running or queued")}</option>
              <option value="failed">{t("Failed")}</option>
            </select>
          </label>
          <label className="nx-field">
            <span>{t("Kind")}</span>
            <select className="nx-input" value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">{t("Any kind")}</option>
              {kinds.map((k) => (
                <option key={k} value={k}>{kindText(k)}</option>
              ))}
            </select>
          </label>
        </div>
        <DataTable<Job>
          caption={t("Background jobs")}
          rows={shown}
          rowKey={(j) => j.id}
          rowLabel={(j) => jobDoing(j)}
          columns={jobColumns()}
          loading={jobs.isPending}
          error={jobs.isError ? { sentence: t("The jobs could not be read."), onRetry: () => void jobs.refetch() } : undefined}
          empty={{ heading: jobs.jobs.length ? t("No job matches these filters.") : t("No job has run yet. Extractions, analyses and uploads appear here.") }}
          onOpenRow={(j) => openItem({ kind: "job", id: j.id })}
        />
      </OpsBlock>
      <Update />
      <Doctor />
      <Diagnostics />
    </OpsPage>
  );
}
