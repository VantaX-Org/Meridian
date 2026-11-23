"use client";

import { Flow, REQUEST_STEPS, requestFlow } from "@/ui/screens/flow";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  attachToRequest, cancelRequest, commentRequest, decideRequest, exportRequest, getFieldHistory, getMassPreview, getRequest, retryRequest, submitRequest, validateRequest,
  type RequestDetail,
} from "@/lib/api/v2/requests";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Code, Confirm, DataTable, DetailPanel, Field, Input, useToast, ExportMenu } from "@/ui/kit";
import { Async, Empty, Head, num, useRead, useScreenScope, when } from "../mdm/catalogue/shared";
import { kindText, objectText, statusText } from "./RequestsScreen";
import { PrecheckView } from "./RequestNewScreen";

function Overview({ d }: { d: RequestDetail }) {
  const r = d.request;
  const rows: [string, string | null][] = [
    [t("Object"), objectText(r.object)], [t("Type"), kindText(r.kind)], [t("Status"), statusText(r.status)], [t("Requester"), r.requester_label],
    [t("Created"), when(r.created_at)], [t("Submitted"), when(r.submitted_at)], [t("Due"), when(r.due_at)], [t("Waiting step"), r.waiting_step],
    [t("Records"), num(r.record_count)], [t("Reason"), r.reason],
  ];
  return (
    <>
      <Card title={r.title ?? r.id} sub={r.object_key ?? undefined}>
        <DataTable label={t("Request facts")} rows={rows} rowKey={(x) => x[0]} height={340} rowHeight={36}
          columns={[{ key: "k", label: t("Property"), render: (x) => x[0] }, { key: "v", label: t("Value"), render: (x) => x[1] ?? t("n/a") }]} />
      </Card>
      {r.critical_fields.length ? (
        <Card title={t("Critical fields touched")}>{r.critical_fields.map((f) => <Code key={f} code={f} />)}</Card>
      ) : null}
      {Object.keys(r.payload).length ? (
        <Card title={t("Proposed values")}>
          <DataTable label={t("Proposed values")} rows={Object.entries(r.payload)} rowKey={(x) => x[0]} height={240} rowHeight={36}
            columns={[{ key: "f", label: t("Field"), render: (x) => <Code code={x[0]} /> }, { key: "v", label: t("Value"), render: (x) => x[1] }]} />
        </Card>
      ) : null}
      {r.precheck ? <PrecheckView p={r.precheck} /> : null}
      {r.sap_key || r.sap_result ? (
        <Card title={t("Result in SAP")} sub={r.sap_phase ?? undefined}>
          {r.sap_key ? <Code code={r.sap_key} description={t("Key created")} /> : null}
          {(r.sap_result?.messages ?? []).map((m, i) => <p key={i} className="mx-muted">{m.message}</p>)}
        </Card>
      ) : null}
    </>
  );
}

function Approval({ d, id, onDone }: { d: RequestDetail; id: string; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [comment, setComment] = useState("");
  const decide = async (decision: "approve" | "reject", taskId: string) => {
    try { await decideRequest(id, decision, comment || undefined, taskId); setComment(""); await onDone(); } catch { toast(t("The decision could not be saved"), "bad"); }
  };
  const tasks = d.workflow?.tasks ?? [];
  if (!d.workflow) return <Empty heading={t("Not submitted yet")} body={t("The approval steps appear once the request is submitted.")} />;
  return (
    <>
      <Card title={d.workflow.definition_key} sub={`${t("Version")} ${d.workflow.definition_version}`}>
        <Field label={t("Comment for your decision")}><Input value={comment} onChange={(e) => setComment(e.target.value)} /></Field>
        <DataTable label={t("Approval steps")} rows={tasks} rowKey={(x) => x.id} height={280} rowHeight={40}
          columns={[
            { key: "n", label: t("Step"), render: (x) => `${x.step_index + 1} ${x.step_name}` },
            { key: "s", label: t("Status"), render: (x) => x.status },
            { key: "d", label: t("Due"), render: (x) => when(x.due_at) },
            { key: "c", label: t("Decision"), render: (x) => (x.decision ? `${x.decision} ${x.decided_by_label ?? ""} ${x.comment ?? ""}` : t("n/a")) },
            { key: "a", label: "", render: (x) => (x.status === "pending" || x.status === "active" ? (
              <>
                <Button variant="primary" onClick={() => void decide("approve", x.id)}>{t("Approve")}</Button>
                <Button variant="secondary" onClick={() => void decide("reject", x.id)}>{t("Reject")}</Button>
              </>) : null) },
          ]} />
      </Card>
      <Card title={t("History")}>
        {d.history.length ? (
          <DataTable label={t("Approval history")} rows={d.history} rowKey={(x) => x.id} height={240} rowHeight={36}
            columns={[
              { key: "t", label: t("When"), render: (x) => when(x.created_at) },
              { key: "a", label: t("Action"), render: (x) => x.action },
              { key: "w", label: t("By"), render: (x) => x.actor_label ?? t("n/a") },
              { key: "f", label: t("Status change"), render: (x) => (x.to_status ? `${x.from_status ?? ""} ${x.to_status}` : t("n/a")) },
            ]} />
        ) : <Empty heading={t("No history yet")} />}
      </Card>
    </>
  );
}

function Comments({ d, id, onDone }: { d: RequestDetail; id: string; onDone: () => Promise<void> }) {
  const toast = useToast();
  const [body, setBody] = useState("");
  const send = async () => { try { await commentRequest(id, body); setBody(""); await onDone(); } catch { toast(t("The comment could not be saved"), "bad"); } };
  return (
    <Card title={t("Comments")}>
      <Field label={t("Add a comment")}><Input value={body} onChange={(e) => setBody(e.target.value)} /></Field>
      <Button variant="primary" disabled={!body.trim()} onClick={() => void send()}>{t("Post comment")}</Button>
      {d.comments.length ? d.comments.map((c) => <p key={c.id}><strong>{c.author_label ?? t("n/a")}</strong> {when(c.created_at)} {c.body}</p>) : <Empty heading={t("No comments yet")} />}
    </Card>
  );
}

function Attachments({ d, id, onDone }: { d: RequestDetail; id: string; onDone: () => Promise<void> }) {
  const toast = useToast();
  const add = async (f: File | undefined) => {
    if (!f) return;
    try { await attachToRequest(id, f.name, f.type || null, f.size); await onDone(); } catch { toast(t("The file could not be attached"), "bad"); }
  };
  return (
    <Card title={t("Attachments")}>
      <Field label={t("Attach a file")}><Input type="file" onChange={(e) => void add(e.target.files?.[0])} /></Field>
      {d.attachments.length ? (
        <DataTable label={t("Attachments")} rows={d.attachments} rowKey={(x) => x.id} height={240} rowHeight={36}
          columns={[
            { key: "f", label: t("File"), render: (x) => x.filename },
            { key: "t", label: t("Type"), render: (x) => x.content_type ?? t("n/a") },
            { key: "s", label: t("Size in bytes"), align: "end", render: (x) => num(x.size_bytes) },
            { key: "u", label: t("Added by"), render: (x) => x.uploaded_by_label ?? t("n/a") },
          ]} />
      ) : <Empty heading={t("No attachments yet")} />}
    </Card>
  );
}

function FieldHistory({ id }: { id: string }) {
  const q = useRead(["cr", "history", id], () => getFieldHistory(id));
  return (
    <Card title={t("Field history")}>
      <Async q={q}>{(d) => d.items.length ? (
        <DataTable label={t("Field history")} rows={d.items} rowKey={(x) => x.id} height={360} rowHeight={36}
          columns={[
            { key: "f", label: t("Field"), render: (x) => <Code code={x.field} description={x.record_key ?? undefined} /> },
            { key: "a", label: t("Action"), render: (x) => x.action },
            { key: "o", label: t("Before"), render: (x) => x.old_value ?? t("n/a") },
            { key: "n", label: t("After"), render: (x) => x.new_value ?? t("n/a") },
            { key: "w", label: t("By"), render: (x) => x.actor_label ?? t("n/a") },
          ]} />
      ) : <Empty heading={t("No field changes recorded")} />}</Async>
    </Card>
  );
}

function Preview({ id }: { id: string }) {
  const q = useRead(["cr", "preview", id], () => getMassPreview(id));
  return (
    <Card title={t("Preview of the mass change")}>
      <Async q={q}>{(d) => (
        <>
          <p className="mx-muted">{`${num(d.counts.records)} ${t("records")}, ${num(d.counts.found)} ${t("found")}, ${num(d.counts.missing)} ${t("missing")}, ${num(d.counts.changing)} ${t("changing")}`}</p>
          {d.rows.length ? (
            <DataTable label={t("Mass change preview")} rows={d.rows} rowKey={(x) => `${x.record_key}-${x.field}`} height={360} rowHeight={36}
              columns={[
                { key: "r", label: t("Record"), render: (x) => <Code code={x.record_key} description={x.text ?? undefined} /> },
                { key: "f", label: t("Field"), render: (x) => <Code code={x.field} /> },
                { key: "b", label: t("Before"), render: (x) => x.before ?? t("n/a") },
                { key: "a", label: t("After"), render: (x) => (x.unchanged ? `${x.after} (${t("unchanged")})` : x.after) },
              ]} />
          ) : <Empty heading={t("Nothing to preview")} />}
          {d.truncated ? <p className="mx-muted">{t("Only the first rows are shown.")}</p> : null}
        </>
      )}</Async>
    </Card>
  );
}

export function RequestScreen({ id }: { id: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("overview");
  const [ask, setAsk] = useState(false);
  const q = useRead(["cr", "one", id], () => getRequest(id));
  const refresh = async () => { await qc.invalidateQueries({ queryKey: ["b7b"] }); };
  const r = q.data?.request;
  useScreenScope("request", `${t("Request")} ${id}`, [
    { prompt: t("Where is this request stuck?"), answer: () => ({ text: r ? `${statusText(r.status)}${r.waiting_step ? `, ${r.waiting_step}` : ""}${r.overdue ? `, ${t("overdue")}` : ""}` : t("None") }) },
  ]);
  const run = async (fn: () => Promise<unknown>, fail: string) => { try { await fn(); await refresh(); } catch { toast(fail, "bad"); } };
  const actions = r ? (
    <>
      {r.status === "draft" ? <Button variant="secondary" onClick={() => void run(() => validateRequest(id), t("The checks could not run"))}>{t("Validate")}</Button> : null}
      {r.status === "draft" ? <Button variant="primary" onClick={() => void run(() => submitRequest(id), t("The request could not be submitted"))}>{t("Submit")}</Button> : null}
      {r.status === "failed" ? <Button variant="secondary" onClick={() => void run(() => retryRequest(id, false), t("The retry could not start"))}>{t("Retry")}</Button> : null}
      {r.has_export ? <ExportMenu formats={[{ id: "file", label: t("Request file"), hint: t("The request with its history") }]} onExport={() => exportRequest(id)} /> : null}
      {["draft", "submitted", "in_approval"].includes(r.status) ? <Button variant="ghost" onClick={() => setAsk(true)}>{t("Cancel request")}</Button> : null}
    </>
  ) : null;
  const tabs = [
    { id: "overview", label: t("Overview") }, { id: "approval", label: t("Approval") }, { id: "comments", label: t("Comments"), badge: q.data ? String(q.data.comments.length) : undefined },
    { id: "files", label: t("Attachments"), badge: q.data ? String(q.data.attachments.length) : undefined }, { id: "history", label: t("Field history") },
    ...(r?.kind === "mass_change" ? [{ id: "preview", label: t("Preview") }] : []),
  ];
  return (
    <>
      <Head place="requests" stepper={r ? <Flow label={t("Data request")} steps={REQUEST_STEPS()} {...requestFlow(r.status, statusText(r.status))} /> : undefined} title={r?.title ?? `${t("Request")} ${id}`} context={<Code code={id} description={r ? statusText(r.status) : undefined} />} actions={actions} />
      <Async q={q}>{(d) => (
        <DetailPanel idBase="cr" label={t("Request detail")} tabsLabel={t("Request views")} header={null} tabs={tabs} value={tab} onChange={setTab}>
          {tab === "overview" ? <Overview d={d} /> : null}
          {tab === "approval" ? <Approval d={d} id={id} onDone={refresh} /> : null}
          {tab === "comments" ? <Comments d={d} id={id} onDone={refresh} /> : null}
          {tab === "files" ? <Attachments d={d} id={id} onDone={refresh} /> : null}
          {tab === "history" ? <FieldHistory id={id} /> : null}
          {tab === "preview" ? <Preview id={id} /> : null}
        </DetailPanel>
      )}</Async>
      <Confirm open={ask} title={t("Cancel this request?")} confirmLabel={t("Cancel request")} cancelLabel={t("Keep request")} danger
        onCancel={() => setAsk(false)} onConfirm={() => { setAsk(false); void run(() => cancelRequest(id), t("The request could not be cancelled")); }}>
        {t("An approver will no longer see it.")}
      </Confirm>
    </>
  );
}
