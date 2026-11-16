"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate, labelOf } from "@/lib/format";
import { errorSentence } from "@/lib/api/v2/client";
import {
  attachToRequest,
  cancelRequest,
  commentRequest,
  exportRequest,
  retryRequest,
  submitRequest,
  updateRequest,
  type ChangeRequest,
  type FieldAction,
  type Precheck,
  type RequestDetail,
  type RequestKind,
  type RequestObject,
  type RequestStatus,
} from "@/lib/api/v2/requests";
import { useOpenItem, useV2Session } from "@/lib/v2/hooks";
import { useFieldHistory, useRequest } from "@/lib/v2/requests-queries";
import { int } from "@/lib/v2/score";
import { describeField } from "@/lib/v2/sap-fields";
import { t } from "@/lib/v2/i18n";
import { V2Link } from "@/design/v2/parts";
import { Button, Code, Confirm, ErrorState, Skeleton, useToast } from "../../kit";
import { Actions, Fact, Facts, InspectorFrame, type BodyProps } from "./frame";
import { Note, OutcomeLine, Sec, WorkflowSteps, useOutcome, type Outcome } from "./work-common";
import { StepDecide, Trail } from "./work-decide";

const fieldText = (f: string) => describeField(f) ?? undefined;

export function statusWord(s: RequestStatus, releasedAt?: string | null): string {
  if (s === "approved" && releasedAt) return t("Released to the SAP save");
  const words: Record<RequestStatus, string> = {
    draft: t("Draft"),
    submitted: t("Submitted"),
    in_approval: t("In approval"),
    approved: t("Approved"),
    rejected: t("Rejected"),
    creating: t("Creating in SAP"),
    created: t("Created in SAP"),
    failed: t("Failed in SAP"),
    cancelled: t("Cancelled"),
  };
  return words[s] ?? s;
}

function objectWord(o: RequestObject): string {
  const words: Record<RequestObject, string> = { material: t("Material"), customer: t("Customer"), vendor: t("Vendor"), business_partner: t("Business partner") };
  return words[o] ?? o;
}

/** Hours open as a short span: under two days in hours, else in days. */
const ageWord = (h: number): string => (h < 48 ? t("{n} h", { n: int(Math.round(h)) }) : t("{n} d", { n: int(Math.round(h / 24)) }));

const requestKindWord = (k: RequestKind): string => (k === "create" ? t("Create") : k === "mass_change" ? t("Mass change") : t("Change"));

/** The rule pre-checks and duplicate candidates of a request: what the validate step answered. */
function PrecheckView({ p }: { p: Precheck }) {
  const { hrefFor } = useOpenItem();
  const clean = p.problems.length === 0 && p.failures.length === 0 && p.duplicates.length === 0;
  return (
    <div data-testid="precheck">
      <Note>
        {clean
          ? t("{rules} rules ran; none failed and no duplicate was found.", { rules: int(p.rules_run) })
          : t("{rules} rules ran: {failures} failed, {duplicates} possible duplicates.", { rules: int(p.rules_run), failures: int(p.failures.length), duplicates: int(p.duplicates.length) })}
      </Note>
      {p.problems.length ? (
        <ul className="nx-ib-list" data-testid="precheck-problems">
          {p.problems.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : null}
      {p.failures.length ? (
        <ul className="nx-ib-list" data-testid="precheck-failures">
          {p.failures.map((f) => (
            <li key={`${f.check_id}:${f.field ?? ""}`} className="nx-ib-row">
              <V2Link href={hrefFor({ kind: "rule", id: f.check_id })}>
                <span className="nx-wk-mono">{f.check_id}</span>
              </V2Link>
              <span>{labelOf(f.severity)}</span>
              <span className="nx-ib-meta">
                {f.field ? <Code code={f.field} text={fieldText(f.field)} /> : null}
                {f.field ? " " : null}
                {f.message}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {p.duplicates.length ? (
        <ul className="nx-ib-list" data-testid="precheck-duplicates">
          {p.duplicates.map((d) => (
            <li key={d.master_record_id} className="nx-ib-row">
              <V2Link href={hrefFor({ kind: "golden", id: d.master_record_id })}>
                <span className="nx-wk-mono">{d.sap_object_key ?? d.master_record_id}</span>
              </V2Link>
              <span>{t("{score}% alike", { score: int(Math.round(d.score * 100)) })}</span>
              <span className="nx-ib-meta">{d.attributes.map((a) => `${a.field}: ${a.value ?? "—"}`).join(", ")}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const actionWord = (a: FieldAction): string => ({ set: t("Set"), changed: t("Changed"), removed: t("Removed"), defaulted: t("Defaulted"), derived: t("Derived") })[a] ?? a;

/** Every field of the request that was set, changed, removed or filled by a default: old and new value, who, when. */
function FieldHistory({ id }: { id: string }) {
  const q = useFieldHistory(id);
  const items = q.data?.items ?? [];
  if (q.isError) return <ErrorState sentence={t("The field history could not be read.")} onRetry={() => void q.refetch()} />;
  if (q.isLoading) return <Skeleton lines={2} label={t("Field history")} />;
  if (items.length === 0) return <Note>{t("No field change is recorded for this request.")}</Note>;
  return (
    <div className="nx-wk-scroll">
      <table className="nx-wk-table" data-testid="request-field-history">
        <thead>
          <tr>
            <th scope="col">{t("Field")}</th>
            <th scope="col">{t("Action")}</th>
            <th scope="col">{t("From")}</th>
            <th scope="col">{t("To")}</th>
            <th scope="col">{t("By")}</th>
            <th scope="col">{t("When")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => (
            <tr key={c.id}>
              <td><Code code={c.field} text={fieldText(c.field)} /></td>
              <td>{actionWord(c.action)}</td>
              <td>{c.old_value != null ? <span className="nx-wk-mono">{c.old_value}</span> : ""}</td>
              <td>{c.new_value != null ? <span className="nx-wk-mono">{c.new_value}</span> : ""}</td>
              <td>{c.actor_label ?? "—"}</td>
              <td>{formatDate(c.created_at, "datetime")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Comments and attachments of a request. Attaching records the file's name, type and size only. */
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
      toast({ text: errorSentence(e, fail), tone: "bad" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Sec title={t("Comments")}>
        {d.comments.length === 0 ? (
          <Note>{t("No comment yet.")}</Note>
        ) : (
          <ul className="nx-ib-list" data-testid="request-comments">
            {d.comments.map((c) => (
              <li key={c.id}>
                <span className="nx-ib-meta">{`${c.author_label ?? "—"}, ${formatDate(c.created_at, "date")}`}</span>
                <p className="nx-wk-quote">{c.body}</p>
              </li>
            ))}
          </ul>
        )}
        {session.can("mdm.read") && !session.shared ? (
          <div className="nx-wk-form">
            <label className="nx-wk-form">
              <span>{t("Add a comment")}</span>
              <textarea rows={2} value={draft} maxLength={4000} onChange={(e) => setDraft(e.target.value)} />
            </label>
            <Button
              size={32}
              disabled={busy || !draft.trim()}
              loading={busy}
              onClick={() =>
                void act(async () => {
                  await commentRequest(id, draft.trim());
                  setDraft("");
                }, t("The comment could not be posted."))
              }
            >
              {t("Post comment")}
            </Button>
          </div>
        ) : null}
      </Sec>
      <Sec title={t("Attachments")}>
        {d.attachments.length === 0 ? (
          <Note>{t("No attachment yet.")}</Note>
        ) : (
          <ul className="nx-ib-list" data-testid="request-attachments">
            {d.attachments.map((a) => (
              <li key={a.id} className="nx-ib-row">
                <span className="nx-wk-mono">{a.filename}</span>
                <span>{a.size_bytes != null ? t("{kb} KB", { kb: int(Math.ceil(a.size_bytes / 1024)) }) : "—"}</span>
                <span className="nx-ib-meta">{`${a.uploaded_by_label ?? "—"}, ${formatDate(a.created_at, "date")}`}</span>
              </li>
            ))}
          </ul>
        )}
        {session.can("mdm.write") && !session.shared ? (
          <label className="nx-wk-form">
            <span>{t("Attach a file (its name, type and size are recorded)")}</span>
            <input
              type="file"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void act(() => attachToRequest(id, f.name, f.type || null, f.size), t("The attachment could not be recorded."));
              }}
            />
          </label>
        ) : null}
      </Sec>
    </>
  );
}

/** Edit an open (draft) request: title and the proposed values it already holds (PATCH /change-requests/{id}). Saving clears the old check. */
function EditDraft({ r, onSaved }: { r: ChangeRequest; onSaved: () => Promise<unknown> }) {
  const toast = useToast();
  const [on, setOn] = useState(false);
  const [title, setTitle] = useState(r.title ?? "");
  const [vals, setVals] = useState<Record<string, string>>(r.payload);
  const [busy, setBusy] = useState(false);
  if (!on) {
    return (
      <Button size={32} data-testid="request-edit-open" onClick={() => setOn(true)}>
        {t("Edit draft")}
      </Button>
    );
  }
  const save = async () => {
    setBusy(true);
    try {
      await updateRequest(r.id, { title: title.trim(), payload: vals });
      await onSaved();
      setOn(false);
    } catch (e) {
      toast({ text: errorSentence(e, t("The draft could not be saved.")), tone: "bad" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="nx-wk-form"
      data-testid="request-edit"
      aria-label={t("Edit draft")}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <label className="nx-wk-form">
        <span>{t("Title")}</span>
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      {Object.keys(vals).map((k) => (
        <label key={k} className="nx-wk-form">
          <Code code={k} text={fieldText(k)} />
          <input type="text" aria-label={describeField(k) ?? k} value={vals[k]} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} />
        </label>
      ))}
      <Actions>
        <Button type="submit" variant="primary" loading={busy} loadingLabel={t("Working…")}>
          {t("Save draft")}
        </Button>
        <Button variant="quiet" onClick={() => setOn(false)}>
          {t("Cancel")}
        </Button>
      </Actions>
    </form>
  );
}

function RequestBody({ d }: { d: RequestDetail }) {
  const r: ChangeRequest = d.request;
  const qc = useQueryClient();
  const toast = useToast();
  const session = useV2Session();
  const { outcome, pending, run } = useOutcome();
  const [checked, setChecked] = useState(false);
  const [asking, setAsking] = useState(false);
  const mine = r.requester_id != null && r.requester_id === session.id;
  const write = session.can("mdm.write") && !session.shared;
  const done = async (title: string): Promise<Outcome> => {
    await qc.invalidateQueries({ queryKey: ["v2"] });
    return { tone: "ok", title };
  };
  const sapMessages = r.sap_result?.messages ?? [];
  const cancellable = ["draft", "submitted", "in_approval", "approved", "failed"].includes(r.status) && !r.entry_released_at && mine && write;
  return (
    <>
      <Facts>
        <Fact label={t("Request")}><span className="nx-wk-mono">{r.id}</span></Fact>
        <Fact label={t("Object")}>{objectWord(r.object)}</Fact>
        <Fact label={t("Kind")}>{requestKindWord(r.kind)}</Fact>
        {r.object_key ? <Fact label={t("Record")}><span className="nx-wk-mono">{r.object_key}</span></Fact> : null}
        <Fact label={t("Status")}>{statusWord(r.status, r.entry_released_at)}</Fact>
        <Fact label={t("Requested by")}>{r.requester_label ?? "—"}</Fact>
        <Fact label={t("Created")}>{formatDate(r.created_at, "date")}</Fact>
        {r.submitted_at ? <Fact label={t("Submitted")}>{formatDate(r.submitted_at, "datetime")}</Fact> : null}
        {r.waiting_step ? <Fact label={t("Waiting for")}>{r.waiting_step}</Fact> : null}
        {r.due_at ? <Fact label={t("Due")}>{`${formatDate(r.due_at, "datetime")}${r.overdue ? ` ${t("Overdue")}` : ""}`}</Fact> : null}
        {r.age_hours != null ? <Fact label={t("Age")}>{ageWord(r.age_hours)}</Fact> : null}
        {r.critical_fields?.length ? (
          <Fact label={t("Critical fields")}>
            <span data-testid="request-critical">
              {r.critical_fields.map((f) => (
                <div key={f}><Code code={f} text={fieldText(f)} /></div>
              ))}
            </span>
          </Fact>
        ) : null}
        {r.decided_at ? <Fact label={t("Decided")}>{formatDate(r.decided_at, "datetime")}</Fact> : null}
        {r.sap_key ? <Fact label={t("SAP key")}><span className="nx-wk-mono">{r.sap_key}</span></Fact> : null}
        {r.sap_attempts ? <Fact label={t("Attempts in SAP")}>{int(r.sap_attempts)}</Fact> : null}
      </Facts>
      {r.reason ? <Note>{r.reason}</Note> : null}
      {sapMessages.length ? (
        <ul className="nx-ib-list" data-testid="request-sap-messages">
          {sapMessages.map((m, i) => (
            <li key={i} className="nx-ib-row">
              <span className="nx-wk-mono">{m.type ?? "—"}</span>
              <span className="nx-ib-meta">{m.message ?? ""}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <Sec title={t("Proposed values")}>
        <div className="nx-wk-scroll">
          <table className="nx-wk-table" data-testid="request-payload">
            <thead>
              <tr>
                <th scope="col">{t("Field")}</th>
                <th scope="col">{t("Value")}</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(r.payload).map(([k, v]) => (
                <tr key={k}>
                  <td><Code code={k} text={fieldText(k)} /></td>
                  <td><span className="nx-wk-mono">{v}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {r.status === "draft" && mine && write ? <EditDraft r={r} onSaved={() => done(t("Draft saved."))} /> : null}
      </Sec>

      <Sec title={t("Field history")}>
        <FieldHistory id={r.id} />
      </Sec>

      <Sec title={t("Checks")}>
        {r.precheck ? <PrecheckView p={r.precheck} /> : <Note>{t("Not checked yet. Check runs the rules and the duplicate search on the proposed values.")}</Note>}
      </Sec>

      <StepDecide kind="change_request" id={r.id} />

      <Sec title={t("Approval steps")}>
        {d.workflow && d.workflow.tasks.length ? <WorkflowSteps tasks={d.workflow.tasks} testId="request-steps" /> : <Note>{t("The approval starts when the request is submitted.")}</Note>}
      </Sec>

      <Sec title={t("History")}>
        {d.history.length ? <Trail items={d.history} testId="request-history" /> : <Note>{t("Nothing has happened to this request yet.")}</Note>}
      </Sec>

      {r.status === "failed" && write ? (
        <label className="nx-wk-check">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          {t("I checked in SAP that the record was not created")}
        </label>
      ) : null}
      <Actions>
        {r.status === "draft" && mine && write ? (
          <Button
            variant="primary"
            disabled={pending !== null}
            loading={pending === "submit"}
            onClick={() =>
              void run("submit", async () => {
                await submitRequest(r.id);
                return done(t("Submitted for approval."));
              })
            }
          >
            {t("Submit")}
          </Button>
        ) : null}
        {r.status === "failed" && write ? (
          <Button
            variant="primary"
            disabled={pending !== null || !checked}
            loading={pending === "retry"}
            onClick={() =>
              void run("retry", async () => {
                await retryRequest(r.id, checked);
                return done(t("Sent to SAP again."));
              })
            }
          >
            {t("Retry")}
          </Button>
        ) : null}
        {r.has_export && !r.entry_released_at ? (
          <Button
            disabled={pending !== null}
            onClick={() =>
              void exportRequest(r.id)
                .then((name) => toast({ text: t("Saved as {name}", { name }) }))
                .catch((e: unknown) => toast({ text: errorSentence(e, t("The load file could not be built.")), tone: "bad" }))
            }
          >
            {t("Export load file")}
          </Button>
        ) : null}
        {cancellable ? (
          <Button variant="danger" disabled={pending !== null} loading={pending === "cancel"} onClick={() => setAsking(true)}>
            {t("Cancel request")}
          </Button>
        ) : null}
      </Actions>
      <Confirm
        open={asking}
        title={t("Cancel request")}
        consequence={t("This request is cancelled: its approval stops and nothing from it is sent to SAP.")}
        confirmLabel={t("Cancel request")}
        danger
        onCancel={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false);
          void run("cancel", async () => {
            await cancelRequest(r.id);
            return done(t("Request cancelled."));
          });
        }}
      />
      {outcome ? <OutcomeLine outcome={outcome} /> : null}
      <Talk d={d} />
    </>
  );
}

/** `?open=request:<id>`: a master data change request, its checks, approval steps, history, comments and attachments. */
export function RequestBodyView({ id, onClose }: BodyProps) {
  const q = useRequest(id);
  const r = q.data?.request ?? null;
  const status = r ? statusWord(r.status, r.entry_released_at) : q.isLoading ? null : t("Not found");
  return (
    <InspectorFrame title={r?.title ?? t("Change request {id}", { id })} status={status} onClose={onClose}>
      {q.data ? (
        <RequestBody d={q.data} />
      ) : q.isLoading ? (
        <Skeleton lines={6} label={t("Change request {id}", { id })} />
      ) : (
        <ErrorState sentence={errorSentence(q.error, t("The request could not be read."))} onRetry={() => void q.refetch()} />
      )}
    </InspectorFrame>
  );
}
