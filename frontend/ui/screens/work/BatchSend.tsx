"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { errorSentence } from "@/lib/api/v2/client";
import { useFixture } from "@/lib/api/v2/fixture";
import { confirmBatchLoaded, getBatchRunRecords, sendBatchToSap, type RunRecordState, type SendResult } from "@/lib/api/v2/batches";
import type { ExportFormat } from "@/lib/api/remediation";
import type { BatchRow } from "@/lib/v2/batches";
import { whole } from "@/lib/v2/format";
import { t } from "@/lib/v2/i18n";
import { Button, Confirm, DataTable, EmptyState, ErrorState, Field, FieldChip, Select, Skeleton, StatTile, Stepper, Textarea, useToast } from "@/ui/kit";
import { useCan } from "@/ui/screens/orphans/useCan";
import { displayKey } from "@/lib/v2/work";

const FORMATS: ExportFormat[] = ["cockpit_xlsx", "cockpit_csv", "mass_change_csv", "ltmc_xlsx", "mass_maintenance_zip"];
const formatLabel = (f: ExportFormat): string => ({
  cockpit_xlsx: t("Excel workbook"), cockpit_csv: t("CSV for the cockpit"), mass_change_csv: t("Mass change CSV"),
  ltmc_xlsx: t("LTMC workbook"), mass_maintenance_zip: t("Mass maintenance package"), mdg_cr_json: t("MDG change request"),
})[f];
const refresh = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: ["v2"] });

/**
 * Hand an approved batch over as a load file, then confirm the SAP load. Exporting writes nothing to SAP: it moves the
 * batch to "waiting for the SAP load" and tells the loader. A second person confirms the load.
 */
export function ExportPanel({ b }: { b: BatchRow }) {
  const qc = useQueryClient();
  const toast = useToast();
  const can = useCan();
  const [fmt, setFmt] = useState<ExportFormat>("cockpit_xlsx");
  const [ask, setAsk] = useState<"export" | "loaded" | null>(null);
  const [note, setNote] = useState("");
  const [sent, setSent] = useState<SendResult | null>(null);
  const exp = useMutation<SendResult, Error>({
    mutationFn: () => sendBatchToSap(b.id, b.records, null, fmt),
    onSuccess: (r) => { setSent(r); setAsk(null); toast(t("The load file is ready."), "good"); void refresh(qc); },
  });
  const done = useMutation<void, Error>({
    mutationFn: () => confirmBatchLoaded(b.id, note.trim() || null),
    onSuccess: () => { setAsk(null); toast(t("The load is confirmed."), "good"); void refresh(qc); },
  });
  const canExport = can("export");
  const canConfirm = can("approve") || can("manage_systems");
  const exportBlock = !canExport ? t("Your role cannot export a batch.") : b.status === "draft" ? t("Approve the batch before exporting it.") : null;
  const loadedBlock = !canConfirm ? t("Only an approver or SAP Basis confirms the load.") : null;
  const step = b.status === "exported" ? 2 : sent || b.status === "awaiting_load" ? 1 : 0;
  return (
    <div className="mx-col">
      <Stepper label={t("Hand-over steps")} current={step} steps={[{ id: "export", label: t("Export the file") }, { id: "load", label: t("Load it in SAP") }, { id: "done", label: t("Sent to SAP") }]} />
      <p className="mx-muted">{t("Exporting writes nothing to SAP. A person loads the file, then a second person confirms it here.")}</p>
      {b.status === "approved" || b.status === "awaiting_load" ? (
        <div className="mx-row">
          <Field label={t("File format")}><Select value={fmt} onChange={(e) => setFmt(e.target.value as ExportFormat)} options={FORMATS.map((f) => ({ value: f, label: formatLabel(f) }))} /></Field>
          <Button variant="secondary" disabled={!!exportBlock} onClick={() => setAsk("export")}>{b.status === "approved" ? t("Review the export") : t("Export again")}</Button>
        </div>
      ) : null}
      {exportBlock && b.status !== "exported" ? <p className="mx-muted">{exportBlock}</p> : null}
      {sent ? (
        <dl className="mx-tiles">
          <StatTile label={t("File")} value={sent.filename} />
          <StatTile label={t("Records")} value={sent.records === null ? "" : whole(sent.records)} />
          <StatTile label={t("Checksum")} value={sent.sha256 ? sent.sha256.slice(0, 12) : t("Not given")} note={sent.sha256 ?? undefined} />
        </dl>
      ) : null}
      {b.status === "awaiting_load" ? (
        <div className="mx-row">
          <Button variant="primary" disabled={!!loadedBlock} onClick={() => setAsk("loaded")}>{t("Confirm it was loaded")}</Button>
          {loadedBlock ? <span className="mx-muted">{loadedBlock}</span> : null}
        </div>
      ) : null}
      <Confirm open={ask === "export"} title={t("Export this batch?")} confirmLabel={t("Export")} cancelLabel={t("Cancel")}
        onCancel={() => { setAsk(null); exp.reset(); }} onConfirm={() => exp.mutate()}>
        <p>{t("{n} records of {name} go into one {format} file. Records without a proposed value are left out.", { n: whole(b.records), name: b.name, format: formatLabel(fmt) })}</p>
        <p>{b.status === "approved" ? t("The batch moves to waiting for the SAP load and the loader is told. Nothing reaches SAP.") : t("The status stays as it is; only the file trail grows.")}</p>
        {exp.isError ? <p role="alert">{errorSentence(exp.error, t("The export failed."))}</p> : null}
      </Confirm>
      <Confirm open={ask === "loaded"} title={t("Confirm the SAP load?")} confirmLabel={t("Confirm the load")} cancelLabel={t("Cancel")}
        onCancel={() => { setAsk(null); done.reset(); }} onConfirm={() => done.mutate()}>
        <p>{t("{n} records of {name} are marked Sent to SAP. The next run checks them. You cannot undo this.", { n: whole(b.records), name: b.name })}</p>
        <Field label={t("How it was loaded (optional)")}><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={4000} /></Field>
        {done.isError ? <p role="alert">{errorSentence(done.error, t("The confirmation failed."))}</p> : null}
      </Confirm>
    </div>
  );
}

const STATES: RunRecordState[] = ["failed", "needs_check", "pending", "sending", "committed", "export_only"];
const stateLabel = (s: RunRecordState): string => ({
  failed: t("Failed"), needs_check: t("Needs a check"), pending: t("Waiting"), sending: t("Sending"), committed: t("Sent"), export_only: t("Export only"),
})[s];
const PAGE = 50;

/** The records of a send, with the SAP messages behind each failure. */
export function RunRecords({ id }: { id: string }) {
  const fx = useFixture();
  const [state, setState] = useState<RunRecordState>("failed");
  const [offset, setOffset] = useState(0);
  const q = useQuery({ queryKey: ["v2", "batch-run-records", fx, id, state, offset], queryFn: () => getBatchRunRecords(id, state, PAGE, offset), retry: false });
  const total = q.data?.total ?? 0;
  return (
    <div className="mx-col">
      <Field label={t("Show records that are")}>
        <Select value={state} onChange={(e) => { setState(e.target.value as RunRecordState); setOffset(0); }} options={STATES.map((s) => ({ value: s, label: stateLabel(s) }))} />
      </Field>
      {q.isLoading ? <Skeleton lines={3} label={t("Loading records")} />
        : q.isError ? <ErrorState heading={t("Records could not be loaded")} retryLabel={t("Try again")} onRetry={() => void q.refetch()} />
        : !q.data?.items.length ? <EmptyState heading={t("No records in this state")} body={t("Pick another state to see the rest.")} />
        : (
          <>
            <DataTable label={t("Records of the send")} rows={q.data.items} rowKey={(r) => r.record_key} height={280}
              columns={[
                { key: "k", label: t("Record"), render: (r) => displayKey(r.record_key) },
                { key: "d", label: t("Description"), render: (r) => r.description ?? "" },
                { key: "f", label: t("Fields"), render: (r) => <>{r.fields.map((f) => <FieldChip key={f} code={f} />)}</> },
                { key: "e", label: t("What SAP said"), render: (r) => r.messages.length ? r.messages.map((m) => `${m.id}${m.number} ${m.message}`).join(" / ") : (r.error ?? "") },
                { key: "a", label: t("Tries"), render: (r) => whole(r.attempts), align: "end" },
              ]} />
            <div className="mx-row">
              <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t("Previous")}</Button>
              <span className="mx-muted">{t("{from} to {to} of {total}", { from: whole(offset + 1), to: whole(Math.min(offset + PAGE, total)), total: whole(total) })}</span>
              <Button variant="secondary" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>{t("Next")}</Button>
            </div>
          </>
        )}
    </div>
  );
}
