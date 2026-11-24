"use client";

import { useCrumbs, Flow, MDM_STEPS } from "@/ui/screens/flow";
import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { promoteGolden, createWritebackRequest, decideWriteback, submitWritebackRequest } from "@/lib/api/v2/golden-writeback";
import { splitGolden } from "@/lib/api/v2/mdm";
import { revertMergeEvent, setStewardOverrides, undoLastMerge } from "@/lib/api/v2/mdm-extra";
import { describeField } from "@/lib/v2/sap-fields";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { useGoldenEvents, useGoldenExplain, useGoldenHistory, useGoldenRecord, useWritebackPreview, useWritebackRequests } from "@/lib/v2/mdm-queries";
import { Button, Card, Confirm, DataTable, EmptyState, ErrorState, Field, FieldChip, Input, PageHeader, Skeleton, TabPanel, Tabs, useAletheia, useAletheiaScope } from "@/ui/kit";
import { codeText, day, pct, show, statusLabel, useAct, useHref } from "./shared";

type Tab = "fields" | "sources" | "history" | "writeback" | "events";
type Pending = null | { kind: "promote" | "undo" | "split" | "approve" | "reject" | "revert"; arg?: string };

export function GoldenRecord({ id }: { id: string }) {
  const crumbs = useCrumbs();
  useInterfaceLang();
  const href = useHref();
  const chat = useAletheia();
  const { act, busy } = useAct();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("fields");
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState("");
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const rec = useGoldenRecord(id);
  const explain = useGoldenExplain(id);
  const events = useGoldenEvents(id);
  const history = useGoldenHistory(id);
  const preview = useWritebackPreview(id, tab === "writeback");
  const requests = useWritebackRequests(id);
  const r = rec.data;

  useAletheiaScope({
    key: `mdm-golden/${id}`,
    label: r ? t("Asking about golden record {key}", { key: r.sap_object_key }) : t("Asking about a golden record"),
    suggestions: [t("Why did these source values win?"), t("Is this record ready to write back?")],
    answer: () => r
      ? {
          text: t("Golden record {key} is {status} with confidence {c} and {n} source records.", { key: r.sap_object_key, status: statusLabel(r.status), c: pct(r.overall_confidence), n: explain.data?.members.length ?? 0 }),
          evidence: (explain.data?.members ?? []).slice(0, 5),
        }
      : { text: t("The golden record is not loaded yet.") },
  });

  const header = (extra?: ReactNode) => (
    <PageHeader crumbs={crumbs("mdm",r ? r.sap_object_key : t("Golden record"))} stepper={<Flow label={t("Master data journey")} at={3} steps={MDM_STEPS()} />}
      title={r ? r.sap_object_key : t("Golden record")}
      context={r ? statusLabel(r.status) : undefined}
      actions={<>
        {extra}
        <Button variant="ghost" href={href("/mdm/golden")}>{t("All golden records")}</Button>
        <Button variant="ghost" tone="aletheia" onClick={() => chat.setOpen(true)}>{t("Ask Aletheia")}</Button>
      </>}
    />
  );
  if (rec.isLoading) return <>{header()}<Skeleton lines={8} label={t("Loading the golden record")} /></>;
  if (rec.isError || !r) return <>{header()}<ErrorState heading={t("The golden record could not be loaded")} retryLabel={t("Try again")} onRetry={() => void rec.refetch()} /></>;

  const members = explain.data?.members ?? [];
  const refresh = () => { qc.invalidateQueries({ queryKey: ["v2", "mdm"] }); };
  const close = () => { setPending(null); setReason(""); };
  const why = reason.trim() || undefined;
  const run = async () => {
    const p = pending;
    close();
    if (!p) return;
    if (p.kind === "promote") await act(() => promoteGolden(id), t("Record promoted to golden"));
    else if (p.kind === "undo") await act(() => undoLastMerge(id, why), t("Last merge undone"));
    else if (p.kind === "split") await act(() => splitGolden(id, [p.arg ?? ""], why ?? t("Split by a steward")), t("Record split out"));
    else if (p.kind === "approve" || p.kind === "reject") await act(() => decideWriteback(id, p.kind === "approve" ? "approve" : "reject"), p.kind === "approve" ? t("Write-back approved") : t("Write-back rejected"));
    else if (p.kind === "revert") await act(() => revertMergeEvent(p.arg ?? "", why), t("Merge event reverted"));
    refresh();
  };
  const titles: Record<NonNullable<Pending>["kind"], string> = {
    promote: t("Promote this record to golden?"),
    undo: t("Undo the last merge?"),
    split: t("Split this record out of the golden record?"),
    approve: t("Approve the write-back?"),
    reject: t("Reject the write-back?"),
    revert: t("Revert this merge event?"),
  };

  const fieldRows = Object.entries(r.golden_fields).map(([f, v]) => {
    const s = explain.data?.survivorship[f];
    return { f, v, rule: s?.rule ?? "", winner: s?.winner_key ?? "", system: s?.winner_system ?? "", losers: s?.losers.length ?? 0, overridden: explain.data?.steward_overrides[f] };
  });
  const contrib = Object.entries(r.source_contributions);

  return (
    <>
      {header(r.status !== "golden" ? <Button variant="primary" disabled={busy} onClick={() => setPending({ kind: "promote" })}>{t("Promote")}</Button> : null)}
      <div className="mx-col">
        <dl className="mx-tiles">
          <div className="mx-stat"><dt>{t("Confidence")}</dt><dd className="mx-num">{pct(r.overall_confidence)}</dd></div>
          <div className="mx-stat"><dt>{t("Source records")}</dt><dd className="mx-num">{members.length}</dd></div>
          <div className="mx-stat"><dt>{t("Promoted")}</dt><dd className="mx-num">{day(r.promoted_at)}</dd></div>
          <div className="mx-stat"><dt>{t("Updated")}</dt><dd className="mx-num">{day(r.updated_at)}</dd></div>
        </dl>
        <Tabs
          idBase="mdm-golden"
          label={t("Golden record sections")}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
          items={[
            { id: "fields", label: t("Fields") },
            { id: "sources", label: t("Sources"), badge: String(members.length) },
            { id: "history", label: t("History") },
            { id: "writeback", label: t("Write-back") },
            { id: "events", label: t("Merge events"), badge: String(events.data?.length ?? 0) },
          ]}
        />
        <TabPanel idBase="mdm-golden" value={tab} className="mx-col">
        {tab === "fields" && (
          <Card title={t("Golden fields")} sub={t("The value that survived for each field and the rule that chose it.")}>
            {fieldRows.length === 0 ? <EmptyState heading={t("No golden fields")} body={t("Golden fields appear after matching merges the source records of this cluster.")} /> : (
              <DataTable
                label={t("Golden fields")}
                rows={fieldRows}
                rowKey={(x) => x.f}
                columns={[
                  { key: "f", label: t("Field"), render: (x) => <FieldChip code={x.f} description={describeField(x.f) ?? undefined} /> },
                  { key: "v", label: t("Value"), render: (x) => show(x.v) },
                  { key: "rule", label: t("Rule"), render: (x) => x.rule || t("n/a") },
                  { key: "w", label: t("Won from"), render: (x) => x.winner ? `${x.winner}${x.system ? ` (${x.system})` : ""}` : t("n/a") },
                  { key: "l", label: t("Losing values"), align: "end", render: (x) => x.losers },
                  { key: "o", label: t("Steward override"), render: (x) => x.overridden ?? "" },
                ]}
              />
            )}
            <div className="mx-links">
              <Field label={t("Field to override")}><Input value={field} onChange={(e) => setField(e.target.value)} /></Field>
              <Field label={t("Value to keep")}><Input value={value} onChange={(e) => setValue(e.target.value)} /></Field>
              <Button variant="secondary" disabled={busy || !field.trim() || !value.trim()} onClick={async () => { await act(() => setStewardOverrides(id, { [field.trim()]: value.trim() }), t("Override saved")); setField(""); setValue(""); refresh(); }}>{t("Save override")}</Button>
            </div>
          </Card>
        )}
        {tab === "sources" && (
          <Card title={t("Source records")} sub={t("Records merged into this golden record and the systems that supplied values.")}>
            {members.length === 0 ? <EmptyState heading={t("No source records")} body={t("Run matching to bring the source records of this golden record here.")} /> : (
              <DataTable
                label={t("Source records")}
                rows={members.map((m) => ({ m }))}
                rowKey={(x) => x.m}
                columns={[
                  { key: "m", label: t("Record"), render: (x) => <FieldChip code={x.m} /> },
                  { key: "a", label: t("Action"), render: (x) => <Button variant="ghost" disabled={busy || members.length < 2} onClick={() => setPending({ kind: "split", arg: x.m })}>{t("Split out")}</Button> },
                ]}
              />
            )}
            {contrib.length > 0 && (
              <DataTable
                label={t("Value provenance")}
                rows={contrib.map(([f, c]) => ({ f, c }))}
                rowKey={(x) => x.f}
                columns={[
                  { key: "f", label: t("Field"), render: (x) => <FieldChip code={x.f} description={describeField(x.f) ?? undefined} /> },
                  { key: "v", label: t("Value"), render: (x) => show(x.c.value) },
                  { key: "s", label: t("System"), render: (x) => x.c.source_system_name ?? x.c.source_system },
                  { key: "m", label: t("Merged from"), render: (x) => x.c.merged_from ?? "" },
                ]}
              />
            )}
            <Button variant="ghost" href={href(`/mdm/match/${id}`)}>{t("Open the cluster graph")}</Button>
          </Card>
        )}
        {tab === "history" && (
          <Card title={t("Field history")} sub={t("Every change to this record, newest first.")}>
            {history.isLoading ? <Skeleton lines={4} label={t("Loading history")} /> : (history.data ?? []).length === 0 ? <EmptyState heading={t("No history yet")} body={t("A change to this golden record appears here once it is made.")} /> : (
              <DataTable
                label={t("Field history")}
                rows={history.data ?? []}
                rowKey={(x) => x.id}
                columns={[
                  { key: "at", label: t("When"), sort: (x) => x.changed_at, render: (x) => day(x.changed_at) },
                  { key: "by", label: t("By"), render: (x) => x.changed_by ?? t("system") },
                  { key: "t", label: t("Change"), render: (x) => codeText(x.change_type) },
                  { key: "n", label: t("Fields changed"), align: "end", render: (x) => Object.keys(x.new_fields ?? {}).length },
                  { key: "ai", label: t("Aletheia involved"), render: (x) => (x.ai_was_involved ? t("Yes") : t("No")) },
                ]}
              />
            )}
          </Card>
        )}
        {tab === "writeback" && (
          <>
            <Card
              title={t("Write-back plan")}
              sub={preview.data?.message}
              action={<Button variant="secondary" disabled={busy || !preview.data?.writeback_supported} onClick={async () => { await act(() => createWritebackRequest(id), t("Write-back simulation started")); refresh(); }}>{t("Plan and simulate")}</Button>}
            >
              {preview.isLoading ? <Skeleton lines={4} label={t("Loading the write-back plan")} /> : preview.isError ? <ErrorState heading={t("The write-back plan could not be loaded")} retryLabel={t("Try again")} onRetry={() => void preview.refetch()} /> : (preview.data?.targets ?? []).length === 0 ? <EmptyState heading={t("No write-back targets")} body={t("No connected system can take this record back.")} /> : (
                <DataTable
                  label={t("Write-back fields")}
                  rows={(preview.data?.targets ?? []).flatMap((tg) => tg.fields.map((f) => ({ id: `${tg.system_id}:${f.field}`, sys: tg.system_name ?? tg.system_id, f })))}
                  rowKey={(x) => x.id}
                  columns={[
                    { key: "s", label: t("System"), render: (x) => x.sys },
                    { key: "f", label: t("Field"), render: (x) => <FieldChip code={x.f.target ?? x.f.field} description={describeField(x.f.field) ?? undefined} /> },
                    { key: "v", label: t("Golden value"), render: (x) => show(x.f.golden_value) },
                    { key: "ok", label: t("Supported"), render: (x) => (x.f.supported ? t("Yes") : x.f.reason ?? t("No")) },
                  ]}
                />
              )}
            </Card>
            <Card title={t("Write-back requests")} sub={t("A second person approves before anything is written.")}>
              {(requests.data ?? []).length === 0 ? <EmptyState heading={t("No write-back requests yet")} body={t("Request a write-back to send the golden value to a source system.")} /> : (
                <DataTable
                  label={t("Write-back requests")}
                  rows={requests.data ?? []}
                  rowKey={(x) => x.id}
                  columns={[
                    { key: "st", label: t("Status"), render: (x) => codeText(x.status) },
                    { key: "by", label: t("Requested by"), render: (x) => x.requested_by ?? "" },
                    { key: "at", label: t("Created"), render: (x) => day(x.created_at) },
                    {
                      key: "a", label: t("Action"), render: (x) => x.status === "simulated"
                        ? <Button variant="secondary" disabled={busy} onClick={async () => { await act(() => submitWritebackRequest(id, x.id), t("Sent for approval")); refresh(); }}>{t("Send for approval")}</Button>
                        : x.status === "pending_approval"
                          ? <span className="mx-links"><Button variant="primary" disabled={busy} onClick={() => setPending({ kind: "approve" })}>{t("Approve")}</Button><Button variant="ghost" disabled={busy} onClick={() => setPending({ kind: "reject" })}>{t("Reject")}</Button></span>
                          : "",
                    },
                  ]}
                />
              )}
            </Card>
          </>
        )}
        {tab === "events" && (
          <Card title={t("Merge events")} sub={t("Merges, splits and overrides. Undo the last merge or revert one event.")} action={<Button variant="ghost" disabled={busy} onClick={() => setPending({ kind: "undo" })}>{t("Undo last merge")}</Button>}>
            {(events.data ?? []).length === 0 ? <EmptyState heading={t("No merge events yet")} body={t("A merge appears here once records are merged into this golden record.")} /> : (
              <DataTable
                label={t("Merge events")}
                rows={events.data ?? []}
                rowKey={(x) => x.id}
                columns={[
                  { key: "at", label: t("When"), sort: (x) => x.created_at, render: (x) => day(x.created_at) },
                  { key: "t", label: t("Event"), render: (x) => codeText(x.event_type) },
                  { key: "k", label: t("Records"), render: (x) => x.member_keys.join(", ") },
                  { key: "by", label: t("By"), render: (x) => x.actor ?? t("system") },
                  { key: "r", label: t("Reason"), render: (x) => x.reason ?? "" },
                  { key: "a", label: t("Action"), render: (x) => (x.reversed ? t("Reverted") : <Button variant="ghost" disabled={busy} onClick={() => setPending({ kind: "revert", arg: x.id })}>{t("Revert")}</Button>) },
                ]}
              />
            )}
          </Card>
        )}
        </TabPanel>
      </div>
      <Confirm
        open={pending !== null}
        title={pending ? titles[pending.kind] : ""}
        confirmLabel={t("Confirm")}
        cancelLabel={t("Cancel")}
        danger={pending?.kind === "split" || pending?.kind === "undo" || pending?.kind === "revert" || pending?.kind === "reject"}
        onConfirm={run}
        onCancel={close}
      >
        <Field label={t("Reason")}><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </Confirm>
    </>
  );
}
