"use client";

/** Pull: read the object from its system again. A confirm with the numbers first; while running, progress and cancel. */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Confirm, EmptyState, ProgressBar, useToast } from "@/design/next/kit";
import { V2Link } from "@/design/v2/parts";
import { RunForecast } from "@/design/v2/screens/step10/Prediction";
import { startExtraction } from "@/lib/api/v2/admin";
import { cancelJob } from "@/lib/api/v2/run-ops";
import { uploadSentence } from "@/lib/api/v2/roundtrip";
import { useV2Job } from "@/lib/v2/runs-queries";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import type { ObjectRun } from "../useObjectRun";

function JobProgress({ id, onDone }: { id: string; onDone: (ok: boolean) => void }) {
  const { job } = useV2Job(id);
  const [cancelling, setCancelling] = useState(false);
  const toast = useToast();
  const done = job && (job.status === "completed" || job.status === "failed" || job.status === "cancelled");
  if (done) {
    queueMicrotask(() => onDone(job.status === "completed"));
    return null;
  }
  const rows = job && job.rows_total > 0 ? t("{done} of {total} rows read", { done: int(job.rows_done), total: int(job.rows_total) }) : (job?.message || t("Waiting for the system"));
  return (
    <div className="nx-stack" data-testid="pull-progress">
      <ProgressBar value={job?.percent} label={t("Pull progress")} text={`${job?.stage ?? t("Queued")}: ${rows}`} />
      <p role="status" className="nx-muted">{t("The pull runs on the server; you can leave this page and come back.")}</p>
      <Button
        variant="secondary"
        loading={cancelling}
        loadingLabel={t("Cancelling")}
        onClick={async () => {
          setCancelling(true);
          try {
            await cancelJob(id);
            toast({ text: t("The pull was cancelled.") });
          } catch (e) {
            toast({ text: uploadSentence(e, t("The pull could not be cancelled.")), tone: "bad" });
          } finally {
            setCancelling(false);
          }
        }}
      >
        {t("Cancel the job")}
      </Button>
    </div>
  );
}

export function PullStep({ o }: { o: ObjectRun }) {
  const can = useV2Session().can("trigger_sync");
  const qc = useQueryClient();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [job, setJob] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cell = o.landscape.data?.cells.find((c) => c.system_id === o.systemId && c.module === o.module);

  if (!o.systemId) {
    return (
      <EmptyState heading={t("No system holds {object} yet", { object: o.label })} action={<V2Link className="nx-btn nx-btn-primary" href="/s/new">{t("Connect a system")}</V2Link>}>
        {t("Connect the SAP system that holds this object, then pull it here.")}
      </EmptyState>
    );
  }

  const start = async () => {
    setAsking(false);
    setBusy(true);
    setError(null);
    try {
      const r = await startExtraction(o.systemId as string, [o.module], true, {});
      setJob(r.job_id);
    } catch (e) {
      setError(uploadSentence(e, t("The pull could not start.")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nx-stack" data-testid="pull-step">
      <p>{t("Meridian reads {object} from {system} again and scores it. The new run appears in the run switcher.", { object: o.label, system: o.systemName })}</p>
      {o.heads.length === 0 && !o.runs.isLoading ? <p className="nx-muted">{t("This object has no run yet. The first pull sets the baseline every later run is compared with.")}</p> : null}
      <RunForecast systemId={o.systemId} modules={[o.module]} what="extraction" />
      {job ? (
        <JobProgress
          id={job}
          onDone={(ok) => {
            setJob(null);
            void qc.invalidateQueries({ queryKey: ["next"] });
            toast({ text: ok ? t("The pull finished. The new run is open.") : t("The pull did not finish. Open Runs for the reason."), tone: ok ? "good" : "bad" });
          }}
        />
      ) : can ? (
        <Button variant="primary" loading={busy} loadingLabel={t("Starting")} icon="play" onClick={() => setAsking(true)}>{t("Pull a new run")}</Button>
      ) : (
        <p className="nx-note" data-testid="pull-no-right">{t("Only data stewards can pull a new run. Ask one to pull, or work on the latest run.")}</p>
      )}
      {error ? <p role="alert" className="nx-error">{error}</p> : null}
      <Confirm
        open={asking}
        title={t("Pull {object} from {system}?", { object: o.label, system: o.systemName })}
        consequence={
          <>
            {t("The last run read {records} records and measured {rules} rules.", { records: int(cell?.records_checked ?? 0), rules: int(cell?.rules_measured ?? 0) })}{" "}
            {t("The pull reads the system again and makes run {n}. Nothing in SAP changes.", { n: (o.heads[0]?.run_number ?? 0) + 1 })}
          </>
        }
        confirmLabel={t("Pull now")}
        onConfirm={() => void start()}
        onCancel={() => setAsking(false)}
      />
    </div>
  );
}
