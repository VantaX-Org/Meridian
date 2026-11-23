"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFixture } from "@/lib/api/v2/fixture";
import { errorSentence } from "@/lib/api/v2/client";
import { checkBatchWriteback } from "@/lib/api/v2/batches";
import { EXPORT_FORMATS, exportCleaning, getExportOptions, type ExportFormat } from "@/lib/api/v2/cleaning";
import { t } from "@/lib/v2/i18n";
import { Button, useToast } from "@/ui/kit";

const FORMAT: Record<ExportFormat, () => string> = {
  csv: () => t("CSV"), xlsx: () => t("Excel workbook"), lsmw: () => t("LSMW file"), bapi: () => t("BAPI file"), idoc: () => t("IDoc file"), sf_csv: () => t("SuccessFactors CSV"),
};

/** The load file: pick a format, see the pre-check of the draft batch, then download. Sending stays on the batch screens. */
export function LoadFileDialog({ open, onClose, count, batchId }: { open: boolean; onClose: () => void; count: number; batchId: string | null }) {
  const fx = useFixture();
  const push = useToast();
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const opts = useQuery({ queryKey: ["v2", "cleaning", fx, "opts"], queryFn: getExportOptions, enabled: open, retry: false });
  const check = useQuery({ queryKey: ["v2", "fix", fx, "check", batchId], queryFn: () => checkBatchWriteback(batchId as string), enabled: open && !!batchId, retry: false, staleTime: 30_000 });
  const statuses = useMemo(() => opts.data?.statuses ?? [], [opts.data]);
  useEffect(() => { if (!status && statuses.length) setStatus((statuses.find((s) => s.value === "approved") ?? statuses[0]).value); }, [status, statuses]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  const go = async () => {
    setBusy(true);
    try { const name = await exportCleaning(format, status || "approved"); push(t("Saved {name}.", { name }), "good"); onClose(); }
    catch (e) { push(errorSentence(e, t("The load file could not be created.")), "bad"); }
    finally { setBusy(false); }
  };
  const c = check.data;
  return (
    <div className="mx-scrim" data-place="center" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mx-dialog mx-loadfile" role="dialog" aria-modal="true" aria-label={t("Create load file")} data-testid="load-dialog">
        <h2 className="mx-dialog-h">{t("Create load file, {n, plural, one {# record} other {# records}}", { n: count })}</h2>
        <fieldset className="mx-loadfile-formats">
          <legend className="mx-card-t">{t("Format")}</legend>
          {EXPORT_FORMATS.map((f) => (
            <label key={f} className="mx-loadfile-fmt" data-on={f === format ? "" : undefined}>
              <input type="radio" name="fmt" checked={f === format} onChange={() => setFormat(f)} /> {FORMAT[f]()}
            </label>
          ))}
        </fieldset>
        {statuses.length ? (
          <label className="mx-loadfile-status">{t("Status to export")}
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              {statuses.map((s) => <option key={s.value} value={s.value}>{`${s.value} (${s.count})`}</option>)}
            </select>
          </label>
        ) : null}
        <dl className="mx-loadfile-check" data-testid="precheck">
          <dt>{t("Safety check")}</dt>
          <dd>{!batchId ? t("safety check not loaded") : check.isLoading ? t("Checking") : check.isError ? t("safety check not loaded") : c ? t("{a} by BAPI, {b} export only, {e} errors", { a: c.bapi, b: c.export_only, e: c.errors.length }) : ""}</dd>
        </dl>
        <div className="mx-dialog-f">
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" disabled={busy || count === 0} onClick={() => void go()} data-testid="load-download">{t("Download")}</Button>
        </div>
      </div>
    </div>
  );
}
