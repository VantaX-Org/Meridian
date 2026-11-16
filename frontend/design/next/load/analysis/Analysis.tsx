"use client";

/** The analysis tab of Load: whether the records would load into the target, per run, with the field map, templates and the post-load check. */
import "./analysis.css";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { deleteMigrationRun, getMigrationRuns, getReconciliation, type MigrationRun } from "@/lib/api/v2/migration";
import { AnalysisFlow } from "@/design/next/flows/AnalysisFlow";
import { formatDate, formatModuleName } from "@/lib/format";
import { useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { useLandscape } from "@/lib/v2/queries";
import { f1, int } from "@/lib/v2/score";
import { Button, Confirm, EmptyState, ErrorState, Sheet, Skeleton, useToast } from "../../kit";
import { About, Banner, Disclose, Panel } from "../parts";
import { PairedTrio } from "../PairedTrio";
import { RunDetail } from "./Detail";
import { FieldMapPanel } from "./FieldMap";
import { StartForm } from "./Start";
import { TemplateLibraryPanel } from "./Templates";
import { TargetWorkbookPanel } from "./Workbook";
import { MODE, STATUS_TEXT, Table, VERDICT, VERDICT_TEXT, analysed, status, useMig } from "./shared";

const busyRun = (r: MigrationRun) => r.status === "queued" || r.status === "running";

export function Analysis() {
  const [poll, setPoll] = useState<number | false>(false);
  const runs = useMig(["runs"], async () => {
    const r = await getMigrationRuns();
    setPoll(r.runs.some(busyRun) ? 10_000 : false);
    return r;
  }, true, poll);
  const [picked, setPicked] = useUrlParam<string>("run", "");
  // A cleaned re-upload links here with ?start=1&system=&source_version= so the start sheet opens on that run.
  const [startParam, setStartParam] = useUrlParam<string>("start", "");
  const [startSystem] = useUrlParam<string>("system", "");
  const [startVersion] = useUrlParam<string>("source_version", "");
  const [flow, setFlow] = useState(false);
  const firstDone = runs.data?.runs.find((r) => analysed(r)) ?? null;
  const recon = useMig(["recon", firstDone?.id], () => getReconciliation(firstDone?.id ?? ""), firstDone !== null);
  const [removing, setRemoving] = useState<MigrationRun | null>(null);
  const { can, shared, viewAs } = useV2Session();
  const land = useLandscape(null);
  const toast = useToast();
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => deleteMigrationRun(id),
    onSuccess: () => { toast({ text: t("Analysis deleted"), tone: "good" }); setRemoving(null); setPicked(""); void qc.invalidateQueries({ queryKey: ["migration"] }); },
    onError: (e) => { setRemoving(null); toast({ text: errorSentence(e, t("The analysis could not be deleted.")), tone: "bad" }); },
  });

  if (runs.isPending) return <Skeleton lines={6} />;
  if (runs.isError) {
    return status(runs.error) === 403 ? <EmptyState heading={t("Your role cannot read the migration analyses.")} /> : (
      <ErrorState sentence={t("The migration analyses could not be read.")} onRetry={() => void runs.refetch()} />
    );
  }
  const list = runs.data.runs;
  const latest = list.find((r) => analysed(r)) ?? null;
  const current = list.find((r) => r.id === picked) ?? latest;
  // Step 3 (load) ends when the files are exported or a reconciliation exists; step 4 (check) when it is accepted.
  const rc = recon.data;
  const step = !latest ? 0 : (latest.records_blocked ?? 0) > 0 ? 1 : rc?.accepted_at ? 4 : rc || latest.status === "exported" ? 3 : 2;
  const starting = startParam === "1";
  const actions = can("analyse") ? (
    <>
      <Button variant="primary" aria-expanded={flow} data-testid="mig-run-analysis" onClick={() => setFlow(true)}>{t("Run analysis")}</Button>
      <Button variant="secondary" aria-expanded={starting} data-testid="mig-start-open" onClick={() => setStartParam("1")}>{t("Start an analysis")}</Button>
    </>
  ) : undefined;
  const when = (r: MigrationRun) => formatDate(r.created_at, "datetime");
  return (
    <>
      {latest ? (
        <Banner
          eyebrow={t("Migration analysis of {date}", { date: formatDate(latest.completed_at ?? latest.created_at, "date") })}
          verdict={latest.readiness_verdict ? VERDICT[latest.readiness_verdict] : undefined}
          headline={latest.readiness_verdict ? VERDICT_TEXT[latest.readiness_verdict]() : t("No verdict")}
          why={t("{blocked} of {total} records would not load, with {n} critical gaps.", { blocked: int(latest.records_blocked), total: int(latest.records_total), n: int(latest.critical_count) })}
          figs={[
            { label: t("Readiness"), value: f1(latest.readiness_score) },
            { label: t("Records that would not load"), value: int(latest.records_blocked) },
            { label: t("Objects"), value: int(latest.modules.length), note: MODE[latest.mode]?.() },
          ]}
          action={actions}
          testId="mig-banner"
        />
      ) : (
        <Banner eyebrow={t("Migration analysis")} headline={t("No analysis has finished yet")} why={t("Start one to see which records would not load into the target system.")} figs={[]} action={actions} testId="mig-banner" />
      )}
      <About
        shows={t("Each analysis checks whether your records would load into the target system, and compares the quality of every object before and after.")}
        steps={[t("Start an analysis"), t("Fix what would not load"), t("Load into the target"), t("Check the result")]}
        current={step}
        means={[
          [t("Readiness"), t("A score from 0 to 100 for how ready the records are to load.")],
          [t("Records that would not load"), t("Records the target system would reject, so they need fixing first.")],
          [t("Source, projected and actual"), t("Quality in the old system, the score the load should reach, and the score measured in the target after loading.")],
        ]}
        next={step === 2 ? <Link href="/load/plan">{t("Open the load plan")}</Link> : step === 3 ? <a href="#mig-post-load">{t("Check the result")}</a> : undefined}
      />
      {can("analyse") ? (
        <>
          <Sheet open={flow} onClose={() => setFlow(false)} title={t("Run analysis")}>
            <AnalysisFlow systems={(land.data?.systems ?? []).map((s) => ({ id: s.id, name: s.name }))} objects={(land.data?.objects ?? []).map((o) => o.module)} onDone={() => { setFlow(false); void qc.invalidateQueries({ queryKey: ["migration"] }); }} />
          </Sheet>
          <Sheet open={starting} onClose={() => setStartParam("")} title={t("Start an analysis")} meta={t("Starting an analysis only checks your records. The page updates by itself while it runs.")}>
            <StartForm onDone={() => setStartParam("")} initialSystem={startSystem} initialVersion={startVersion} />
          </Sheet>
        </>
      ) : null}
      <Confirm
        open={removing !== null}
        title={removing ? t("Delete the analysis of {d}", { d: when(removing) }) : ""}
        consequence={t("The analysis, its gaps, load files and reconciliations are removed, with the stored copies of the records. This cannot be undone.")}
        confirmLabel={t("Delete the analysis")}
        danger
        blocked={remove.isPending ? t("Working") : undefined}
        onCancel={() => setRemoving(null)}
        onConfirm={() => { if (removing) remove.mutate(removing.id); }}
      />
      <TargetWorkbookPanel />
      <TemplateLibraryPanel />
      <Disclose summary={t("Quality in the source and in the target")}><PairedTrio /></Disclose>
      <Disclose summary={t("All analyses")} open={!latest}>
        <Panel title={t("Analyses")} meta={t("{n} analyses, newest first", { n: int(list.length) })} testId="mig-runs">
          {list.length === 0 ? <EmptyState heading={t("No analysis has been started.")} /> : (
            <Table<MigrationRun>
              rows={list}
              rowKey={(r) => r.id}
              rowLabel={when}
              caption={t("Analyses")}
              columns={[
                {
                  id: "started", label: t("Started"), cell: (r) => (
                    <>
                      {analysed(r) ? (
                        <Button variant="quiet" size={32} aria-pressed={r.id === current?.id} aria-label={t("Open the analysis of {d}", { d: when(r) })} onClick={() => setPicked(r.id)}>{when(r)}</Button>
                      ) : when(r)}
                      <div className="nx-ld-meta">{MODE[r.mode]?.() ?? r.mode}</div>
                    </>
                  ),
                },
                { id: "objects", label: t("Objects"), cell: (r) => r.modules.map(formatModuleName).join(", ") },
                {
                  id: "status", label: t("Status"), cell: (r) => (
                    <>
                      {analysed(r) && r.readiness_verdict ? VERDICT_TEXT[r.readiness_verdict]() : STATUS_TEXT[r.status]?.() ?? r.status}
                      {r.status === "failed" && r.error_detail ? <div className="nx-ld-meta">{r.error_detail}</div> : null}
                      {analysed(r) ? <div className="nx-ld-meta">{t("Readiness {s}, {n} would not load", { s: f1(r.readiness_score), n: int(r.records_blocked) })}</div> : null}
                      {can("analyse") && !shared && !viewAs && !busyRun(r) ? (
                        <div><Button variant="secondary" size={32} aria-label={t("Delete the analysis of {d}", { d: when(r) })} onClick={() => setRemoving(r)}>{t("Delete")}</Button></div>
                      ) : null}
                    </>
                  ),
                },
              ]}
            />
          )}
        </Panel>
      </Disclose>
      {current && analysed(current) ? <RunDetail run={current} /> : null}
      <FieldMapPanel modules={current?.modules ?? []} release={current?.target_release === "ecc6" ? "ecc6" : "s4hana"} />
    </>
  );
}
