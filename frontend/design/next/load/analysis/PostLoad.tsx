"use client";

/** Post-load reconciliation: what the load files carried against the target system's latest extraction (migration.py /reconcile). */
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import {
  acceptReconciliation, exportReconciliation, extractMigrationTarget, getReconciliation, getReconciliationRecords, startReconciliation,
  type MigrationRun, type ReconKind, type ReconRecord,
} from "@/lib/api/v2/migration";
import { draftBlockerFixBatch } from "@/lib/api/v2/reports";
import { formatDate, formatModuleName } from "@/lib/format";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { f1, int } from "@/lib/v2/score";
import { Button, Chip, Code, EmptyState, ErrorState, SegmentedControl, Skeleton, useToast } from "../../kit";
import { Panel } from "../parts";
import { Labelled, PAGE, Pager, STATUS_TEXT, Table, status, useMig } from "./shared";

const RECON_REASON: Record<string, () => string> = {
  no_key_in_dictionary: () => t("No key in the data dictionary"),
  key_not_in_load: () => t("Key field not in the load files"),
  target_extract_incomplete: () => t("Target extraction incomplete"),
  target_extract_partial: () => t("Target extraction partial"),
  table_not_extracted: () => t("Table not extracted from the target"),
  key_not_in_target_extract: () => t("Key field not in the target extraction"),
};
const ACTUAL_WHY: Record<string, () => string> = {
  no_target_analysis: () => t("The target system has no completed analysis."),
  no_target_findings_for_module: () => t("The target analysis has no findings for this object."),
};
const RECON_KIND: Record<ReconKind, () => string> = {
  missing: () => t("Missing in target"),
  differing: () => t("Different in target"),
  unexpected: () => t("Held back but present"),
};
/** Why a loaded value differs from the target: each expected cause is read from the target field's DDIC entry or a confirmed value mapping. */
const RECON_CAUSE: Record<string, () => string> = {
  alpha_padding: () => t("Leading zeros (ALPHA conversion)"),
  case: () => t("Upper case (field not lower case in the dictionary)"),
  value_mapping: () => t("Confirmed value mapping"),
  truncation: () => t("Cut to the target field length"),
  number_format: () => t("Same number, other format"),
  date_format: () => t("Same date, other format"),
  real: () => t("Real difference"),
};

function causeEvidence(r: ReconRecord): string | undefined {
  const d = r.ddic;
  if (!d || !d.type) return undefined;
  return t("{type} {length}, {lower}{exit}", {
    type: d.type, length: d.length ?? 0,
    lower: d.lowercase ? t("lower case allowed") : t("upper case only"),
    exit: d.conversion_exit ? `, ${t("conversion exit {exit}", { exit: d.conversion_exit })}` : "",
  });
}
const RECON_STATUS: Record<string, () => string> = { ...STATUS_TEXT, done: () => t("Done") };
const signed = (n: number) => `${n > 0 ? "+" : ""}${f1(n)}`;
const signedInt = (n: number) => `${n > 0 ? "+" : ""}${int(n)}`;

export function PostLoadPanel({ run }: { run: MigrationRun }) {
  const { can, shared, viewAs } = useV2Session();
  const toast = useToast();
  const qc = useQueryClient();
  const { hrefFor } = useOpenItem();
  const [kind, setKind] = useState<ReconKind>("missing");
  const [table, setTable] = useState("");
  const [offset, setOffset] = useState(0);
  const [realOnly, setRealOnly] = useState(false);
  const [batch, setBatch] = useState<string | null>(null);
  const [poll, setPoll] = useState(true);
  const q = useMig(["recon", run.id], () => getReconciliation(run.id).then((r) => { setPoll(r.status === "queued" || r.status === "running"); return r; }), true, poll ? 5_000 : false);
  const done = q.data?.status === "done";
  const rec = useMig(["recon-records", run.id, table, kind, offset, realOnly], () => getReconciliationRecords(run.id, { table: table || undefined, kind, offset, limit: PAGE, real_only: kind === "differing" && realOnly }), done);
  const fail = (msg: string) => (e: unknown) => toast({ text: errorSentence(e, msg), tone: "bad" });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["migration", "recon", run.id] });
  const start = useMutation({ mutationFn: () => startReconciliation(run.id), onSuccess: () => { toast({ text: t("Reconciliation started"), tone: "good" }); setPoll(true); refresh(); }, onError: fail(t("The reconciliation could not be started.")) });
  const extract = useMutation({ mutationFn: () => extractMigrationTarget(run.id), onSuccess: () => { toast({ text: t("Extraction of the target system started"), tone: "good" }); refresh(); }, onError: fail(t("The target system could not be extracted.")) });
  const exp = useMutation({ mutationFn: () => exportReconciliation(run.id), onSuccess: (name) => toast({ text: t("Reconciliation saved as {name}", { name }), tone: "good" }), onError: fail(t("The reconciliation could not be prepared.")) });
  const accept = useMutation({ mutationFn: () => acceptReconciliation(run.id), onSuccess: () => { toast({ text: t("Reconciliation accepted"), tone: "good" }); void qc.invalidateQueries({ queryKey: ["migration"] }); }, onError: fail(t("The reconciliation could not be accepted.")) });
  const draft = useMutation({
    mutationFn: (key: string) => draftBlockerFixBatch(run.wave_id ?? "", { module: run.modules[0], record_keys: [key] }),
    onSuccess: (b) => { setBatch(b.id); toast({ text: t("Fix batch drafted with {n} items", { n: int(b.items) }), tone: "good" }); },
    onError: fail(t("The fix batch could not be drafted.")),
  });
  const act = !shared && !viewAs;
  // ponytail: a difference row carries no object, so the fix batch is offered on single-object runs only
  const canFix = Boolean(run.wave_id) && run.modules.length === 1 && can("apply") && act;
  const d = q.data;
  const sum = d?.summary ?? {};
  const rules = (d?.scores ?? []).flatMap((m) => m.reasons.map((r) => ({ ...r, module: m.module })));
  const comparable = (d?.tables ?? []).filter((x) => x.comparable);
  const fieldText = new Map(comparable.flatMap((x) => x.fields.map((f) => [f.field, f.description ?? undefined] as const)));
  const fields = comparable.flatMap((x) => x.fields.map((f) => ({ ...f, table: x.table, tableText: x.description })));
  const busy = d?.status === "queued" || d?.status === "running";
  return (
    <Panel title={t("Post-load reconciliation")} meta={d?.completed_at ? t("Compared on {date}", { date: formatDate(d.completed_at, "date") }) : t("Load files against the target system")} testId="mig-post-load">
      <div id="mig-post-load" className="nx-ld-actions">
        {can("analyse") && act ? <Button variant="secondary" disabled={start.isPending || busy} onClick={() => start.mutate()}>{t("Run reconciliation")}</Button> : null}
        {can("export") && act && done ? <Button variant="secondary" loading={exp.isPending} onClick={() => exp.mutate()}>{t("Download as Excel")}</Button> : null}
        {can("approve") && act && done && !d?.accepted_at ? <Button variant="primary" data-testid="mig-post-load-accept" loading={accept.isPending} onClick={() => accept.mutate()}>{t("Accept reconciliation")}</Button> : null}
      </div>
      {d?.accepted_at ? <p className="nx-ld-meta" data-testid="mig-post-load-accepted">{t("Accepted by {who} on {date}.", { who: d.accepted_by_label ?? f1(null), date: formatDate(d.accepted_at, "datetime") })}</p> : done && can("approve") ? <p className="nx-ld-meta">{t("Someone other than the person who ran the reconciliation accepts it.")}</p> : null}
      {batch ? <p className="nx-ld-meta"><Link href={hrefFor({ kind: "batch", id: batch })}>{t("Open the fix batch")}</Link></p> : null}
      {q.isPending ? <Skeleton /> : status(q.error) === 404 ? (
        <EmptyState heading={t("This run has not been reconciled against the target system.")} />
      ) : q.isError || !d ? <ErrorState sentence={t("This reconciliation could not be read.")} onRetry={() => void q.refetch()} /> : (
        <>
          {d.stale ? (
            <p role="status" className="nx-ld-meta" data-testid="mig-post-load-stale">
              <strong>{t("Out of date.")}</strong>{" "}{t("The target system was extracted again on {date}, after this comparison. Run the reconciliation again to compare with the newer extraction.", { date: formatDate(d.latest_target_synced_at, "date") })}
            </p>
          ) : null}
          {d.needs_target_extraction ? (
            <div role="status" className="nx-ld-meta" data-testid="mig-post-load-needs-target">
              <p>{t("The target system has not been extracted yet, so there is nothing to compare the load files with. The comparison starts by itself when the extraction has been analysed.")}</p>
              {can("trigger_sync") && act ? <Button variant="secondary" loading={extract.isPending} onClick={() => extract.mutate()}>{t("Extract the target system")}</Button> : null}
            </div>
          ) : !done ? (
            <p className="nx-ld-meta">{RECON_STATUS[d.status]?.() ?? d.status}{d.error_detail ? ` ${d.error_detail}` : ""}</p>
          ) : (
            <>
              <p className="nx-ld-meta">
                {t("Target extraction of {date}.", { date: formatDate(d.target_synced_at, "date") })}{" "}
                {t("{n} of {m} tables compared: {e} expected, {f} found, {x} missing, {u} held back but present, {w} fields differ.", {
                  n: int(sum.comparable ?? 0), m: int(sum.tables ?? 0), e: int(sum.expected ?? 0), f: int(sum.found ?? 0), x: int(sum.missing ?? 0), u: int(sum.unexpected ?? 0), w: int(sum.differing_fields ?? 0),
                })}
              </p>
              {sum.real_differences !== undefined ? (
                <p className="nx-ld-meta" data-testid="mig-post-load-split">
                  {t("Of the differences, {r, plural, one {# is real} other {# are real}} and {x, plural, one {# has an expected cause} other {# have an expected cause}} (padding, case, value mapping, truncation or format). Only real differences count against the load.", {
                    r: sum.real_differences, x: sum.expected_differences ?? 0,
                  })}
                </p>
              ) : null}
              {d.automatic ? <p className="nx-ld-meta" data-testid="mig-post-load-auto">{t("Started automatically when the target system was analysed again.")}</p> : null}
              {d.previous ? (
                <p className="nx-ld-meta" data-testid="mig-post-load-change">
                  {t("Since the comparison of {date}: {x} missing ({dx}), {w} fields differ ({dw}), {f} found ({df}).", {
                    date: formatDate(d.previous.created_at, "date"),
                    x: int(sum.missing ?? 0), dx: signedInt((sum.missing ?? 0) - (d.previous.summary.missing ?? 0)),
                    w: int(sum.differing_fields ?? 0), dw: signedInt((sum.differing_fields ?? 0) - (d.previous.summary.differing_fields ?? 0)),
                    f: int(sum.found ?? 0), df: signedInt((sum.found ?? 0) - (d.previous.summary.found ?? 0)),
                  })}
                </p>
              ) : null}
              <p className="nx-ld-meta">
                {sum.basis === "snapshot"
                  ? t("Compared against the files exported on {date}.", { date: formatDate(sum.snapshot_exported_at ?? null, "date") })
                  : t("Rebuilt from the current field mappings. No export snapshot was kept for this run, so a mapping changed after the load shows as a difference.")}
                {sum.snapshot_skipped ? ` ${t("The export snapshot could not be used, so the expected side was rebuilt from the current field mappings.")}` : ""}
                {sum.newest_export_no_copy ? ` ${t("The latest export has no copy on file, so it is not the basis of this comparison.")}` : ""}
              </p>
              <Table
                rows={d.scores}
                rowKey={(m) => m.module}
                rowLabel={(m) => formatModuleName(m.module)}
                caption={t("Data quality score, source, projected and actual")}
                columns={[
                  { id: "obj", label: t("Object"), cell: (m) => formatModuleName(m.module) },
                  { id: "src", label: t("Source"), cell: (m) => f1(m.source) },
                  { id: "proj", label: t("Projected"), cell: (m) => f1(m.projected) },
                  { id: "act", label: t("Actual in target"), cell: (m) => (m.actual === null ? <span className="nx-ld-meta">{f1(null)} {m.actual_reason ? ACTUAL_WHY[m.actual_reason]?.() ?? m.actual_reason : ""}</span> : f1(m.actual)) },
                ]}
              />
              {rules.length > 0 ? (
                <Table
                  rows={rules}
                  rowKey={(r) => `${r.module}-${r.check_id}`}
                  rowLabel={(r) => r.check_id}
                  caption={t("Rules that moved the actual score")}
                  columns={[
                    { id: "obj", label: t("Object"), cell: (r) => formatModuleName(r.module) },
                    { id: "rule", label: t("Rule"), cell: (r) => <Code code={r.check_id} text={r.description ?? undefined} /> },
                    { id: "s", label: t("Source pass rate"), cell: (r) => f1(r.source_pass_rate) },
                    { id: "tg", label: t("Target pass rate"), cell: (r) => f1(r.target_pass_rate) },
                    { id: "ch", label: t("Change"), cell: (r) => signed(r.change) },
                  ]}
                />
              ) : null}
              <Table
                rows={d.tables}
                rowKey={(x) => x.table}
                rowLabel={(x) => x.table}
                caption={t("Records per target table")}
                columns={[
                  { id: "tab", label: t("Table"), cell: (x) => <Code code={x.table} text={x.description ?? undefined} /> },
                  { id: "exp", label: t("Expected"), cell: (x) => (x.comparable ? int(x.expected) : <>{t("Not compared")}: <Code code={x.reason ?? ""} text={x.reason ? RECON_REASON[x.reason]?.() : undefined} /></>) },
                  { id: "found", label: t("Found"), cell: (x) => (x.comparable ? int(x.found) : null) },
                  { id: "miss", label: t("Missing"), cell: (x) => (x.comparable ? int(x.missing) : null) },
                  { id: "unexp", label: t("Held back but present"), cell: (x) => (x.comparable ? int(x.unexpected) : null) },
                  { id: "diff", label: t("Fields that differ"), cell: (x) => (x.comparable ? int(x.fields.reduce((a, f) => a + f.differing, 0)) : null) },
                  { id: "real", label: t("Real differences"), cell: (x) => (!x.comparable ? null : x.real_differences === undefined ? f1(null) : int(x.real_differences)) },
                ]}
              />
              <Table
                rows={fields}
                rowKey={(f) => `${f.table}-${f.field}`}
                rowLabel={(f) => `${f.table}-${f.field}`}
                caption={t("Fields compared")}
                columns={[
                  { id: "tab", label: t("Table"), cell: (f) => <Code code={f.table} text={f.tableText ?? undefined} /> },
                  { id: "field", label: t("Field"), cell: (f) => <Code code={f.field} text={f.description ?? undefined} /> },
                  { id: "cmp", label: t("Compared"), cell: (f) => (f.in_target_extract ? int(f.compared) : t("Not in the target extraction")) },
                  { id: "match", label: t("Matched"), cell: (f) => (f.in_target_extract ? int(f.matched) : f1(null)) },
                  { id: "diff", label: t("Different"), cell: (f) => (f.in_target_extract ? int(f.differing) : f1(null)) },
                  { id: "real", label: t("Real differences"), cell: (f) => (f.in_target_extract && f.real_differences !== undefined ? int(f.real_differences) : f1(null)) },
                ]}
              />
              <div className="nx-ld-filters">
                <SegmentedControl<ReconKind>
                  label={t("Records")}
                  items={(Object.keys(RECON_KIND) as ReconKind[]).map((k) => ({ value: k, label: RECON_KIND[k]() }))}
                  value={kind}
                  onChange={(k) => { setKind(k); setOffset(0); }}
                />
                {kind === "differing" ? (
                  <span data-testid="mig-post-load-real-only"><Chip pressed={realOnly} onClick={() => { setRealOnly(!realOnly); setOffset(0); }}>{t("Real differences only")}</Chip></span>
                ) : null}
                <Labelled label={t("Table")}>
                  <select className="nx-input" value={table} onChange={(e) => { setTable(e.target.value); setOffset(0); }}>
                    <option value="">{t("All tables")}</option>
                    {comparable.map((x) => <option key={x.table} value={x.table}>{x.description ? `${x.table} ${x.description}` : x.table}</option>)}
                  </select>
                </Labelled>
              </div>
              {rec.isPending ? <Skeleton /> : rec.isError ? <ErrorState sentence={t("This list could not be read.")} onRetry={() => void rec.refetch()} /> : rec.data.rows.length === 0 ? (
                <EmptyState heading={t("No records in this list.")} />
              ) : (
                <>
                  <Table<ReconRecord>
                    rows={rec.data.rows}
                    rowKey={(r) => `${r.source_record}-${r.key}-${r.field}`}
                    rowLabel={(r) => r.key}
                    caption={RECON_KIND[kind]()}
                    columns={[
                      { id: "rec", label: t("Record"), cell: (r) => <Code code={r.key} /> },
                      { id: "src", label: t("Load file record"), cell: (r) => r.source_record ?? f1(null) },
                      { id: "field", label: t("Field"), cell: (r) => (r.field ? <Code code={r.field} text={fieldText.get(r.field)} /> : f1(null)) },
                      { id: "exp", label: t("Expected"), cell: (r) => (r.withheld ? t("Withheld") : r.expected ?? f1(null)) },
                      { id: "found", label: t("Found"), cell: (r) => (r.withheld ? t("Withheld") : r.found ?? f1(null)) },
                      ...(kind === "differing" ? [{
                        id: "cause", label: t("Cause"), cell: (r: ReconRecord) => (
                          <>
                            {r.cause ? <>{RECON_CAUSE[r.cause]?.() ?? r.cause}{causeEvidence(r) ? <div className="nx-ld-meta">{causeEvidence(r)}</div> : null}</> : f1(null)}
                            {canFix && r.source_record ? <div><Button variant="secondary" size={32} disabled={draft.isPending} aria-label={t("Draft a fix batch for {r}", { r: r.source_record })} onClick={() => draft.mutate(r.source_record ?? "")}>{t("Draft a fix batch")}</Button></div> : null}
                          </>
                        ),
                      }] : []),
                    ]}
                  />
                  <Pager offset={offset} total={rec.data.total} onMove={setOffset} />
                  {rec.data.capped ? <p className="nx-ld-meta">{t("Only the first {n} records of each table and kind are kept; the counts above are complete.", { n: int(rec.data.record_cap ?? 0) })}</p> : null}
                </>
              )}
            </>
          )}
        </>
      )}
    </Panel>
  );
}
