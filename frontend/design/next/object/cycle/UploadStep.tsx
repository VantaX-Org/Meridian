"use client";

/**
 * Upload: the cleaned workbooks go back, Meridian applies the changed values to a copy of the run and scores it.
 * `upload` is the seam for the shared upload panel; without it the step calls the round-trip endpoint itself.
 */
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, DropZone, StatCard } from "@/design/next/kit";
import { fixtureActive } from "@/lib/api/v2/fixture";
import { fixtureUpload } from "@/lib/api/next/runs-fixture";
import { readCleanedRows } from "@/lib/api/next/upload";
import { needsParent, uploadCleaned, uploadSentence, type RoundTripResult } from "@/lib/api/v2/roundtrip";
import { useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { int } from "@/lib/v2/score";
import type { ObjectRun } from "../useObjectRun";
import { CheckList, type CheckRow } from "./CheckList";
import { checkCleaned, gate, tally, type CheckId, type UploadCheck } from "./uploadGate";

export const MAX_BYTES = 25 * 1024 * 1024;
export const MAX_ROWS = 200_000;
const ACCEPT = ".xlsx,.xlsm,.csv";

interface Item {
  file: File;
  state: "ready" | "too-big" | "wrong-type" | "uploading" | "done" | "failed" | "parent";
  result?: RoundTripResult;
  error?: string;
  checks?: UploadCheck[];
  /** Rows changed, unchanged and rejected, worked out from the workbook before it is sent. */
  counts?: { changed: number; unchanged: number; rejected: number };
  confirmed?: boolean;
}

const CHECK_LABEL: Record<CheckId, () => string> = {
  structure: () => t("Structure: the sheet and its columns are as exported"),
  keys: () => t("Keys unchanged: every edit names its record"),
  domain: () => t("Values in domain: every value is an allowed value"),
  mandatory: () => t("Mandatory fields: none is emptied"),
  deleted: () => t("Nothing deleted: no row was removed"),
};
const CHECK_FIX: Record<CheckId, () => string> = {
  structure: () => t("Download the workbook again and edit that copy; keep the sheet names and header row."),
  keys: () => t("Put back the key columns you changed; they tie each row to its record."),
  domain: () => t("Use one of the allowed values listed in the workbook for that column."),
  mandatory: () => t("Fill the emptied mandatory cells again, or restore the old value."),
  deleted: () => t("Add the deleted rows back; to drop a record, mark it instead of removing the row."),
};
const checkDetail = (c: UploadCheck): string | undefined => (c.status === "pass" ? undefined : t("{n, plural, one {# row} other {# rows}}", { n: c.count }));
export const rowsOfChecks = (checks: UploadCheck[]): CheckRow[] => checks.map((c) => ({ id: c.id, status: c.status, label: CHECK_LABEL[c.id](), detail: checkDetail(c) }));

const okType = (f: File) => /\.(xlsx|xlsm|csv)$/i.test(f.name);
const mb = (n: number) => (n / 1024 / 1024).toFixed(1);

export function UploadStep({ o, upload, onScored }: { o: ObjectRun; upload?: (file: File, parent?: string) => Promise<RoundTripResult>; onScored: () => void }) {
  const can = useV2Session().can("analyse");
  const qc = useQueryClient();
  const [items, setItems] = useState<Item[]>([]);
  const [parent, setParent] = useState<string>("");
  const send = upload ?? ((f: File, p?: string) => (fixtureActive() ? Promise.resolve(fixtureUpload(f.name)) : uploadCleaned(f, p)));
  const busy = items.some((i) => i.state === "uploading");
  const waiting = items.filter((i) => i.state === "ready" || i.state === "parent");
  const gates = useMemo(() => waiting.map((i) => (i.checks ? gate(i.checks, Boolean(i.confirmed)) : null)), [waiting]);
  const blockedFile = gates.some((g) => g?.state === "blocked");
  const unconfirmed = gates.some((g) => g?.state === "confirm" && !g.canUpload);
  const ready = blockedFile ? [] : waiting;
  const askParent = items.some((i) => i.state === "parent");

  const add = (files: File[]) => {
    setItems((cur) => [
      ...cur.filter((c) => c.state !== "done"),
      ...files.map((file): Item => ({ file, state: !okType(file) ? "wrong-type" : file.size > MAX_BYTES ? "too-big" : "ready" })),
    ]);
    // The checks read the workbook in the browser; a file that cannot be read here is left to the server's own checks.
    for (const file of files) {
      if (!okType(file) || file.size > MAX_BYTES) continue;
      void readCleanedRows(file).then((input) => {
        if (!input) return;
        const checks = checkCleaned(input);
        setItems((cur) => cur.map((c) => (c.file === file ? { ...c, checks, counts: tally(input, checks) } : c)));
      });
    }
  };

  const run = async () => {
    for (const it of ready) {
      setItems((cur) => cur.map((c) => (c === it ? { ...c, state: "uploading", error: undefined } : c)));
      try {
        const result = await send(it.file, it.state === "parent" ? parent || undefined : undefined);
        setItems((cur) => cur.map((c) => (c.file === it.file ? { ...c, state: "done", result } : c)));
      } catch (e) {
        const p = needsParent(e);
        setItems((cur) => cur.map((c) => (c.file === it.file ? { ...c, state: p ? "parent" : "failed", error: uploadSentence(e, t("The workbook could not be read.")) } : c)));
      }
    }
    void qc.invalidateQueries({ queryKey: ["next"] });
  };

  const done = items.filter((i) => i.result);
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
                {it.state === "ready" ? t("Ready to upload") : null}
                {it.state === "too-big" ? t("Larger than 25 MB; split the workbook and upload the parts.") : null}
                {it.state === "wrong-type" ? t("Not an Excel or CSV file.") : null}
                {it.state === "uploading" ? t("Uploading and reading") : null}
                {it.state === "done" ? t("Read") : null}
              </span>
              {it.checks ? <CheckList rows={rowsOfChecks(it.checks)} label={t("Checks on {file}", { file: it.file.name })} testid="upload-checks" /> : null}
              {it.counts ? (
                <p className="nx-note" data-testid="upload-counts">
                  {t("{changed} rows changed, {unchanged} unchanged, {rejected} rejected", { changed: int(it.counts.changed), unchanged: int(it.counts.unchanged), rejected: int(it.counts.rejected) })}
                </p>
              ) : null}
              {it.checks && gate(it.checks, true).warns > 0 && gate(it.checks, true).fails === 0 && it.state !== "done" ? (
                <label className="nx-field-label">
                  <input type="checkbox" checked={Boolean(it.confirmed)} onChange={(e) => setItems((cur) => cur.map((c) => (c === it ? { ...c, confirmed: e.target.checked } : c)))} data-testid="upload-confirm" />{" "}
                  {t("I have read the warnings and want to upload this workbook")}
                </label>
              ) : null}
              {it.checks && gate(it.checks, false).state === "blocked" ? (
                <div role="alert" className="nx-error-line" data-testid="upload-rejected">
                  <p>{t("A check failed. Fix the workbook and add it again.")}</p>
                  <ul>
                    {it.checks.filter((c) => c.status === "fail").map((c) => (
                      <li key={c.id}>{CHECK_LABEL[c.id]()}. {CHECK_FIX[c.id]()}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {it.error ? <p role="alert" className="nx-error-line">{it.error}</p> : null}
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
      <Button variant="primary" icon="upload" loading={busy} loadingLabel={t("Uploading and scoring")} disabled={ready.length === 0 || unconfirmed || (askParent && !parent)} reason={blockedFile ? t("A check failed. Fix the workbook and add it again.") : unconfirmed ? t("Confirm the warnings first.") : ready.length === 0 ? t("Add a workbook first.") : askParent && !parent ? t("Choose the run the workbook was made from.") : undefined} onClick={() => void run()}>
        {t("Upload and score")}
      </Button>
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
          <Button variant="secondary" onClick={onScored}>{t("See what changed")}</Button>
        </div>
      ) : null}
    </div>
  );
}
