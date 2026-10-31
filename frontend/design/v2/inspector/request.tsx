"use client";

import "../approvals.css";
import "../roles.css";
import "../runs.css";
import "../system.css";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate, labelOf } from "@/lib/format";
import { errorSentence } from "@/lib/api/v2/client";
import { attachToRequest, cancelRequest, commentRequest, exportRequest, retryRequest, submitRequest, type ChangeRequest, type Precheck, type RequestDetail, type RequestKind, type RequestObject, type RequestStatus } from "@/lib/api/v2/requests";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { useRequest } from "@/lib/v2/requests-queries";
import { int } from "@/lib/v2/score";
import { t as tr } from "@/lib/v2/i18n";
import { Actions, Fact, Facts, InspectorFrame } from "../Inspector";
import { EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";
import { useToast } from "../Toast";
import { StepDecide } from "./decide";
import { ResultFrame, useOutcome } from "./shared";

export function statusWord(s: RequestStatus): string {
  const words: Record<RequestStatus, string> = {
    draft: tr("Draft"),
    submitted: tr("Submitted"),
    in_approval: tr("In approval"),
    approved: tr("Approved"),
    rejected: tr("Rejected"),
    creating: tr("Creating in SAP"),
    created: tr("Created in SAP"),
    failed: tr("Failed in SAP"),
    cancelled: tr("Cancelled"),
  };
  return words[s] ?? s;
}

export function objectWord(o: RequestObject): string {
  const words: Record<RequestObject, string> = { material: tr("Material"), customer: tr("Customer"), vendor: tr("Vendor"), business_partner: tr("Business partner") };
  return words[o] ?? o;
}

export const kindWord = (k: RequestKind): string => (k === "create" ? tr("Create") : tr("Change"));

const TASK_WORD = (s: string): string => ({ pending: tr("Waiting"), approved: tr("Approved"), rejected: tr("Rejected"), skipped: tr("Skipped"), cancelled: tr("Cancelled") })[s] ?? s;

/** The rule pre-checks and duplicate candidates of a request: what the validate step answered. */
export function PrecheckView({ p }: { p: Precheck }) {
  const { hrefFor } = useOpenItem();
  const clean = p.problems.length === 0 && p.failures.length === 0 && p.duplicates.length === 0;
  return (
    <div data-testid="precheck">
      <p className="m2-prov">
        {clean
          ? tr("{rules} rules ran; none failed and no duplicate was found.", { rules: int(p.rules_run) })
          : tr("{rules} rules ran: {failures} failed, {duplicates} possible duplicates.", { rules: int(p.rules_run), failures: int(p.failures.length), duplicates: int(p.duplicates.length) })}
      </p>
      {p.problems.length ? (
        <ul className="m2-rlist" data-testid="precheck-problems">
          {p.problems.map((x) => (
            <li key={x}>
              {x}
            </li>
          ))}
        </ul>
      ) : null}
      {p.failures.length ? (
        <ul className="m2-rlist" data-testid="precheck-failures">
          {p.failures.map((f) => (
            <li key={`${f.check_id}:${f.field ?? ""}`}>
              <V2Link href={hrefFor({ kind: "rule", id: f.check_id })}>
                <Mono>{f.check_id}</Mono>
              </V2Link>
              <span>{labelOf(f.severity)}</span>
              <span className="m2-rl-sub">
                {f.field ? <Mono>{f.field}</Mono> : null}
                {f.field ? " " : null}
                {f.message}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {p.duplicates.length ? (
        <ul className="m2-rlist" data-testid="precheck-duplicates">
          {p.duplicates.map((d) => (
            <li key={d.master_record_id}>
              <V2Link href={hrefFor({ kind: "golden", id: d.master_record_id })}>
                <Mono>{d.sap_object_key ?? d.master_record_id}</Mono>
              </V2Link>
              <span>{tr("{score}% alike", { score: int(Math.round(d.score * 100)) })}</span>
              <span className="m2-rl-sub">{d.attributes.map((a) => `${a.field}: ${a.value ?? "—"}`).join(", ")}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Talk({ d }: { d: RequestDetail }) {
  const qc = useQueryClient();
  const toast = useToast();
  const session = useV2Session();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const id = d.request.id;
  const act = async (fn: () => Promise<unknown>, fail: string) => {
    setBusy(true);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["v2", "change-request"] });
    } catch (e) {
      toast.show(errorSentence(e, fail), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <h3>{tr("Comments")}</h3>
      {d.comments.length === 0 ? (
        <EmptyFrame>{tr("No comment yet.")}</EmptyFrame>
      ) : (
        <ul className="m2-rlist" data-testid="request-comments">
          {d.comments.map((c) => (
            <li key={c.id}>
              <span className="m2-meta">{`${c.author_label ?? "—"}, ${formatDate(c.created_at, "date")}`}</span>
              <span className="m2-rl-sub">{c.body}</span>
            </li>
          ))}
        </ul>
      )}
      {session.can("mdm.read") && !session.shared ? (
        <div className="m2-compose">
          <label className="m2-fld m2-wide">
            <span className="m2-lbl">{tr("Add a comment")}</span>
            <textarea rows={2} value={draft} maxLength={4000} onChange={(e) => setDraft(e.target.value)} />
          </label>
          <button type="button" className="m2-btn m2-sm" disabled={busy || !draft.trim()} onClick={() => void act(async () => { await commentRequest(id, draft.trim()); setDraft(""); }, tr("The comment could not be posted."))}>
            {tr("Post comment")}
          </button>
        </div>
      ) : null}
      <h3>{tr("Attachments")}</h3>
      {d.attachments.length === 0 ? (
        <EmptyFrame>{tr("No attachment yet.")}</EmptyFrame>
      ) : (
        <ul className="m2-rlist" data-testid="request-attachments">
          {d.attachments.map((a) => (
            <li key={a.id}>
              <Mono>{a.filename}</Mono>
              <span>{a.size_bytes != null ? tr("{kb} KB", { kb: int(Math.ceil(a.size_bytes / 1024)) }) : "—"}</span>
              <span className="m2-rl-sub">{`${a.uploaded_by_label ?? "—"}, ${formatDate(a.created_at, "date")}`}</span>
            </li>
          ))}
        </ul>
      )}
      {session.can("mdm.write") && !session.shared ? (
        <label className="m2-fld m2-wide">
          <span className="m2-lbl">{tr("Attach a file (its name, type and size are recorded)")}</span>
          <input
            type="file"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void act(() => attachToRequest(id, f.name, f.type || null, f.size), tr("The attachment could not be recorded."));
            }}
          />
        </label>
      ) : null}
    </>
  );
}

function RequestBody({ d }: { d: RequestDetail }) {
  const r: ChangeRequest = d.request;
  const qc = useQueryClient();
  const toast = useToast();
  const session = useV2Session();
  const { outcome, pending, run } = useOutcome(`request:${r.id}`);
  const [checked, setChecked] = useState(false);
  const mine = r.requester_id != null && r.requester_id === session.id;
  const write = session.can("mdm.write") && !session.shared;
  const done = async (title: string) => {
    await qc.invalidateQueries({ queryKey: ["v2"] });
    return { tone: "ok" as const, title };
  };
  const sapMessages = r.sap_result?.messages ?? [];
  return (
    <>
      <Facts>
        <Fact label={tr("Request")}>
          <Mono>{r.id}</Mono>
        </Fact>
        <Fact label={tr("Object")}>{objectWord(r.object)}</Fact>
        <Fact label={tr("Kind")}>{kindWord(r.kind)}</Fact>
        {r.object_key ? (
          <Fact label={tr("Record")}>
            <Mono>{r.object_key}</Mono>
          </Fact>
        ) : null}
        <Fact label={tr("Status")}>{statusWord(r.status)}</Fact>
        <Fact label={tr("Requested by")}>{r.requester_label ?? "—"}</Fact>
        <Fact label={tr("Created")}>{formatDate(r.created_at, "date")}</Fact>
        {r.submitted_at ? <Fact label={tr("Submitted")}>{formatDate(r.submitted_at, "datetime")}</Fact> : null}
        {r.decided_at ? <Fact label={tr("Decided")}>{formatDate(r.decided_at, "datetime")}</Fact> : null}
        {r.sap_key ? (
          <Fact label={tr("SAP key")}>
            <Mono>{r.sap_key}</Mono>
          </Fact>
        ) : null}
        {r.sap_attempts ? <Fact label={tr("Attempts in SAP")}>{int(r.sap_attempts)}</Fact> : null}
      </Facts>
      {r.reason ? <p className="m2-prov">{r.reason}</p> : null}
      {sapMessages.length ? (
        <ul className="m2-rlist" data-testid="request-sap-messages">
          {sapMessages.map((m, i) => (
            <li key={i}>
              <Mono>{m.type ?? "—"}</Mono>
              <span className="m2-rl-sub">{m.message ?? ""}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <h3>{tr("Proposed values")}</h3>
      <table className="m2-tbl" data-testid="request-payload">
        <thead>
          <tr>
            <th scope="col">{tr("Field")}</th>
            <th scope="col">{tr("Value")}</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(r.payload).map(([k, v]) => (
            <tr key={k}>
              <td>
                <Mono>{k}</Mono>
              </td>
              <td>
                <Mono>{v}</Mono>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>{tr("Checks")}</h3>
      {r.precheck ? <PrecheckView p={r.precheck} /> : <EmptyFrame>{tr("Not checked yet. Check runs the rules and the duplicate search on the proposed values.")}</EmptyFrame>}

      <StepDecide kind="change_request" id={r.id} />

      <h3>{tr("Approval steps")}</h3>
      {d.workflow && d.workflow.tasks.length ? (
        <ol className="m2-trail" data-testid="request-steps">
          {d.workflow.tasks.map((s) => (
            <li key={s.id}>
              <div>
                {`${s.step_name}: ${TASK_WORD(s.status)}`}
                {s.decided_by_label ? tr(" by {user}", { user: s.decided_by_label }) : ""}
              </div>
              {s.comment ? <p className="m2-tr-note">{s.comment}</p> : null}
              {s.skip_reason ? <p className="m2-tr-note">{s.skip_reason}</p> : null}
              <div className="m2-tr-at">{s.decided_at ? formatDate(s.decided_at, "datetime") : s.due_at ? tr("Due {due}", { due: formatDate(s.due_at, "datetime") }) : "—"}</div>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyFrame>{tr("The approval starts when the request is submitted.")}</EmptyFrame>
      )}

      <h3>{tr("History")}</h3>
      {d.history.length ? (
        <ol className="m2-trail" data-testid="request-history">
          {d.history.map((h) => (
            <li key={h.id}>
              <div>
                {h.action.replace(/_/g, " ")}
                {h.actor_label ? tr(" by {user}", { user: h.actor_label }) : ""}
              </div>
              {h.detail && typeof h.detail.reason === "string" ? <p className="m2-tr-note">{h.detail.reason}</p> : null}
              {h.detail && typeof h.detail.comment === "string" ? <p className="m2-tr-note">{h.detail.comment}</p> : null}
              <div className="m2-tr-at">{formatDate(h.created_at, "datetime")}</div>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyFrame>{tr("Nothing has happened to this request yet.")}</EmptyFrame>
      )}

      {r.status === "failed" && write ? (
        <label className="m2-check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          {tr("I checked in SAP that the record was not created")}
        </label>
      ) : null}
      <Actions>
        {r.status === "draft" && mine && write ? (
          <button type="button" className="m2-btn m2-btn-primary" disabled={pending !== null} onClick={() => void run("submit", async () => { await submitRequest(r.id); return done(tr("Submitted for approval.")); })}>
            {tr("Submit")}
          </button>
        ) : null}
        {r.status === "failed" && write ? (
          <button type="button" className="m2-btn m2-btn-primary" disabled={pending !== null || !checked} onClick={() => void run("retry", async () => { await retryRequest(r.id, checked); return done(tr("Sent to SAP again.")); })}>
            {tr("Retry")}
          </button>
        ) : null}
        {r.has_export ? (
          <button
            type="button"
            className="m2-btn"
            disabled={pending !== null}
            onClick={() =>
              void exportRequest(r.id)
                .then((name) => toast.show(tr("Saved as {name}", { name })))
                .catch((e: unknown) => toast.show(errorSentence(e, tr("The load file could not be built.")), "error"))
            }
          >
            {tr("Export load file")}
          </button>
        ) : null}
        {["draft", "submitted", "in_approval", "approved", "failed"].includes(r.status) && mine && write ? (
          <button type="button" className="m2-btn" disabled={pending !== null} onClick={() => void run("cancel", async () => { await cancelRequest(r.id); return done(tr("Request cancelled.")); })}>
            {tr("Cancel request")}
          </button>
        ) : null}
      </Actions>
      {outcome ? <ResultFrame outcome={outcome} /> : null}
      <Talk d={d} />
    </>
  );
}

/** `?open=request:<id>`: a master data change request, its checks, approval steps, history, comments and attachments. */
export function RequestInspector({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useRequest(id);
  const r = q.data?.request ?? null;
  const status = r ? statusWord(r.status) : q.isLoading ? <Skeleton width={120} height={12} /> : tr("Not found");
  return (
    <InspectorFrame title={r?.title ?? tr("Change request {id}", { id })} status={status} onClose={onClose}>
      {q.data ? (
        <RequestBody d={q.data} />
      ) : q.isLoading ? (
        <Skeleton width="100%" height={160} />
      ) : (
        <ErrorFrame onRetry={() => void q.refetch()}>{errorSentence(q.error, tr("The request could not be read."))}</ErrorFrame>
      )}
    </InspectorFrame>
  );
}
