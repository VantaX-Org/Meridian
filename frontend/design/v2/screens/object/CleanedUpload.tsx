"use client";

import Link from "next/link";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { DIMENSIONS } from "@/lib/api/v2/types";
import { needsParent, uploadCleaned, uploadSentence, type RoundTripResult, type UploadChecks } from "@/lib/api/v2/roundtrip";
import { checkSentence, checkWorkbook, flagReason, holdReason, STATUS_SENTENCE, worstOf } from "@/lib/api/v2/upload-checks";
import { getVersionHead } from "@/lib/api/v2/runs";
import { useFixture } from "@/lib/api/v2/fixture";
import { useObjectRules } from "@/lib/v2/queries";
import { useCompareRecords, useScoreDelta, useTimeline } from "@/lib/v2/runs-queries";
import { f1, int } from "@/lib/v2/score";
import { t as tr } from "@/lib/v2/i18n";
import { Coded, Dash, V2Link } from "../../parts";

const DONE = ["complete", "finished", "agents_complete", "failed"];

/**
 * Clean in Excel, upload back, re-score. The edited migration template or cleaning workbook becomes the next run of
 * the same lineage; when it finishes, the panel shows the new score against the run it came from.
 */
export function CleanedUpload({ module, label }: { module: string; label: string }) {
  const fixture = useFixture();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parent, setParent] = useState("");
  const [askParent, setAskParent] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [skip, setSkip] = useState(false);
  const runs = useTimeline(null, 50, module).data?.runs.filter((r) => module in r.objects).reverse() ?? [];

  // the same checks as the pre-upload path, run on every file before anything is applied
  const checks = useQuery({
    queryKey: ["v2", "roundtrip-check", fixture, file?.name, file?.size, file?.lastModified, parent, skip],
    queryFn: () => checkWorkbook(file as File, parent || undefined, undefined, skip),
    enabled: Boolean(file),
    retry: false,
  });
  const parentMissing = askParent || (checks.isError && needsParent(checks.error));
  const hold = checks.data ? holdReason(checks.data.checks, confirm) : null;
  const send = useMutation({
    mutationFn: () => uploadCleaned(file as File, parent || undefined, undefined, confirm, skip),
    onSuccess: () => setAskParent(false),
    onError: (e) => setAskParent(needsParent(e)),
  });
  const result: RoundTripResult | undefined = send.data;
  const head = useQuery({
    queryKey: ["v2", "roundtrip-head", fixture, result?.version_id],
    queryFn: () => getVersionHead(result?.version_id as string),
    enabled: Boolean(result),
    refetchInterval: (q) => (fixture || DONE.includes(q.state.data?.status ?? "") ? false : 3000),
  });
  const status = fixture ? "complete" : head.data?.status;
  const ready = Boolean(result) && DONE.includes(status ?? "") && status !== "failed";

  return (
    <section aria-label={tr("Upload cleaned file")} className="m2-sec">
      <div className="m2-sechead">
        <h2 className="m2-h2">{tr("Upload cleaned file")}</h2>
        <span className="m2-sub">{tr("Clean the {label} export in Excel, upload it here, and Meridian scores it again as the next run.", { label })}</span>
      </div>
      <div className="m2-row">
        <input ref={input} type="file" accept=".xlsx,.csv" aria-label={tr("Cleaned file (.xlsx or .csv)")} onChange={(e) => { setFile(e.target.files?.[0] ?? null); send.reset(); setAskParent(false); setConfirm(false); setSkip(false); }} />
        {parentMissing ? (
          <label>
            {tr("Run the file came from")}{" "}
            <select value={parent} onChange={(e) => setParent(e.target.value)}>
              <option value="">{tr("Choose a run")}</option>
              {runs.map((r) => (
                <option key={r.id} value={r.id}>{`#${r.run_number ?? ""} ${r.label ?? r.id}`}</option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="button" className="m2-btn" disabled={!file || send.isPending || (parentMissing && !parent) || !checks.data || Boolean(hold)} title={hold ?? undefined} onClick={() => send.mutate()}>
          {send.isPending ? tr("Uploading") : tr("Upload cleaned file")}
        </button>
      </div>
      {file && checks.isPending ? <p className="m2-sub" role="status">{tr("Checking the file")}</p> : null}
      {checks.data && !result ? <Checks data={checks.data} confirm={confirm} onConfirm={setConfirm} skip={skip} onSkip={(v) => { setSkip(v); setConfirm(false); }} /> : null}
      {checks.isError && !parentMissing ? <p className="m2-err" role="alert">{uploadSentence(checks.error, tr("The file could not be checked."))}</p> : null}
      {parentMissing ? <p className="m2-sub" role="status">{tr("This file does not say which run it came from. Choose the run you exported it from.")}</p> : null}
      {send.isError && !askParent ? <p className="m2-err" role="alert">{uploadSentence(send.error, tr("The file could not be uploaded."))}</p> : null}
      {result ? <Outcome result={result} module={module} ready={ready} failed={status === "failed"} systemId={head.data?.metadata?.system_id} /> : null}
    </section>
  );
}

/** Every check on the file and the cells that fail one, before anything is applied. No cell value is shown. */
function Checks({ data, confirm, onConfirm, skip, onSkip }: { data: UploadChecks; confirm: boolean; onConfirm: (v: boolean) => void; skip: boolean; onSkip: (v: boolean) => void }) {
  const worst = worstOf(data.checks);
  const flagged = data.flagged ?? [];
  const total = data.flagged_total ?? flagged.length;
  return (
    <div aria-label={tr("Checks on this workbook")} data-testid="cleaned-checks">
      <ul className="m2-flist">
        {data.checks.map((c) => (
          <li key={c.id} data-status={c.status} data-testid={`cleaned-check-${c.id}`}>
            <strong>{STATUS_SENTENCE[c.status]()}</strong> {checkSentence(c.id)}{c.detail ? <span className="m2-sub"> {c.detail}</span> : null}
          </li>
        ))}
      </ul>
      {flagged.length ? (
        <>
          <h3 className="m2-h3">{tr("Flagged cells ({n})", { n: int(total) })}</h3>
          <table className="m2-tbl" data-testid="cleaned-flagged">
            <thead>
              <tr><th>{tr("Table")}</th><th>{tr("Record key")}</th><th>{tr("Field")}</th><th>{tr("Why")}</th></tr>
            </thead>
            <tbody>
              {flagged.map((f) => (
                <tr key={`${f.table}|${f.key}|${f.field}`}>
                  <td>{f.table || "-"}</td>
                  <td>{f.key}</td>
                  <td><Coded code={f.field} text={f.description || undefined} /></td>
                  <td>{flagReason(f.reason)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {total > flagged.length ? <p className="m2-sub">{tr("Showing {n} of {total}.", { n: int(flagged.length), total: int(total) })}</p> : null}
          {flagged.some((f) => f.table) ? (
            <label className="m2-row">
              <input type="checkbox" checked={skip} onChange={(e) => onSkip(e.target.checked)} data-testid="cleaned-skip-flagged" />
              {tr("Leave the flagged cells out and apply the rest")}
            </label>
          ) : null}
        </>
      ) : null}
      {worst === "warn" ? (
        <label className="m2-row">
          <input type="checkbox" checked={confirm} onChange={(e) => onConfirm(e.target.checked)} data-testid="cleaned-confirm" />
          {tr("I have read the warnings; upload anyway")}
        </label>
      ) : null}
      {worst === "fail" ? <p className="m2-err" role="alert">{holdReason(data.checks, confirm)}</p> : null}
    </div>
  );
}

function Outcome({ result, module, ready, failed, systemId }: { result: RoundTripResult; module: string; ready: boolean; failed: boolean; systemId?: string }) {
  const unmapped = Object.entries(result.unmapped).filter(([, cols]) => cols.length);
  const skipped = Object.entries(result.skipped);
  return (
    <div>
      <dl className="m2-kv">
        <dt>{tr("Read as")}</dt>
        <dd>{result.kind === "cleaning" ? tr("Cleaning workbook") : tr("Filled migration template")}</dd>
        <dt>{tr("Values changed")}</dt>
        <dd>{int(result.applied)}</dd>
        <dt>{tr("Already the same")}</dt>
        <dd>{int(result.unchanged)}</dd>
        <dt>{tr("Not found in the run")}</dt>
        <dd>{int(result.unmatched)}</dd>
      </dl>
      {unmapped.map(([sheet, cols]) => (
        <p key={sheet} className="m2-sub">{tr("Sheet {sheet}: columns not read because they map to no field: {cols}", { sheet, cols: cols.join(", ") })}</p>
      ))}
      {skipped.map(([sheet, why]) => (
        <p key={sheet} className="m2-sub">{tr("Sheet {sheet} was not read: {why}", { sheet, why })}</p>
      ))}
      {failed ? <p className="m2-err" role="alert">{tr("The new run failed. The values were saved; run the analysis again from Runs.")}</p> : null}
      {ready ? <BeforeAfter after={result.version_id} before={result.parent_version_id} module={module} /> : result && !failed ? <p className="m2-sub" role="status">{tr("Scoring the cleaned file.")}</p> : null}
      {ready && systemId ? (
        <p className="m2-meta">
          <V2Link href={`/migration?start=1&system=${encodeURIComponent(systemId)}&source_version=${encodeURIComponent(result.version_id)}`} data-testid="cleaned-to-migration">{tr("Check what will load from this run")}</V2Link>
        </p>
      ) : null}
      {ready ? (
        <p className="m2-meta">
          <Link href={`/next/run/${encodeURIComponent(result.version_id)}/agreement`} data-testid="cleaned-to-agreement">{tr("Check the clean file against a later run")}</Link>
        </p>
      ) : null}
    </div>
  );
}

/** New score against the run it came from: per dimension, findings fixed / still open / new, required fields still empty. */
function BeforeAfter({ after, before, module }: { after: string; before: string; module: string }) {
  const delta = useScoreDelta(before, after, module);
  const records = useCompareRecords(after, before);
  const rules = useObjectRules(module, after);
  const empty = (rules.data ?? []).filter((r) => r.dimension === "completeness" && r.affected_count > 0 && r.field);
  const d = delta.data;
  const totals = records.data?.totals;
  return (
    <div aria-label={tr("Before and after")}>
      <dl className="m2-kv">
        <dt>{tr("Score before")}</dt>
        <dd>{d ? f1(d.before) : <Dash why={tr("The comparison is not ready")} />}</dd>
        <dt>{tr("Score now")}</dt>
        <dd>{d ? `${f1(d.after)} (${d.delta > 0 ? "+" : ""}${f1(d.delta)})` : <Dash why={tr("The comparison is not ready")} />}</dd>
        {DIMENSIONS.map((dim) => {
          const p = d?.by_dimension.find((x) => x.dimension === dim.key)?.points;
          return [<dt key={`${dim.key}-t`}>{dim.label}</dt>, <dd key={`${dim.key}-d`}>{p == null ? <Dash why={tr("No change recorded")} /> : `${p > 0 ? "+" : ""}${f1(p)}`}</dd>];
        })}
        <dt>{tr("Findings fixed")}</dt>
        <dd>{totals ? int(totals.resolved) : <Dash why={tr("The comparison is not ready")} />}</dd>
        <dt>{tr("Still open")}</dt>
        <dd>{totals ? int(totals.persisting) : <Dash why={tr("The comparison is not ready")} />}</dd>
        <dt>{tr("New")}</dt>
        <dd>{totals ? int(totals.new) : <Dash why={tr("The comparison is not ready")} />}</dd>
      </dl>
      <h3 className="m2-h3">{tr("Required fields still empty")}</h3>
      {rules.isPending ? null : empty.length === 0 ? (
        <p className="m2-sub">{tr("No required field is empty.")}</p>
      ) : (
        <ul>
          {empty.map((r) => (
            <li key={r.check_id}>
              <Coded code={r.field as string} text={r.field_description} /> {tr("{n} records", { n: int(r.affected_count) })}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
