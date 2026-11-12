"use client";

import "../approvals.css";
import "../roles.css";
import "../runs.css";
import "../system.css";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDate } from "@/lib/format";
import { errorSentence } from "@/lib/api/v2/client";
import { createRequest, deleteCriticalField, deleteDefault, deleteDerivation, putCriticalField, putDefault, putDerivation, submitRequest, validateRequest, type ChangeRequest, type Precheck, type RequestKind, type RequestObject, type RequestStatus, type RequestView } from "@/lib/api/v2/requests";
import { useOpenItem, useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { useApprovalForecast, useCriticalFields, useDerivations, useEntryDefaults, useMassPreview, useRequests } from "@/lib/v2/requests-queries";
import type { ForecastRow } from "@/lib/api/v2/process-analytics";
import { pct1 } from "@/lib/v2/score";
import { describeField } from "@/lib/v2/sap-fields";
import { t } from "@/lib/v2/i18n";
import { ageWord, kindWord, objectWord, PrecheckView, statusWord } from "../inspector/request";
import { Coded, EmptyFrame, ErrorFrame, Mono, PageTitle, Skeleton, V2Link } from "../parts";
import { Consequence, FixHead, FlowSteps, MoreDetail } from "../FixParts";
import { CcBanner, CcHBars, CcPage, type CcBarRow } from "./cc-parts";
import { TableExport } from "@/design/v2/TableExport";

const VIEWS: readonly RequestView[] = ["mine", "to_approve", "all"];
const OBJECTS: readonly RequestObject[] = ["material", "customer", "vendor", "business_partner"];
const KINDS: readonly RequestKind[] = ["create", "change", "mass_change"];
const KEY_NAME: Record<RequestObject, string> = { material: "MATNR", customer: "KUNNR", vendor: "LIFNR", business_partner: "PARTNER" };
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

/** Record keys from pasted text or the `keys` address parameter: split on lines, commas and spaces; a bare number gets the object's key field. */
export function parseKeys(text: string, object: RequestObject): string[] {
  const out = text.split(/[\s,;]+/).filter(Boolean).map((k) => (k.includes("=") ? k : `${KEY_NAME[object]}=${k}`));
  return [...new Set(out)];
}

/** Each record of a mass change with its current and new value; the code and its text sit together. */
function MassPreviewGrid({ id }: { id: string }) {
  const q = useMassPreview(id);
  if (q.isError) return <ErrorFrame onRetry={() => void q.refetch()}>{t("The preview could not be read.")}</ErrorFrame>;
  if (!q.data) return <Skeleton width="100%" height={120} />;
  const { counts, rows } = q.data;
  return (
    <div data-testid="mass-preview">
      <p className="m2-prov">
        {t("{records} {n, plural, one {record} other {records}}: {found} found, {missing} not found, {changing} would change, {unchanged} already hold the value.", { records: counts.records, n: counts.records, found: counts.found, missing: counts.missing, changing: counts.changing, unchanged: counts.unchanged })}
      </p>
      <TableExport><table className="m2-tbl" aria-label={t("Preview of the mass change")}>
        <thead>
          <tr>
            <th scope="col">{t("Record")}</th>
            <th scope="col">{t("Field")}</th>
            <th scope="col">{t("Current value")}</th>
            <th scope="col">{t("New value")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.record_key}|${r.field}`}>
              <td>
                <Coded code={r.record_key} text={r.known ? r.text ?? "" : t("Not found")} />
              </td>
              <td>
                <Coded code={r.field} text={describeField(r.field)} />
              </td>
              <td>{r.before === null ? "" : <Mono>{r.before}</Mono>}</td>
              <td>
                <Mono>{r.after}</Mono>
              </td>
            </tr>
          ))}
        </tbody>
      </table></TableExport>
      {q.data.truncated ? <p className="m2-prov">{t("Only the first rows are shown.")}</p> : null}
    </div>
  );
}

/** The new request form: object, kind and fields; Check creates the draft and runs the pre-checks, Submit sends it into approval. */
function NewRequest({ onDone, initialKeys }: { onDone: (id: string) => void; initialKeys: string }) {
  const qc = useQueryClient();
  const [object, setObject] = useState<RequestObject>("material");
  const [kind, setKind] = useState<RequestKind>(initialKeys ? "mass_change" : "create");
  const [key, setKey] = useState("");
  const [title, setTitle] = useState("");
  const [fields, setFields] = useState("");
  const [keys, setKeys] = useState(initialKeys.replace(/[,;]/g, "\n"));
  const [massField, setMassField] = useState("");
  const [massValue, setMassValue] = useState("");
  const [draft, setDraft] = useState<ChangeRequest | null>(null);
  const [check, setCheck] = useState<Precheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mass = kind === "mass_change";
  const recordKeys = parseKeys(keys, object);
  const payload = mass ? (massField.trim() && massValue.trim() ? { [massField.trim().toUpperCase()]: massValue.trim() } : {}) : parseFields(fields);
  const empty = Object.keys(payload).length === 0 || (kind === "change" && !key.trim()) || (mass && recordKeys.length === 0);
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
      const d = draft ?? (await createRequest({ kind, object, object_key: kind === "change" ? key.trim() : null, title: title.trim() || null, payload, ...(mass ? { record_keys: recordKeys } : {}) }));
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
        {mass ? (
          <>
            <label className="m2-fld m2-wide">
              <span className="m2-lbl">{t("Record keys, one per line; a bare number takes the key field of the object")}</span>
              <textarea rows={6} value={keys} spellCheck={false} placeholder="MATNR=000000000000000101" onChange={(e) => (setKeys(e.target.value), edit())} />
            </label>
            <label className="m2-fld">
              <span className="m2-lbl">{t("Field, as TABLE.FIELD")}</span>
              <input value={massField} maxLength={60} spellCheck={false} placeholder="MARC.DISPO" onChange={(e) => (setMassField(e.target.value), edit())} />
              {massField.trim() ? <span className="m2-prov">{describeField(massField.trim().toUpperCase())}</span> : null}
            </label>
            <label className="m2-fld">
              <span className="m2-lbl">{t("New value")}</span>
              <input value={massValue} maxLength={500} onChange={(e) => (setMassValue(e.target.value), edit())} />
            </label>
            <p className="m2-prov">{t("Meridian shows each record's current value from its own data. Nothing is written to SAP; an approved mass change leaves a load file.")}</p>
          </>
        ) : (
          <label className="m2-fld m2-wide">
            <span className="m2-lbl">{t("Fields, one TABLE.FIELD=value per line")}</span>
            <textarea rows={6} value={fields} spellCheck={false} placeholder="MARA.MATKL=001" onChange={(e) => (setFields(e.target.value), edit())} />
          </label>
        )}
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
      {mass && draft ? <MassPreviewGrid id={draft.id} /> : null}
      {error ? <p className="m2-prov" role="alert">{error}</p> : null}
    </section>
  );
}

/** The values filled into an empty field of a new create request; those who manage workflows add and remove them. */
function EntryDefaults({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const q = useEntryDefaults();
  const [object, setObject] = useState<RequestObject>("material");
  const [field, setField] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["v2", "request-defaults"] });
    } catch (e) {
      setError(errorSentence(e, fallback));
    } finally {
      setBusy(false);
    }
  };
  const items = q.data?.items ?? [];
  return (
    <section className="m2-sec" aria-label={t("Entry defaults")} data-testid="entry-defaults">
      <p className="m2-prov">{t("A new create request gets these values in the fields its requester leaves empty. A change request is never defaulted.")}</p>
      {q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The entry defaults could not be read.")}</ErrorFrame>
      ) : items.length === 0 ? (
        <EmptyFrame>{t("No entry default is set.")}</EmptyFrame>
      ) : (
        <TableExport><table className="m2-tbl" aria-label={t("Entry defaults")}>
          <thead>
            <tr>
              <th scope="col">{t("Object")}</th>
              <th scope="col">{t("Field")}</th>
              <th scope="col">{t("Value")}</th>
              {canEdit ? <th scope="col">{t("Remove")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id}>
                <td>{objectWord(d.object)}</td>
                <td>
                  <Coded code={d.field} text={describeField(d.field)} />
                </td>
                <td>
                  <Mono>{d.value}</Mono>
                </td>
                {canEdit ? (
                  <td>
                    <button type="button" className="m2-btn m2-sm" disabled={busy} onClick={() => void act(() => deleteDefault(d.id), t("The default could not be removed."))}>
                      {t("Remove")}
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table></TableExport>
      )}
      {canEdit ? (
        <div className="m2-rfilters">
          <label>
            {t("Object")}
            <select className="m2-sel" value={object} onChange={(e) => setObject(e.target.value as RequestObject)}>
              {OBJECTS.map((o) => (
                <option key={o} value={o}>
                  {objectWord(o)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Field, as TABLE.FIELD")}
            <input value={field} maxLength={60} spellCheck={false} onChange={(e) => setField(e.target.value)} />
          </label>
          <label>
            {t("Value")}
            <input value={value} maxLength={500} onChange={(e) => setValue(e.target.value)} />
          </label>
          <button
            type="button"
            className="m2-btn"
            disabled={busy || !field.trim() || !value.trim()}
            onClick={() =>
              void act(async () => {
                await putDefault(object, field.trim(), value.trim());
                setField("");
                setValue("");
              }, t("The default could not be saved."))
            }
          >
            {t("Save default")}
          </button>
        </div>
      ) : null}
      {error ? <p className="m2-prov" role="alert">{error}</p> : null}
    </section>
  );
}

/** Run one change to a rules list, refresh that list, and keep the busy and error state; the rules sections share it. */
function useRuleAct(key: string) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["v2", key] });
    } catch (e) {
      setError(errorSentence(e, fallback));
    } finally {
      setBusy(false);
    }
  };
  return { act, busy, error };
}

function ObjectSelect({ value, onChange }: { value: RequestObject; onChange: (o: RequestObject) => void }) {
  return (
    <label>
      {t("Object")}
      <select className="m2-sel" value={value} onChange={(e) => onChange(e.target.value as RequestObject)}>
        {OBJECTS.map((o) => (
          <option key={o} value={o}>
            {objectWord(o)}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Rules that set a field of a request from other fields of it; applied when the request is saved, before the checks. */
function DerivationRules({ canEdit }: { canEdit: boolean }) {
  const q = useDerivations();
  const { act, busy, error } = useRuleAct("request-derivations");
  const [object, setObject] = useState<RequestObject>("material");
  const [whenField, setWhenField] = useState("");
  const [whenValues, setWhenValues] = useState("");
  const [target, setTarget] = useState("");
  const [copy, setCopy] = useState(false);
  const [value, setValue] = useState("");
  const [source, setSource] = useState("");
  const items = q.data?.items ?? [];
  const values = whenValues.split(",").map((v) => v.trim()).filter(Boolean);
  return (
    <section className="m2-sec" aria-label={t("Derivation rules")} data-testid="derivation-rules">
      <p className="m2-prov">{t("When a field of a request holds one of the listed values, another field of the same request is set to a fixed value or to a copy of a third field. A copy from an empty field is skipped. A derived value is marked as derived in the history of the request.")}</p>
      {q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The derivation rules could not be read.")}</ErrorFrame>
      ) : items.length === 0 ? (
        <EmptyFrame>{t("No derivation rule is set.")}</EmptyFrame>
      ) : (
        <TableExport><table className="m2-tbl" aria-label={t("Derivation rules")}>
          <thead>
            <tr>
              <th scope="col">{t("Object")}</th>
              <th scope="col">{t("When field")}</th>
              <th scope="col">{t("Is one of")}</th>
              <th scope="col">{t("Set field")}</th>
              <th scope="col">{t("Set to")}</th>
              {canEdit ? <th scope="col">{t("Remove")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id}>
                <td>{objectWord(d.object)}</td>
                <td>
                  <Coded code={d.when_field} text={describeField(d.when_field)} />
                </td>
                <td>
                  <Mono>{d.when_values.join(", ")}</Mono>
                </td>
                <td>
                  <Coded code={d.target_field} text={describeField(d.target_field)} />
                </td>
                <td>
                  {d.source_field ? (
                    <>
                      {t("Copy of")} <Coded code={d.source_field} text={describeField(d.source_field)} />
                    </>
                  ) : (
                    <Mono>{d.value}</Mono>
                  )}
                </td>
                {canEdit ? (
                  <td>
                    <button type="button" className="m2-btn m2-sm" disabled={busy} onClick={() => void act(() => deleteDerivation(d.id), t("The rule could not be removed."))}>
                      {t("Remove")}
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table></TableExport>
      )}
      {canEdit ? (
        <div className="m2-rfilters">
          <ObjectSelect value={object} onChange={setObject} />
          <label>
            {t("When field, as TABLE.FIELD")}
            <input value={whenField} maxLength={60} spellCheck={false} onChange={(e) => setWhenField(e.target.value)} />
          </label>
          <label>
            {t("Is one of, separated by commas")}
            <input value={whenValues} maxLength={500} spellCheck={false} onChange={(e) => setWhenValues(e.target.value)} />
          </label>
          <label>
            {t("Set field, as TABLE.FIELD")}
            <input value={target} maxLength={60} spellCheck={false} onChange={(e) => setTarget(e.target.value)} />
          </label>
          <label>
            {t("Set to")}
            <select value={copy ? "copy" : "value"} onChange={(e) => setCopy(e.target.value === "copy")}>
              <option value="value">{t("Constant value")}</option>
              <option value="copy">{t("Copy from field")}</option>
            </select>
          </label>
          {copy ? (
            <label>
              {t("Source field, as TABLE.FIELD")}
              <input value={source} maxLength={60} spellCheck={false} onChange={(e) => setSource(e.target.value)} />
              {source.trim() ? <span className="m2-prov">{describeField(source.trim().toUpperCase())}</span> : null}
            </label>
          ) : (
            <label>
              {t("To value")}
              <input value={value} maxLength={500} onChange={(e) => setValue(e.target.value)} />
            </label>
          )}
          <button
            type="button"
            className="m2-btn"
            disabled={busy || !whenField.trim() || values.length === 0 || !target.trim() || !(copy ? source.trim() : value.trim())}
            onClick={() =>
              void act(async () => {
                await putDerivation(object, whenField.trim(), values, target.trim(), copy ? { source_field: source.trim() } : { value: value.trim() });
                setWhenField("");
                setWhenValues("");
                setTarget("");
                setValue("");
                setSource("");
              }, t("The rule could not be saved."))
            }
          >
            {t("Save rule")}
          </button>
        </div>
      ) : null}
      {error ? <p className="m2-prov" role="alert">{error}</p> : null}
    </section>
  );
}

/** Fields whose change needs the extra critical field approval step. */
function CriticalFields({ canEdit }: { canEdit: boolean }) {
  const q = useCriticalFields();
  const { act, busy, error } = useRuleAct("request-critical-fields");
  const [object, setObject] = useState<RequestObject>("material");
  const [field, setField] = useState("");
  const items = q.data?.items ?? [];
  return (
    <section className="m2-sec" aria-label={t("Critical fields")} data-testid="critical-fields">
      <p className="m2-prov">{t("A request that touches one of these fields is flagged critical and needs a critical field approval step after the usual steps.")}</p>
      {q.isError ? (
        <ErrorFrame onRetry={() => void q.refetch()}>{t("The critical fields could not be read.")}</ErrorFrame>
      ) : items.length === 0 ? (
        <EmptyFrame>{t("No critical field is set.")}</EmptyFrame>
      ) : (
        <TableExport><table className="m2-tbl" aria-label={t("Critical fields")}>
          <thead>
            <tr>
              <th scope="col">{t("Object")}</th>
              <th scope="col">{t("Field")}</th>
              {canEdit ? <th scope="col">{t("Remove")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id}>
                <td>{objectWord(d.object)}</td>
                <td>
                  <Coded code={d.field} text={describeField(d.field)} />
                </td>
                {canEdit ? (
                  <td>
                    <button type="button" className="m2-btn m2-sm" disabled={busy} onClick={() => void act(() => deleteCriticalField(d.id), t("The critical field could not be removed."))}>
                      {t("Remove")}
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table></TableExport>
      )}
      {canEdit ? (
        <div className="m2-rfilters">
          <ObjectSelect value={object} onChange={setObject} />
          <label>
            {t("Field, as TABLE.FIELD")}
            <input value={field} maxLength={60} spellCheck={false} onChange={(e) => setField(e.target.value)} />
          </label>
          <button
            type="button"
            className="m2-btn"
            disabled={busy || !field.trim()}
            onClick={() =>
              void act(async () => {
                await putCriticalField(object, field.trim());
                setField("");
              }, t("The critical field could not be saved."))
            }
          >
            {t("Save critical field")}
          </button>
        </div>
      ) : null}
      {error ? <p className="m2-prov" role="alert">{error}</p> : null}
    </section>
  );
}

/** ETA of the waiting step and the chance it misses its SLA, from how long the same step took on decided requests. */
function ForecastCell({ f }: { f: ForecastRow | undefined }) {
  if (!f) return null;
  if (f.eta == null) return <span className="m2-meta">{t("No history")}</span>;
  const p = f.breach_probability;
  const risk = f.breached || (p != null && p >= 0.5);
  return (
    <span data-testid={`forecast-${f.request_id}`} title={t("{step}: from {n, plural, one {# decided task} other {# decided tasks}}", { step: f.step, n: f.n })}>
      {formatDate(f.eta, "date")}{" "}
      {f.breached ? <strong>{t("SLA missed")}</strong> : p == null ? null : risk ? <strong>{t("{p} breach risk", { p: pct1(p) })}</strong> : <span className="m2-meta">{t("{p} breach risk", { p: pct1(p) })}</span>}
    </span>
  );
}

function Table({ rows }: { rows: ChangeRequest[] }) {
  const { open, hrefFor } = useOpenItem();
  const openId = open?.kind === "request" ? open.id : null;
  const waiting = rows.some((r) => r.status === "submitted" || r.status === "in_approval");
  const fc = useApprovalForecast(waiting);
  const byId = new Map((fc.data?.requests ?? []).map((f) => [f.request_id, f]));
  return (
    <div className="m2-frame">
      <TableExport><table className="m2-tbl" aria-label={t("Change requests")} data-testid="requests-table">
        <thead>
          <tr>
            <th scope="col">{t("Request")}</th>
            <th scope="col">{t("Object")}</th>
            <th scope="col">{t("Kind")}</th>
            <th scope="col">{t("Status")}</th>
            <th scope="col">{t("Requester")}</th>
            <th scope="col">{t("Updated")}</th>
            <th scope="col">{t("Age")}</th>
            <th scope="col">{t("Due")}</th>
            <th scope="col">{t("Forecast")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} aria-current={openId === r.id ? "true" : undefined}>
              <td>
                <V2Link href={hrefFor({ kind: "request", id: r.id })} className="m2-rowlink">
                  {r.title || (r.kind === "mass_change" ? t("Mass change of {n} {count, plural, one {record} other {records}}", { n: r.record_count, count: r.record_count }) : r.object_key ? <Mono>{r.object_key}</Mono> : t("Untitled request"))}
                </V2Link>
              </td>
              <td>{objectWord(r.object)}</td>
              <td>{kindWord(r.kind)}</td>
              <td>{statusWord(r.status)}</td>
              <td>{r.requester_label ?? ""}</td>
              <td>{formatDate(r.updated_at, "date")}</td>
              <td>{r.age_hours != null ? ageWord(r.age_hours) : ""}</td>
              <td>
                {r.due_at ? formatDate(r.due_at, "date") : ""}
                {r.overdue ? <strong>{` ${t("Overdue")}`}</strong> : null}
              </td>
              <td><ForecastCell f={byId.get(r.id)} /></td>
            </tr>
          ))}
        </tbody>
      </table></TableExport>
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
  const [keysParam] = useUrlParam<string>("keys", "");
  const [composing, setComposing] = useState(keysParam !== "");
  const [showDefaults, setShowDefaults] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const q = useRequests({ view, status: status === "all" ? undefined : status, object: object === "all" ? undefined : object, kind: kind === "all" ? undefined : kind });
  const rows = q.data?.items ?? [];
  const canWrite = session.can("mdm.write") && !session.shared;
  const waiting = rows.filter((r) => r.status === "submitted" || r.status === "in_approval").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  const drafts = rows.filter((r) => r.status === "draft").length;
  const overdue = rows.filter((r) => r.overdue).length;
  const counts = new Map<string, number>();
  for (const r of rows) {
    const who = r.requester_label ?? "";
    if (who) counts.set(who, (counts.get(who) ?? 0) + 1);
  }
  const byPerson = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([who, n]) => ({ key: who, label: who, value: n, text: t("{n} {count, plural, one {request} other {requests}}", { n, count: n }) }));
  const tone = (s: RequestStatus): CcBarRow["tone"] => (s === "failed" || s === "rejected" ? "crit" : s === "created" ? "pass" : s === "submitted" || s === "in_approval" ? "warn" : "data");
  const pipeline = STATUSES.map((s) => {
    const n = rows.filter((r) => r.status === s).length;
    return { key: s, label: statusWord(s), value: n, tone: tone(s), text: t("{n} {count, plural, one {request} other {requests}}", { n, count: n }) };
  });
  return (
    <CcPage>
    <div data-testid="requests-canvas">
      <PageTitle sub={t("Create and change master data with approval")}>{t("Requests")}</PageTitle>
      <CcBanner
        testId="requests-banner"
        label={t("Requests")}
        eyebrow={t("Change requests")}
        verdict={failed > 0 || overdue > 0 ? "no-go" : waiting > 0 ? "at-risk" : "go"}
        headline={waiting > 0 ? t("{n} {waiting, plural, one {request waits} other {requests wait}} for approval", { n: waiting, waiting }) : t("No request waits for approval")}
        why={overdue > 0 ? t("{n} {overdue, plural, one {request is} other {requests are}} past the due time of the waiting approval step.", { n: overdue, overdue }) : failed > 0 ? t("{n} {failed, plural, one {request} other {requests}} failed to reach SAP and need a new look.", { n: failed, failed }) : t("Nothing has failed in this list.")}
        figs={[
          { label: t("Waiting"), value: waiting, note: t("submitted or in approval") },
          { label: t("Overdue"), value: overdue, note: t("past the step due time"), tone: overdue > 0 ? "crit" : undefined },
          { label: t("Failed"), value: failed, note: t("did not reach SAP") },
          { label: t("Drafts"), value: drafts, note: t("not yet submitted") },
        ]}
        action={
          <>
          <button type="button" className="m2-btn m2-strong" aria-expanded={composing} disabled={!canWrite} title={canWrite ? undefined : t("A new request needs the master data write permission")} onClick={() => setComposing((c) => !c)}>
            {t("New request")}
          </button>
          {canWrite ? (
            <V2Link href="/requests/new" className="m2-btn">
              {t("Use the form")}
            </V2Link>
          ) : null}
          </>
        }
      />
      <FixHead
        lede={t("This page lists requests to create or change master data. Each goes through approval before it reaches SAP. A request belongs to a record, not to a scoring run, so rows carry no run. Start with New request, or open one that waits for you.")}
        means={[
          [t("Waiting"), t("Requests submitted or in approval.")],
          [t("Overdue"), t("Waiting requests past the due time of the current approval step.")],
          [t("Failed"), t("Requests approved that did not reach SAP.")],
          [t("Drafts"), t("Requests saved but not yet submitted.")],
        ]}
      />
      <FlowSteps
        label={t("Request steps")}
        current={failed > 0 ? 3 : waiting > 0 ? 2 : drafts > 0 ? 1 : 0}
        steps={[
          { label: t("Start a request"), hint: t("Choose New request and fill in the record.") },
          { label: t("Submit it"), count: String(drafts), hint: t("A saved draft does nothing until you submit it.") },
          { label: t("Approvers decide"), count: String(waiting), hint: t("Each approval step has a due time.") },
          { label: t("It reaches SAP"), count: String(failed), hint: t("The count shows requests that did not reach SAP.") },
        ]}
      />
      {composing ? (
        <NewRequest
          initialKeys={keysParam}
          onDone={(id) => {
            setComposing(false);
            openItem({ kind: "request", id });
          }}
        />
      ) : null}
      <div className="m2-cta">
        <div className="m2-seg" role="group" aria-label={t("Requests views")}>
          {VIEWS.map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
              {viewWord(v)}
            </button>
          ))}
        </div>
      </div>
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
      <Consequence>{t("Submitting sends the request for approval. Nothing reaches SAP until every approval step is done.")}</Consequence>
      <MoreDetail title={t("Charts, entry defaults and derivation rules")}>
      {rows.length > 0 ? (
        <div className="m2-cc-row">
          <section className="m2-cc-card" aria-label={t("Requests by stage")} data-testid="requests-pipeline">
            <h3>{t("Requests by stage")}</h3>
            <CcHBars label={t("Requests by stage, from draft to SAP")} rows={pipeline} />
          </section>
          {byPerson.length > 0 ? (
            <section className="m2-cc-card" aria-label={t("Requests per person")} data-testid="requests-workload">
              <h3>{t("Requests per person")}</h3>
              <CcHBars label={t("Requests per person")} rows={byPerson} />
            </section>
          ) : null}
        </div>
      ) : null}
      <div className="m2-cta">
        <button type="button" className="m2-btn" aria-expanded={showDefaults} onClick={() => setShowDefaults((v) => !v)}>
          {t("Entry defaults")}
        </button>
        <button type="button" className="m2-btn" aria-expanded={showRules} onClick={() => setShowRules((v) => !v)}>
          {t("Derivations and critical fields")}
        </button>
      </div>
      {showDefaults ? <EntryDefaults canEdit={session.can("manage_workflows") && !session.shared} /> : null}
      {showRules ? (
        <>
          <DerivationRules canEdit={session.can("manage_workflows") && !session.shared} />
          <CriticalFields canEdit={session.can("manage_workflows") && !session.shared} />
        </>
      ) : null}
      </MoreDetail>
    </div>
    </CcPage>
  );
}
