"use client";

import { useEffect, useRef, useState } from "react";
import { errorSentence } from "@/lib/api/v2/client";
import { t } from "@/lib/v2/i18n";
import { Button } from "./Button";
import { Confirm } from "./Confirm";
import { DataTable, type Column } from "./DataTable";
import { FileDrop } from "./FileDrop";
import { Sheet } from "./Sheet";
import { StatTile } from "./StatTile";
import { ErrorState, Skeleton } from "./states";
import { Stepper } from "./Stepper";

export interface ImportProblem { row?: string; column: string; value?: string; problem: string; fix?: string }
export interface ImportValidation { ready: number; warnings: number; rejected: number; problems: ImportProblem[]; changes?: string[] }

export interface ImportSheetProps {
  accept: string; fileLabel: string; hint: string;
  /** The system the file lands in, named on the review step (for example "PROD"). */
  target: string;
  /** Checks the file and changes nothing. Leave it out when the endpoint has no check; the file is then checked when applied. */
  validate?: (file: File) => Promise<ImportValidation>;
  /** Writes the file. Returns the sentence to show when done. */
  apply: (file: File, validation: ImportValidation | null) => Promise<string | void>;
  onDone?: () => void;
  /** Called with true once a file is chosen and false when the flow ends, so the host can ask before closing. */
  onDirty?: (dirty: boolean) => void;
}

type Stage = "choose" | "validate" | "review" | "apply" | "done";
const ORDER: Stage[] = ["choose", "validate", "review", "apply", "done"];

const csvCell = (s: string | undefined): string => `"${(s ?? "").replace(/"/g, '""')}"`;

/** The error report: the problems table as a CSV file made in the browser. Nothing is sent. */
function saveProblems(problems: ImportProblem[]): void {
  const head = [t("Row"), t("Column"), t("Value"), t("Problem"), t("Fix")].map(csvCell).join(",");
  const lines = problems.map((p) => [p.row, p.column, p.value, p.problem, p.fix].map(csvCell).join(","));
  const url = window.URL.createObjectURL(new Blob([[head, ...lines].join("\r\n")], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url; a.download = "import_problems.csv";
  document.body.appendChild(a); a.click(); a.remove();
  window.URL.revokeObjectURL(url);
}

/**
 * The one import flow: Choose file, Validate, Review, Apply. Nothing is written before the confirm on Review, rejected rows are
 * listed and counted (never dropped silently), and a failure keeps the chosen file with Retry.
 */
export function ImportSheet({ accept, fileLabel, hint, target, validate, apply, onDone, onDirty }: ImportSheetProps) {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("choose");
  const [v, setV] = useState<ImportValidation | null>(null);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const dirty = useRef(onDirty);
  useEffect(() => { dirty.current = onDirty; });
  useEffect(() => { dirty.current?.(!!file && stage !== "done"); }, [file, stage]);
  useEffect(() => () => dirty.current?.(false), []);

  const check = async (f: File) => {
    setError(""); setV(null);
    if (!validate) { setStage("validate"); return; }
    setStage("validate");
    try { setV(await validate(f)); } catch (e) { setError(errorSentence(e, t("The file could not be checked."))); }
  };
  const pick = (f: File | null) => { setFile(f); if (f) void check(f); else { setStage("choose"); setV(null); setError(""); } };
  const run = async () => {
    if (!file) return;
    setStage("apply"); setError("");
    try { setDone((await apply(file, v)) ?? t("The file was applied.")); setStage("done"); onDone?.(); }
    catch (e) { setError(errorSentence(e, t("The upload did not work. Nothing was changed."))); setStage("review"); }
  };

  const at = ORDER.indexOf(stage);
  const steps = [{ id: "choose", label: t("Choose file") }, { id: "validate", label: t("Validate") }, { id: "review", label: t("Review") }, { id: "apply", label: t("Apply") }];
  const cols: Column<ImportProblem>[] = [
    { key: "row", label: t("Row"), render: (p) => p.row ?? "" },
    { key: "column", label: t("Column") },
    { key: "value", label: t("Value"), render: (p) => p.value ?? "" },
    { key: "problem", label: t("Problem") },
    { key: "fix", label: t("Fix"), render: (p) => p.fix ?? "" },
  ];
  const checking = stage === "validate" && !!validate && !v && !error;
  const blocked = !!validate && !!v && v.ready === 0;
  return (
    <div className="mx-import">
      <Stepper label={t("Import steps")} size="compact" current={stage === "done" ? 4 : Math.min(at, 3)} steps={steps} />
      {stage === "choose" || !file ? (
        <FileDrop accept={accept} onFile={pick} label={fileLabel} status={hint} />
      ) : (
        <p className="mx-muted">{t("{name} ({kb} KB)", { name: file.name, kb: Math.max(1, Math.round(file.size / 1024)) })}</p>
      )}
      {checking ? <Skeleton lines={3} label={t("Checking the file")} /> : null}
      {error && stage !== "review" ? <ErrorState heading={error} retryLabel={t("Retry")} onRetry={() => file && void check(file)} /> : null}
      {stage === "validate" && !validate ? <p className="mx-muted">{t("This upload has no pre-check. The file is checked when you apply it, and nothing is written before you confirm.")}</p> : null}
      {stage === "validate" && v ? (
        <>
          <dl className="mx-import-tiles">
            <StatTile label={t("Ready")} value={v.ready} />
            <StatTile label={t("Warnings")} value={v.warnings} />
            <StatTile label={t("Rejected")} value={v.rejected} />
          </dl>
          {v.problems.length ? (
            <>
              <DataTable columns={cols} rows={v.problems} rowKey={(p) => `${p.row ?? ""}|${p.column}|${p.problem}`} label={t("Problems found")} height={260} />
              <Button variant="secondary" onClick={() => saveProblems(v.problems)}>{t("Download error report")}</Button>
            </>
          ) : <p className="mx-muted">{t("No problems found.")}</p>}
          {blocked ? <p className="mx-field-e" role="alert">{t("No row can be applied. Fix the file and choose it again.")}</p> : null}
        </>
      ) : null}
      {stage === "validate" && (v || !validate) && !error ? (
        <div className="mx-actions">
          <Button variant="primary" disabled={blocked} onClick={() => setStage("review")}>{t("Continue to review")}</Button>
        </div>
      ) : null}
      {stage === "review" || stage === "apply" ? (
        <section aria-label={t("Review")} className="mx-import-review">
          <p>{t("This will write to {target}.", { target })}</p>
          {v ? <p>{t("{n} rows will be applied. {r} rows are rejected and will not be written.", { n: v.ready, r: v.rejected })}</p> : null}
          {v?.changes?.length ? <ul>{v.changes.map((c) => <li key={c}>{c}</li>)}</ul> : null}
          {error ? <ErrorState heading={error} retryLabel={t("Retry")} onRetry={() => void run()} /> : null}
          {stage === "apply" ? <progress aria-label={t("Applying the file")} /> : null}
          <div className="mx-actions">
            <Button variant="ghost" disabled={stage === "apply"} onClick={() => setStage("validate")}>{t("Back")}</Button>
            <Button variant="primary" disabled={stage === "apply"} onClick={() => void run()}>{t("Apply to {target}", { target })}</Button>
          </div>
        </section>
      ) : null}
      {stage === "done" ? <p role="status">{done}</p> : null}
    </div>
  );
}

/** The import flow in its own sheet. Closing after a file is chosen asks first. */
export function ImportDialog({ open, onClose, label, closeLabel, ...rest }: ImportSheetProps & { open: boolean; onClose: () => void; label: string; closeLabel: string }) {
  const [dirty, setDirty] = useState(false);
  const [ask, setAsk] = useState(false);
  const close = () => { if (dirty) setAsk(true); else onClose(); };
  return (
    <>
      <Sheet open={open} onClose={close} label={label} closeLabel={closeLabel}>
        <ImportSheet {...rest} onDirty={(d) => { setDirty(d); rest.onDirty?.(d); }} />
      </Sheet>
      <Confirm open={ask} title={t("Leave this import?")} confirmLabel={t("Leave")} cancelLabel={t("Stay")} danger
        onCancel={() => setAsk(false)} onConfirm={() => { setAsk(false); setDirty(false); onClose(); }}>
        <p>{t("The file is not applied yet. Nothing has been written.")}</p>
      </Confirm>
    </>
  );
}
