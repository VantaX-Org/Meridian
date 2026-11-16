"use client";

/**
 * Baseline, archive, report and scope actions of one run, as the v2 run page had them. POST /versions/{id}/baseline,
 * /versions/archive, /versions/restore, /versions/{id}/analyse, /systems/{id}/versions/{v}/split-scope, the run report
 * and the findings export.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Code, useToast } from "../kit";
import { exportFindings } from "@/lib/api/findings";
import type { DownloadScope } from "@/lib/api/system-objects";
import { analyseRun, archiveRuns, cappedReads, downloadRunReport, pinBaseline, restoreRuns, splitScope, type SplitScope, type VersionHead } from "@/lib/api/v2/runs";
import { baselineRefusalOf, type BaselineRefusal } from "@/lib/api/v2/step9";
import { formatInt } from "@/lib/format";
import { t } from "@/lib/v2/i18n";
import { useV2Session } from "@/lib/v2/hooks";
import { moduleText } from "@/lib/v2/labels";
import { useVersionsPage } from "@/lib/v2/runs-queries";
import { breachWords } from "@/lib/v2/step9";
import "./runs.css";

/** One smaller scope as words: its date window, or the codes it covers. */
export function scopePart(s: DownloadScope, by: string): string {
  if (by === "dates") return t("{from} to {to}", { from: s.date_from ?? "", to: s.date_to ?? "" });
  return ((s as Record<string, unknown>)[by] as string[] | undefined)?.join(", ") ?? "";
}

export function RunAdmin({ head, old }: { head: VersionHead; old: boolean }) {
  const id = head.id;
  const session = useV2Session();
  const canChange = session.can("analyse");
  const canExport = session.can("export");
  const canSplit = session.can("trigger_sync");
  const qc = useQueryClient();
  const toast = useToast();
  const page = useVersionsPage({ limit: 200 });
  const [busy, setBusy] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<BaselineRefusal | null>(null);
  const [reason, setReason] = useState("");
  const [split, setSplit] = useState<SplitScope | null>(null);

  const systemId = head.metadata?.system_id ?? null;
  const baseline = Boolean(head.metadata?.baseline);
  const archived = Boolean(head.metadata?.archived);
  const reads = cappedReads(head.metadata ?? null);
  const rank = (page.data?.versions ?? []).findIndex((r) => r.id === id);
  const older = rank >= 0 ? (page.data?.total ?? 0) - rank - 1 : 0;
  const off = busy !== null;

  const act = async (what: string, job: () => Promise<string | null>, fail: string) => {
    setBusy(what);
    try {
      const text = await job();
      if (text) toast({ text, tone: "good" });
      for (const k of ["v2", "next", "jobs"]) void qc.invalidateQueries({ queryKey: [k] });
    } catch {
      toast({ text: fail, tone: "bad" });
    } finally {
      setBusy(null);
    }
  };

  const pin = () => void act("pin", async () => {
    try {
      const r = await pinBaseline(id, !baseline);
      setRefusal(null);
      return r.baseline
        ? `${t("Pinned as the baseline")}. ${t("Later runs of this system compare with it by default.")}`
        : `${t("Baseline unpinned")}. ${t("Later runs compare with the run before them.")}`;
    } catch (e) {
      const r = baselineRefusalOf(e);
      if (!r) throw e;
      setRefusal(r);
      toast({ text: `${t("Not pinned")}. ${r.detail}`, tone: "bad" });
      return null;
    }
  }, t("The baseline could not be changed."));

  const pinAnyway = () => void act("force", async () => {
    await pinBaseline(id, true, { reason: reason.trim() });
    setRefusal(null);
    setReason("");
    return `${t("Pinned as the baseline, with the breach on record")}. ${t("The reason and the breaches it overrode are in the audit log.")}`;
  }, t("The baseline could not be changed."));

  const readWords = reads.map((r) =>
    r.rows != null && r.source_rows != null ? t("{table}: {rows} of {total} rows", { table: r.table, rows: formatInt(r.rows), total: formatInt(r.source_rows) })
      : r.rows != null ? t("{table}: {rows} rows read, total not counted", { table: r.table, rows: formatInt(r.rows) })
      : t("{table}: total not counted", { table: r.table }),
  ).join("; ");

  return (
    <section className="nx-card" aria-label={t("Baseline, archive and reports")} data-testid="run-admin">
      <h3 className="nx-rn-h3">{t("Baseline, archive and reports")}</h3>
      {baseline ? <p className="nx-rn-chips"><Code code="baseline" text={t("Pinned as the baseline")} /></p> : null}
      {archived ? <p className="nx-rn-chips"><Code code="archived" text={t("archived")} /></p> : null}
      {reads.length ? (
        <p role="status" className="nx-rn-note" data-testid="run-capped" title={t("These tables reached the row cap, so the scores cover only the rows read. Raise MERIDIAN_EXTRACT_MAX_ROWS or narrow the scope and run again.")}>
          {t("Read capped: {tables}", { tables: reads.map((r) => r.table).join(", ") })}. {t("Partial score: the read stopped at the row cap, so only the rows read are scored.")} {readWords}
        </p>
      ) : null}
      <p className="nx-rn-pager">
        <Button disabled={!canChange || off} loading={busy === "pin"} onClick={pin} data-testid="run-pin">
          {baseline ? t("Unpin baseline") : t("Pin as baseline")}
        </Button>
        {archived ? (
          <Button disabled={!canChange || off} loading={busy === "restore"} data-testid="run-restore"
            onClick={() => void act("restore", async () => { const r = await restoreRuns(); return `${t("{restored} {restored, plural, one {run} other {runs}} restored", { restored: r.restored })}. ${t("Every archived run is back in the lists.")}`; }, t("The runs could not be restored."))}>
            {t("Restore archived runs")}
          </Button>
        ) : (
          <Button disabled={!canChange || off || older === 0} reason={older === 0 ? t("No run is older than this one") : undefined} loading={busy === "archive"} data-testid="run-archive"
            onClick={() => void act("archive", async () => { const r = await archiveRuns(rank + 1); return `${t("{archived} older {archived, plural, one {run} other {runs}} archived", { archived: r.archived })}. ${t("Nothing is deleted: findings, reports and history stay, and Restore brings the runs back.")}`; }, t("The runs could not be archived."))}>
            {older > 0 ? t("Archive the {older} older {older, plural, one {run} other {runs}}", { older }) : t("Archive older runs")}
          </Button>
        )}
        <Button disabled={off} loading={busy === "report"} data-testid="run-report"
          onClick={() => void act("report", async () => { await downloadRunReport(id); return session.fixture ? `${t("Fixture mode: no file is produced")}. ${t("Outside fixture mode this saves the run's report.")}` : `${t("Report downloading")}. ${t("The browser saves it when the file is ready.")}`; }, t("The file could not be downloaded. Try again."))}>
          {t("Download report")}
        </Button>
        {canExport ? (
          <Button disabled={off} loading={busy === "findings"} data-testid="run-findings-export"
            onClick={() => void act("findings", async () => {
              if (session.fixture) return `${t("Fixture mode: no file is produced")}. ${t("Outside fixture mode this saves every finding of the run as an Excel file.")}`;
              await exportFindings("xlsx", { version_id: id });
              return `${t("Findings downloading")}. ${t("The browser saves the Excel file when it is ready.")}`;
            }, t("The file could not be downloaded. Try again."))}>
            {t("Export findings")}
          </Button>
        ) : null}
        <Button disabled={!canChange || off || old} reason={old ? t("Open the current run to act") : undefined} loading={busy === "analyse"} data-testid="run-analyse"
          onClick={() => void act("analyse", async () => { await analyseRun(id); return `${t("Analysis started")}. ${t("This run's stored data is being scored again with the rules as they are now. Its findings are replaced when it finishes.")}`; }, t("The step could not be retried."))}>
          {t("Score again")}
        </Button>
        {reads.length && systemId && canSplit ? (
          <Button disabled={off || old} reason={old ? t("Open the current run to act") : undefined} loading={busy === "split"} data-testid="run-split" title={t("Split this run's scope into smaller scopes that each read under the row cap")}
            onClick={() => void act("split", async () => { setSplit(await splitScope(systemId, id, false)); return null; }, t("The scope could not be split."))}>
            {t("Split scope")}
          </Button>
        ) : null}
      </p>
      {reads.length && systemId && !canSplit ? <p className="nx-rn-sub">{t("Splitting the scope needs the trigger sync permission.")}</p> : null}
      {split && systemId ? (
        <div data-testid="run-split-preview">
          <p className="nx-rn-sub">{t("{n} smaller scopes", { n: split.scopes.length })}. {t("Each scope is one download, scored when it finishes. Check them, then start the downloads.")}</p>
          <ol className="nx-rn-sub">
            {split.scopes.map((s, i) => <li key={i}>{scopePart(s, split.split_by)}</li>)}
          </ol>
          <p className="nx-rn-pager">
            <Button variant="primary" disabled={off} loading={busy === "split-start"} data-testid="run-split-start"
              onClick={() => void act("split-start", async () => { const r = await splitScope(systemId, id, true); setSplit(null); return `${t("{n} downloads started", { n: r.downloads?.length ?? 0 })}. ${t("Each smaller scope is read and scored as a run of its own.")}`; }, t("The downloads could not be started."))}>
              {t("Start {n} downloads", { n: split.scopes.length })}
            </Button>
            <Button disabled={off} onClick={() => setSplit(null)}>{t("Cancel")}</Button>
          </p>
        </div>
      ) : null}
      {refusal ? (
        <div role="alert" className="nx-rn-note" data-testid="pin-refusal">
          <p>{refusal.detail}</p>
          <ul>
            {refusal.breaches.map((b, i) => (
              <li key={`${b.contract_id ?? ""}:${b.module ?? ""}:${b.metric}:${i}`}>
                {b.module ? t("{name}, {object}", { name: b.name ?? t("Data contract"), object: moduleText(b.module) }) : (b.name ?? t("Data contract"))}: {breachWords(b)}
              </li>
            ))}
          </ul>
          {canChange ? (
            <p className="nx-rn-pager">
              <label className="nx-field">
                <span className="nx-rn-sr">{t("Why this run is pinned anyway")}</span>
                <input className="nx-input" placeholder={t("Why pin it anyway (audited)")} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
              <Button variant="primary" disabled={off || !reason.trim()} loading={busy === "force"} onClick={pinAnyway}>{t("Pin anyway")}</Button>
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
