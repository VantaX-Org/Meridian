"use client";

import "../approvals.css";
import "../roles.css";
import "../runs.css";
import "../system.css";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { errorSentence } from "@/lib/api/v2/client";
import { createRequest, submitRequest, validateRequest, type ChangeRequest, type Precheck, type RequestKind, type RequestObject, type RequestStatus, type RequestView } from "@/lib/api/v2/requests";
import { useOpenItem, useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { useRequests } from "@/lib/v2/requests-queries";
import { t } from "@/lib/v2/i18n";
import { kindWord, objectWord, PrecheckView, statusWord } from "../inspector/request";
import { EmptyFrame, ErrorFrame, Mono, PageTitle, Skeleton, V2Link } from "../parts";

const VIEWS: readonly RequestView[] = ["mine", "to_approve", "all"];
const OBJECTS: readonly RequestObject[] = ["material", "customer", "vendor", "business_partner"];
const KINDS: readonly RequestKind[] = ["create", "change"];
const STATUSES: readonly RequestStatus[] = ["draft", "submitted", "in_approval", "approved", "rejected", "creating", "created", "failed", "cancelled"];

const viewWord = (v: RequestView): string => ({ mine: t("Mine"), to_approve: t("To approve"), all: t("All") })[v];

/** One `TABLE.FIELD=value` per line into the proposed values; lines without "=" are skipped. */
export function parseFields(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    if (i > 0 && k) out[k] = line.slice(i + 1).trim();
  }
  return out;
}

/** The new request form: object, kind and fields; Check creates the draft and runs the pre-checks, Submit sends it into approval. */
function NewRequest({ onDone }: { onDone: (id: string) => void }) {
  const qc = useQueryClient();
  const [object, setObject] = useState<RequestObject>("material");
  const [kind, setKind] = useState<RequestKind>("create");
  const [key, setKey] = useState("");
  const [title, setTitle] = useState("");
  const [fields, setFields] = useState("");
  const [draft, setDraft] = useState<ChangeRequest | null>(null);
  const [check, setCheck] = useState<Precheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const payload = parseFields(fields);
  const empty = Object.keys(payload).length === 0 || (kind === "change" && !key.trim());
  const edit = () => {
    setDraft(null);
    setCheck(null);
  };
  const run = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorSentence(e, fallback));
    } finally {
      setBusy(false);
    }
  };
  const validate = () =>
    run(async () => {
      const d = draft ?? (await createRequest({ kind, object, object_key: kind === "change" ? key.trim() : null, title: title.trim() || null, payload }));
      setDraft(d);
      setCheck(await validateRequest(d.id));
      await qc.invalidateQueries({ queryKey: ["v2"] });
    }, t("The request could not be checked."));
  const submit = () =>
    run(async () => {
      if (!draft) return;
      await submitRequest(draft.id);
      await qc.invalidateQueries({ queryKey: ["v2"] });
      onDone(draft.id);
    }, t("The request could not be submitted."));
  return (
    <section className="m2-sec" aria-label={t("New request")} data-testid="new-request">
      <div className="m2-rfilters">
        <label>
          {t("Object")}
          <select className="m2-sel" value={object} onChange={(e) => (setObject(e.target.value as RequestObject), edit())}>
            {OBJECTS.map((o) => (
              <option key={o} value={o}>
                {objectWord(o)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Kind")}
          <select className="m2-sel" value={kind} onChange={(e) => (setKind(e.target.value as RequestKind), edit())}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {kindWord(k)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="m2-compose">
        {kind === "change" ? (
          <label className="m2-fld m2-wide">
            <span className="m2-lbl">{t("SAP key of the record to change")}</span>
            <input value={key} onChange={(e) => (setKey(e.target.value), edit())} />
          </label>
        ) : null}
        <label className="m2-fld m2-wide">
          <span className="m2-lbl">{t("Title")}</span>
          <input value={title} maxLength={200} onChange={(e) => (setTitle(e.target.value), edit())} />
        </label>
        <label className="m2-fld m2-wide">
          <span className="m2-lbl">{t("Fields, one TABLE.FIELD=value per line")}</span>
          <textarea rows={6} value={fields} spellCheck={false} placeholder="MARA.MATKL=001" onChange={(e) => (setFields(e.target.value), edit())} />
        </label>
      </div>
      <div className="m2-cta">
        <button type="button" className="m2-btn" disabled={busy || empty} onClick={() => void validate()}>
          {t("Check")}
        </button>
        <button type="button" className="m2-btn m2-strong" disabled={busy || !check || check.problems.length > 0} onClick={() => void submit()}>
          {t("Submit for approval")}
        </button>
      </div>
      {check ? <PrecheckView p={check} /> : null}
      {error ? <p className="m2-prov" role="alert">{error}</p> : null}
    </section>
  );
}

function Table({ rows }: { rows: ChangeRequest[] }) {
  const { open, hrefFor } = useOpenItem();
  const openId = open?.kind === "request" ? open.id : null;
  return (
    <div className="m2-frame">
      <table className="m2-tbl" aria-label={t("Change requests")} data-testid="requests-table">
        <thead>
          <tr>
            <th scope="col">{t("Request")}</th>
            <th scope="col">{t("Object")}</th>
            <th scope="col">{t("Kind")}</th>
            <th scope="col">{t("Status")}</th>
            <th scope="col">{t("Requester")}</th>
            <th scope="col">{t("Updated")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} aria-current={openId === r.id ? "true" : undefined}>
              <td>
                <V2Link href={hrefFor({ kind: "request", id: r.id })} className="m2-rowlink">
                  {r.title || (r.object_key ? <Mono>{r.object_key}</Mono> : t("Untitled request"))}
                </V2Link>
              </td>
              <td>{objectWord(r.object)}</td>
              <td>{kindWord(r.kind)}</td>
              <td>{statusWord(r.status)}</td>
              <td>{r.requester_label ?? ""}</td>
              <td>{formatDate(r.updated_at, "date")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** `/requests`: change requests to create or change master data in SAP: mine, to approve, all; filters; and a new request. */
export function RequestsCanvas() {
  const session = useV2Session();
  const { openItem } = useOpenItem();
  const [view, setView] = useUrlParam<RequestView>("view", "mine", VIEWS);
  const [status, setStatus] = useUrlParam<string>("status", "all");
  const [object, setObject] = useUrlParam<string>("object", "all");
  const [kind, setKind] = useUrlParam<string>("kind", "all");
  const [composing, setComposing] = useState(false);
  const q = useRequests({ view, status: status === "all" ? undefined : status, object: object === "all" ? undefined : object, kind: kind === "all" ? undefined : kind });
  const rows = q.data?.items ?? [];
  const canWrite = session.can("mdm.write") && !session.shared;
  return (
    <div data-testid="requests-canvas">
      <PageTitle sub={t("Create and change master data with approval")}>{t("Requests")}</PageTitle>
      <div className="m2-cta">
        <div className="m2-seg" role="group" aria-label={t("Requests views")}>
          {VIEWS.map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
              {viewWord(v)}
            </button>
          ))}
        </div>
        <button type="button" className="m2-btn m2-strong" aria-expanded={composing} disabled={!canWrite} title={canWrite ? undefined : t("A new request needs the master data write permission")} onClick={() => setComposing((c) => !c)}>
          {t("New request")}
        </button>
      </div>
      {composing ? (
        <NewRequest
          onDone={(id) => {
            setComposing(false);
            openItem({ kind: "request", id });
          }}
        />
      ) : null}
      <div className="m2-rfilters">
        <label>
          {t("Status")}
          <select className="m2-sel" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">{t("Any status")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {statusWord(s)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Object")}
          <select className="m2-sel" value={object} onChange={(e) => setObject(e.target.value)}>
            <option value="all">{t("Any object")}</option>
            {OBJECTS.map((o) => (
              <option key={o} value={o}>
                {objectWord(o)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Kind")}
          <select className="m2-sel" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="all">{t("Any kind")}</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {kindWord(k)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The change requests could not be read. Check that the API is reachable, then retry.")}</ErrorFrame>
      ) : q.isLoading ? (
        <Skeleton width="100%" height={220} />
      ) : rows.length === 0 ? (
        <EmptyFrame>{view === "to_approve" ? t("No request waits for your approval.") : t("No change request matches. Start one with New request.")}</EmptyFrame>
      ) : (
        <Table rows={rows} />
      )}
    </div>
  );
}
