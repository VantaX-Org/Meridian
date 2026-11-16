"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Job, JobKind } from "@/types/jobs";
import { formatDate } from "@/lib/format";
import { useOpenItem } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { JOB_KIND_LABEL, JOB_STATUS_LABEL, jobObject, jobSeconds } from "@/lib/v2/jobs";
import { useLandscape } from "@/lib/v2/queries";
import { useV2Jobs } from "@/lib/v2/runs-queries";
import { Chip, DataTable, LargeTitle, type Column } from "../kit";
import "./runs.css";

const KINDS: JobKind[] = ["extraction", "analysis", "config_load", "config_sync", "upload", "simulation", "process_discovery"];
const TONE = { running: "warn", queued: "warn", failed: "bad", completed: "resolved" } as const;

/** "2 m 5 s", as the job inspector says it. */
export function took(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? `${m} m ${s} s` : `${s} s`;
}

/** Jobs of the last 7 days, every kind, filtered by kind and state; a row opens the job inspector. */
export function Jobs() {
  const router = useRouter();
  const jobs = useV2Jobs();
  const land = useLandscape(null).data;
  const { hrefFor } = useOpenItem();
  const [kind, setKind] = useState("all");
  const [state, setState] = useState("all");
  const active = (j: Job) => j.status === "queued" || j.status === "running";
  const rows = jobs.jobs.filter((j) => (kind === "all" || j.kind === kind) && (state === "all" || (state === "active" ? active(j) : j.status === state)));
  const sys = (j: Job) => land?.systems.find((s) => s.id === j.system_id)?.name;

  const columns: Column<Job>[] = [
    { id: "job", label: t("Job"), cell: (j) => JOB_KIND_LABEL[j.kind] },
    { id: "object", label: t("Object"), cell: (j) => jobObject(j) },
    { id: "system", label: t("System"), cell: (j) => sys(j) ?? "" },
    { id: "state", label: t("State"), cell: (j) => <Chip tone={TONE[j.status as keyof typeof TONE] ?? "neutral"}>{JOB_STATUS_LABEL[j.status]}</Chip> },
    { id: "progress", label: t("Progress"), align: "end", cell: (j) => (active(j) ? `${Math.round(j.percent)}%` : j.status === "completed" ? "100%" : "") },
    { id: "started", label: t("Started"), cell: (j) => formatDate(j.started_at * 1000, "datetime"), compare: (a, b) => a.started_at - b.started_at },
    { id: "took", label: t("Took"), align: "end", cell: (j) => { const s = jobSeconds(j); return s == null ? "" : took(s); } },
  ];

  return (
    <div className="nx-rn-page" data-testid="jobs-page">
      <LargeTitle title={jobs.active.length ? t("Jobs ({activeCount} running)", { activeCount: jobs.active.length }) : t("Jobs")} />
      <div className="nx-rn-filters" role="group" aria-label={t("Jobs")}>
        <Link className="nx-rn-link" href="/runs">{t("Runs")}</Link>
        <label>{t("Kind")}
          <select value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">{t("Every kind")}</option>
            {KINDS.map((k) => <option key={k} value={k}>{JOB_KIND_LABEL[k]}</option>)}
          </select>
        </label>
        <label>{t("State")}
          <select value={state} onChange={(e) => setState(e.target.value)}>
            <option value="all">{t("Any state")}</option>
            <option value="active">{t("Queued or running")}</option>
            <option value="completed">{t("Done")}</option>
            <option value="failed">{t("Failed")}</option>
          </select>
        </label>
      </div>
      <DataTable<Job>
        key={`${kind}-${state}`}
        rows={rows}
        columns={columns}
        rowKey={(j) => j.id}
        rowLabel={(j) => `${JOB_KIND_LABEL[j.kind]} ${jobObject(j)}`}
        caption={t("Jobs")}
        onOpenRow={(j) => router.push(hrefFor({ kind: "job", id: j.id }))}
        loading={jobs.isLoading}
        error={jobs.isError ? { sentence: t("The jobs could not be read."), onRetry: () => void jobs.refetch() } : undefined}
        empty={{ heading: jobs.jobs.length === 0 ? t("No job has run in the last 7 days.") : t("No job matches these filters.") }}
      />
    </div>
  );
}
