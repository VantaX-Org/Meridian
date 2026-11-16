"use client";

/**
 * Upload: the cleaned workbooks go back, Meridian applies the changed values to a copy of the run and scores it.
 * `upload` is the seam for the shared upload panel; without it the step calls the round-trip endpoint itself.
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Button, Code, DropZone, ErrorState, Skeleton, StatCard } from "@/design/next/kit";
import { DIMENSIONS } from "@/lib/api/v2/types";
import { fixtureActive } from "@/lib/api/v2/fixture";
import { fixtureUpload } from "@/lib/api/next/runs-fixture";
import { checksOf, needsParent, rejectedCsv, uploadCleaned, uploadFix, uploadRows, uploadSentence, type RejectedRow, type RoundTripResult } from "@/lib/api/v2/roundtrip";
import { checkSentence, checkWorkbook, flagReason, holdReason, staleRun, STATUS_SENTENCE, worstOf, type UploadCheck, type UploadChecks } from "@/lib/api/v2/upload-checks";
import { downloadCsv } from "@/lib/v2/grid-export";
import { useV2Href, useV2Session } from "@/lib/v2/hooks";
import { useObjectRules } from "@/lib/v2/queries";
import { useCompareRecords, useScoreDelta } from "@/lib/v2/runs-queries";
import { t } from "@/lib/v2/i18n";
import { f1, int } from "@/lib/v2/score";
import type { ObjectRun } from "../useObjectRun";

export const MAX_BYTES = 25 * 1024 * 1024;
export const MAX_ROWS = 200_000;
const ACCEPT = ".xlsx,.xlsm,.csv";

interface Item {
  file: File;
  state: "checking" | "ready" | "too-big" | "wrong-type" | "uploading" | "done" | "failed" | "parent";
  result?: RoundTripResult;
  checks?: UploadCheck[];
  /** Cells the checks flagged, and how many there are in all (the list can be cut). */
  flagged?: UploadChecks["flagged"];
  flaggedTotal?: number;
  error?: string;
  /** What to do about the error, when the API says. */
  fix?: string;
  /** Rows of a rejected upload that matched nothing. */
  rows?: RejectedRow[];
}

/** Rows shown on screen; the download holds every listed row. */
const SHOWN_ROWS = 20;

function RejectedRows({ rows, name }: { rows: RejectedRow[]; name: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="nx-stack" data-testid="rejected-rows">
      <div className="nx-table-scroll">
        <table className="nx-table">
          <caption>{t("Rows that matched nothing in {file}", { file: name })}</caption>
          <thead>
            <tr>
              <th scope="col">{t("Sheet")}</th>
              <th scope="col">{t("Row")}</th>
              <th scope="col">{t("Record key")}</th>
              <th scope="col">{t("Field")}</th>
              <th scope="col">{t("Reason")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, SHOWN_ROWS).map((r, i) => (
              <tr key={`${r.sheet}-${r.row}-${i}`}>
                <td>{r.sheet}</td>
                <td className="nx-num">{r.row ? int(r.row) : ""}</td>
                <td className="nx-mono">{r.key}</td>
                <td className="nx-mono">{r.table && r.field ? `${r.table}.${r.field}` : r.field || r.table}</td>
                <td>{r.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > SHOWN_ROWS ? <p className="nx-muted">{t("Showing {n} of {total} rows. The download has them all.", { n: SHOWN_ROWS, total: int(rows.length) })}</p> : null}
      <Button variant="secondary" size={32} icon="download" onClick={() => downloadCsv(`${name.replace(/\.[^.]+$/, "")}-rejected-rows`, rejectedCsv(rows))}>
        {t("Download the rejected rows")}
      </Button>
    </div>
  );
}

/** Cells the checks flagged: the table, the record key, the field with its description, and why. */
function FlaggedCells({ cells, total }: { cells: NonNullable<UploadChecks["flagged"]>; total: number }) {
  if (cells.length === 0) return null;
  return (
    <div className="nx-stack" data-testid="flagged-cells">
      <div className="nx-table-scroll">
        <table className="nx-table">
          <caption>{t("Flagged cells ({n})", { n: int(total) })}</caption>
          <thead>
            <tr><th scope="col">{t("Table")}</th><th scope="col">{t("Record key")}</th><th scope="col">{t("Field")}</th><th scope="col">{t("Why")}</th></tr>
          </thead>
          <tbody>
            {cells.map((f) => (
              <tr key={`${f.table}|${f.key}|${f.field}`}>
                <td className="nx-mono">{f.table || "-"}</td>
                <td className="nx-mono">{f.key}</td>
                <td><Code code={f.field} text={f.description || undefined} /></td>
                <td>{flagReason(f.reason)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > cells.length ? <p className="nx-muted">{t("Showing {n} of {total}.", { n: int(cells.length), total: int(total) })}</p> : null}
    </div>
  );
}

const signed = (n: number) => `${n > 0 ? "+" : ""}${f1(n)}`;

/** The new score against the run it came from: per dimension, findings fixed, still open and new, and required fields still empty. */
export function BeforeAfter({ after, before, module }: { after: string; before: string; module: string }) {
  const delta = useScoreDelta(before, after, module);
  const records = useCompareRecords(after, before);
  const rules = useObjectRules(module, after);
  const d = delta.data;
  const totals = records.data?.totals;
  const notReady = t("The comparison is not ready");
  const empty = (rules.data ?? []).filter((r) => r.dimension === "completeness" && r.affected_count > 0 && r.field);
  return (
    <section className="nx-stack" aria-label={t("Before and after")} data-testid="before-after">
      {delta.isPending || records.isPending ? <Skeleton lines={4} label={t("Reading the change against the earlier run")} /> : null}
      {delta.isError && records.isError ? (
        <ErrorState sentence={t("The change against the earlier run could not be read.")} error={delta.error} onRetry={() => { void delta.refetch(); void records.refetch(); }} />
      ) : (
        <table className="nx-table">
          <caption>{t("Before and after")}</caption>
          <tbody>
            <tr><th scope="row">{t("Score before")}</th><td className="nx-num">{d ? f1(d.before) : <span className="nx-muted">{notReady}</span>}</td></tr>
            <tr><th scope="row">{t("Score now")}</th><td className="nx-num">{d ? `${f1(d.after)} (${signed(d.delta)})` : <span className="nx-muted">{notReady}</span>}</td></tr>
            {DIMENSIONS.map((dim) => {
              const p = d?.by_dimension.find((x) => x.dimension === dim.key)?.points;
              return <tr key={dim.key} data-testid={`delta-${dim.key}`}><th scope="row">{dim.label}</th><td className="nx-num">{p == null ? <span className="nx-muted">{t("No change recorded")}</span> : signed(p)}</td></tr>;
            })}
            <tr><th scope="row">{t("Findings fixed")}</th><td className="nx-num">{totals ? int(totals.resolved) : <span className="nx-muted">{notReady}</span>}</td></tr>
            <tr><th scope="row">{t("Still open")}</th><td className="nx-num">{totals ? int(totals.persisting) : <span className="nx-muted">{notReady}</span>}</td></tr>
            <tr><th scope="row">{t("New")}</th><td className="nx-num">{totals ? int(totals.new) : <span className="nx-muted">{notReady}</span>}</td></tr>
          </tbody>
        </table>
      )}
      <h3 className="nx-rn-h3">{t("Required fields still empty")}</h3>
      {rules.isPending ? <Skeleton lines={2} label={t("Reading the rules of the new run")} /> : rules.isError ? (
        <ErrorState sentence={t("The rules of this run could not be read.")} error={rules.error} onRetry={() => void rules.refetch()} />
      ) : empty.length === 0 ? (
        <p className="nx-muted" data-testid="no-empty-required">{t("No required field is empty.")}</p>
      ) : (
        <ul data-testid="empty-required">
          {empty.map((r) => (
            <li key={r.check_id}><Code code={r.field as string} text={r.field_description} /> {t("{n} records", { n: int(r.affected_count) })}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Per-check pass, warn or fail list for one file. */
export function CheckList({ checks }: { checks: UploadCheck[] }) {
  return (
    <ul className="nx-checks" aria-label={t("Checks on this workbook")} data-testid="check-list">
      {checks.map((c) => (
        <li key={c.id} data-status={c.status} data-testid={`check-${c.id}`}>
          <span className="nx-checks-state">{STATUS_SENTENCE[c.status]()}</span>
          <span>{checkSentence(c.id)}</span>
          {c.detail ? <span className="nx-muted">{c.detail}</span> : null}
        </li>
      ))}
    </ul>
  );
}

const okType = (f: File) => /\.(xlsx|xlsm|csv)$/i.test(f.name);
const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

/**
 * What the cycle needs from the upload step when it owns the primary action: why the action is off (null when it may go),
 * whether a workbook was already scored, and the action itself, which throws the sentence of a refusal.
 */
export interface UploadGate { hold: string | null; scored: boolean; submit: () => Promise<void> }

export function UploadStep({ o, upload, onScored, onGate }: { o: ObjectRun; upload?: (file: File, parent?: string, confirmWarnings?: boolean, skipFlagged?: boolean) => Promise<RoundTripResult>; onScored: () => void; onGate?: (g: UploadGate) => void }) {
  const can = useV2Session().can("analyse");
  const qc = useQueryClient();
  const [items, setItems] = useState<Item[]>([]);
  const [parent, setParent] = useState<string>("");
  const [confirm, setConfirm] = useState(false);
  const [skip, setSkip] = useState(false);
  const v2href = useV2Href();
  const send = upload ?? ((f: File, p?: string, w?: boolean, s?: boolean) => (fixtureActive() ? Promise.resolve(fixtureUpload(f.name)) : uploadCleaned(f, p, o.module, w, s)));
  const busy = items.some((i) => i.state === "uploading");
  const ready = items.filter((i) => i.state === "ready" || i.state === "parent");
  const failed = items.some((i) => worstOf(i.checks) === "fail");
  const warned = !failed && items.some((i) => i.state !== "done" && worstOf(i.checks) === "warn");
  const checking = items.some((i) => i.state === "checking");
  const askParent = items.some((i) => i.state === "parent");

  const patch = (file: File, p: Partial<Item>) => setItems((cur) => cur.map((c) => (c.file === file ? { ...c, ...p } : c)));
  const verify = async (file: File, p?: string, s = skip) => {
    patch(file, { state: "checking", error: undefined, fix: undefined, rows: undefined });
    try {
      const r: UploadChecks = await checkWorkbook(file, p, o.module, s);
      patch(file, { state: "ready", checks: r.checks, flagged: r.flagged, flaggedTotal: r.flagged_total });
    } catch (e) {
      const c = checksOf(e);
      const need = needsParent(e);
      patch(file, { state: need ? "parent" : c ? "ready" : "failed", checks: c?.checks, error: c ? undefined : need ? undefined : uploadSentence(e, t("The workbook could not be read.")), fix: c || need ? undefined : uploadFix(e) });
    }
  };
  const add = (files: File[]) => {
    const next = files.map((file): Item => ({ file, state: !okType(file) ? "wrong-type" : file.size > MAX_BYTES ? "too-big" : "checking" }));
    setConfirm(false);
    setItems((cur) => [...cur.filter((c) => c.state !== "done"), ...next]);
    next.filter((n) => n.state === "checking").forEach((n) => void verify(n.file));
  };

  const run = async (): Promise<string | null> => {
    let refusal: string | null = null;
    for (const it of ready) {
      setItems((cur) => cur.map((c) => (c === it ? { ...c, state: "uploading", error: undefined, fix: undefined, rows: undefined } : c)));
      try {
        const result = await send(it.file, it.state === "parent" ? parent || undefined : undefined, warned && confirm, skip);
        setItems((cur) => cur.map((c) => (c.file === it.file ? { ...c, state: "done", result } : c)));
      } catch (e) {
        const p = needsParent(e);
        const c = checksOf(e);
        const stale = staleRun(e);
        refusal = stale?.sentence ?? uploadSentence(e, t("The workbook could not be read."));
        setItems((cur) => cur.map((x) => (x.file === it.file ? { ...x, state: p ? "parent" : c ? "ready" : "failed", checks: c?.checks ?? x.checks, error: c ? undefined : refusal ?? undefined, fix: c ? undefined : uploadFix(e), rows: c ? undefined : uploadRows(e) } : x)));
      }
    }
    void qc.invalidateQueries({ queryKey: ["next"] });
    return refusal;
  };

  const canSkip = items.some((i) => i.state !== "done" && (i.flagged ?? []).some((f) => f.table));
  const toggleSkip = (v: boolean) => {
    setSkip(v);
    setConfirm(false);
    items.filter((i) => i.state === "ready").forEach((i) => void verify(i.file, undefined, v));
  };

  const hold = items.length === 0 ? t("Add a workbook first.") : checking ? t("Wait for the checks to finish.") : askParent && !parent ? t("Choose the run the workbook was made from.") : holdReason(items.flatMap((i) => (i.state === "done" ? [] : i.checks ?? [])), confirm);
  const done = items.filter((i) => i.result);
  const scored = done.length > 0 && ready.length === 0;
  // The cycle reads the latest hold and runs the latest submit through a ref, so the gate is only re-sent when it changes.
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    onGate?.({ hold: scored ? null : hold, scored, submit: async () => { const r = await latest.current(); if (r) throw new Error(r); } });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hold, scored]);
  const total = (k: "applied" | "unchanged" | "unmatched") => done.reduce((s, i) => s + (i.result?.[k] ?? 0), 0);
  const skipped = done.reduce((s, i) => s + Object.keys(i.result?.skipped ?? {}).length, 0);
  const last = done[done.length - 1]?.result;
  const lastNumber = last ? o.heads.find((h) => h.id === last.version_id)?.run_number : undefined;
  const parentNumber = last ? o.heads.find((h) => h.id === last.parent_version_id)?.run_number : undefined;

  if (!can) return <p className="nx-note" data-testid="upload-no-right">{t("Only users with the analyse right can upload a cleaned workbook.")}</p>;

  return (
    <div className="nx-stack" data-testid="upload-step">
      <p>{t("Drop the cleaned workbooks. Meridian matches each row to its record by the key columns, applies the changed values to a copy of the run and scores the copy as a new run.")}</p>
      <DropZone onFiles={add} accept={ACCEPT} multiple busy={busy} label={t("Cleaned workbooks")} hint={t("Excel or CSV, up to 25 MB and {rows} rows each", { rows: int(MAX_ROWS) })} />
      {items.length > 0 ? (
        <ul className="nx-preflight" aria-label={t("Files to upload")}>
          {items.map((it) => (
            <li key={`${it.file.name}-${it.file.size}`} className="nx-preflight-card nx-card" data-state={it.state} data-testid="preflight-card">
              <span className="nx-mono">{it.file.name}</span>
              <span className="nx-num nx-muted">{t("{mb} MB", { mb: mb(it.file.size) })}</span>
              <span className="nx-preflight-state">
                {it.state === "checking" ? t("Checking the workbook") : null}
                {it.state === "ready" ? (worstOf(it.checks) === "fail" ? t("Fix the failed checks and upload again.") : t("Ready to upload")) : null}
                {it.state === "too-big" ? t("Larger than 25 MB; split the workbook and upload the parts.") : null}
                {it.state === "wrong-type" ? t("Not an Excel or CSV file.") : null}
                {it.state === "uploading" ? t("Uploading and reading") : null}
                {it.state === "done" ? t("Read") : null}
              </span>
              {it.checks ? <CheckList checks={it.checks} /> : null}
              {it.flagged && it.state !== "done" ? <FlaggedCells cells={it.flagged} total={it.flaggedTotal ?? it.flagged.length} /> : null}
              {it.error ? <p role="alert" className="nx-error-line">{it.error}</p> : null}
              {it.fix ? <p className="nx-note" data-testid="upload-fix">{it.fix}</p> : null}
              {it.rows ? <RejectedRows rows={it.rows} name={it.file.name} /> : null}
              {it.state !== "uploading" ? (
                <Button variant="quiet" size={32} onClick={() => setItems((cur) => cur.filter((c) => c !== it))} aria-label={t("Remove {file}", { file: it.file.name })}>{t("Remove")}</Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {askParent ? (
        <label className="nx-field-label">
          {t("Which run was this workbook made from?")}
          <select className="nx-field" value={parent} onChange={(e) => setParent(e.target.value)} data-testid="parent-picker">
            <option value="">{t("Choose a run")}</option>
            {o.heads.slice(0, 50).map((h) => (
              <option key={h.id} value={h.id}>{t("Run {n}", { n: h.run_number ?? "" })}</option>
            ))}
          </select>
        </label>
      ) : null}
      {canSkip ? (
        <label className="nx-field-label" data-testid="skip-flagged">
          <input type="checkbox" checked={skip} onChange={(e) => toggleSkip(e.target.checked)} /> {t("Leave the flagged cells out and apply the rest")}
        </label>
      ) : null}
      {warned ? (
        <label className="nx-field-label" data-testid="confirm-warnings">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} /> {t("I have read the warnings and want to upload anyway.")}
        </label>
      ) : null}
      {onGate ? null : (
        <Button variant="primary" icon="upload" loading={busy} loadingLabel={t("Uploading and scoring")} disabled={ready.length === 0 || hold !== null} reason={hold ?? undefined} onClick={() => void run()}>
          {t("Upload and score")}
        </Button>
      )}
      {last ? (
        <div className="nx-stack" data-testid="upload-result">
          <div className="nx-tiles">
            <StatCard label={t("Values changed")} value={total("applied")} />
            <StatCard label={t("Already the same")} value={total("unchanged")} />
            <StatCard label={t("Not found in the run")} value={total("unmatched")} />
            <StatCard label={t("Skipped sheets")} value={skipped} />
          </div>
          <p role="status" data-testid="upload-saved">
            {lastNumber !== undefined && parentNumber !== undefined
              ? t("Saved as run {n}, cleaned from run {p}.", { n: lastNumber, p: parentNumber })
              : t("Saved as a new run, cleaned from the run the workbook was made from.")}
          </p>
          <details className="nx-details">
            <summary>{t("What was not read")}</summary>
            <ul>
              {total("unmatched") > 0 ? <li>{t("{n} rows matched no record of the run; check the key columns.", { n: int(total("unmatched")) })}</li> : null}
              {done.flatMap((i) => Object.entries(i.result?.skipped ?? {}).map(([sheet, why]) => <li key={`s-${sheet}`}><span className="nx-mono">{sheet}</span>: {why}</li>))}
              {done.flatMap((i) => Object.entries(i.result?.unmapped ?? {}).map(([sheet, cols]) => <li key={`u-${sheet}`}>{t("Columns not read in {sheet}: {cols}", { sheet, cols: cols.join(", ") })}</li>))}
              {done.flatMap((i) => (i.result?.no_table ?? []).map((x) => <li key={`t-${x}`}>{t("No table called {name} in the run", { name: x })}</li>))}
              {done.flatMap((i) => (i.result?.no_field ?? []).map((x) => <li key={`f-${x}`}>{t("No field called {name} in the run", { name: x })}</li>))}
            </ul>
          </details>
          <BeforeAfter after={last.version_id} before={last.parent_version_id} module={o.module} />
          {o.systemId ? (
            <Link className="nx-link" href={v2href(`/migration?start=1&system=${encodeURIComponent(o.systemId)}&source_version=${encodeURIComponent(last.version_id)}`)} data-testid="upload-to-migration">
              {t("Start a migration from this cleaned version")}
            </Link>
          ) : null}
          <Link className="nx-link" href={`/next/run/${encodeURIComponent(last.version_id)}/agreement`} data-testid="upload-to-agreement">{t("Check the clean file agreement")}</Link>
          {done.map((i) => (i.result?.unmatched_rows?.length ? <RejectedRows key={`r-${i.file.name}`} rows={i.result.unmatched_rows} name={i.file.name} /> : null))}
          {onGate ? null : <Button variant="secondary" onClick={onScored}>{t("See what changed")}</Button>}
        </div>
      ) : null}
    </div>
  );
}
