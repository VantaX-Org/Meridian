"use client";

import "../approvals.css";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { createRequest, submitRequest, validateRequest, type ChangeRequest, type FormField, type Precheck, type RequestObject } from "@/lib/api/v2/requests";
import { useOpenItem, useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { useRequestForm } from "@/lib/v2/requests-queries";
import { t } from "@/lib/v2/i18n";
import { objectWord, PrecheckView } from "../inspector/request";
import { EmptyFrame, ErrorFrame, Mono, PageTitle, Skeleton, V2Link } from "../parts";

const OBJECTS: readonly RequestObject[] = ["material", "customer", "vendor", "business_partner"];
type Kind = "create" | "change";

/** Fields grouped by their SAP table, in the order the API sends them (required first). */
function byTable(fields: FormField[]): [string, FormField[]][] {
  const out = new Map<string, FormField[]>();
  for (const f of fields) out.set(f.table, [...(out.get(f.table) ?? []), f]);
  return [...out.entries()];
}

function Input({ f, value, onChange }: { f: FormField; value: string; onChange: (v: string) => void }) {
  const id = `fld-${f.field}`;
  if (f.values.length > 0)
    return (
      <select id={id} className="m2-sel" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("Not set")}</option>
        {f.values.map((v) => (
          <option key={v.value} value={v.value}>
            {v.label && v.label !== v.value ? `${v.value}  ${v.label}` : v.value}
          </option>
        ))}
      </select>
    );
  const numeric = ["DEC", "QUAN", "CURR", "INT1", "INT2", "INT4", "FLTP", "NUMC"].includes(f.type);
  return <input id={id} value={value} maxLength={f.length > 0 ? f.length + (f.decimals ? 1 : 0) : undefined} inputMode={numeric ? "decimal" : undefined} spellCheck={false} onChange={(e) => onChange(e.target.value)} />;
}

/** The data collection form: real SAP fields of an object, its rules run before the request goes for approval. */
export function RequestFormCanvas() {
  const session = useV2Session();
  const qc = useQueryClient();
  const { openItem } = useOpenItem();
  const [object, setObject] = useUrlParam<RequestObject>("object", "material", OBJECTS);
  const [system] = useUrlParam<string>("system", "");
  const [kind, setKind] = useState<Kind>("create");
  const [key, setKey] = useState("");
  const [title, setTitle] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<ChangeRequest | null>(null);
  const [check, setCheck] = useState<Precheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRequestForm(object, system || undefined);
  const canWrite = session.can("mdm.write") && !session.shared;
  const fields = form.data?.fields ?? [];
  const payload = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, v.trim()]));
  const missing = kind === "create" ? fields.filter((f) => f.required && !payload[f.field]) : [];
  const empty = Object.keys(payload).length === 0 || (kind === "change" && !key.trim());
  const failuresOf = (field: string) => check?.failures.filter((x) => x.field === field) ?? [];
  const edit = () => (setDraft(null), setCheck(null));
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
      const d = draft ?? (await createRequest({ kind, object, object_key: kind === "change" ? key.trim() : null, title: title.trim() || null, payload, target_system_id: system || null }));
      setDraft(d);
      setCheck(await validateRequest(d.id));
      await qc.invalidateQueries({ queryKey: ["v2", "change-requests"] });
    }, t("The request could not be checked."));
  const submit = () =>
    run(async () => {
      if (!draft) return;
      await submitRequest(draft.id);
      await qc.invalidateQueries({ queryKey: ["v2"] });
      openItem({ kind: "request", id: draft.id });
    }, t("The request could not be submitted."));

  return (
    <div data-testid="request-form">
      <PageTitle sub={t("Fill in the SAP fields of a new or changed record. Meridian runs the object's rules before it goes for approval. Nothing is written to SAP until the request is approved.")}>{t("Data collection form")}</PageTitle>
      {!canWrite ? (
        <EmptyFrame>{t("Creating a request needs the master data write permission.")}</EmptyFrame>
      ) : (
        <section className="m2-sec" aria-label={t("Data collection form")}>
          <div className="m2-rfilters">
            <label>
              {t("Object")}
              <select className="m2-sel" value={object} onChange={(e) => (setObject(e.target.value as RequestObject), setValues({}), edit())} data-testid="form-object">
                {OBJECTS.map((o) => (
                  <option key={o} value={o}>
                    {objectWord(o)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Kind")}
              <select className="m2-sel" value={kind} onChange={(e) => (setKind(e.target.value as Kind), edit())}>
                <option value="create">{t("New record")}</option>
                <option value="change">{t("Change a record")}</option>
              </select>
            </label>
            <V2Link href="/requests">{t("All requests")}</V2Link>
          </div>
          <div className="m2-compose">
            {kind === "change" ? (
              <label className="m2-fld m2-wide">
                <span className="m2-lbl">{t("SAP key of the record to change, {field}", { field: form.data?.key_field ?? "" })}</span>
                <input value={key} onChange={(e) => (setKey(e.target.value), edit())} />
              </label>
            ) : null}
            <label className="m2-fld m2-wide">
              <span className="m2-lbl">{t("Title")}</span>
              <input value={title} maxLength={200} onChange={(e) => (setTitle(e.target.value), edit())} />
            </label>
          </div>
          {form.isLoading ? (
            <Skeleton width="100%" height={160} />
          ) : form.isError ? (
            <ErrorFrame onRetry={() => void form.refetch()}>{errorSentence(form.error, t("The form could not be loaded."))}</ErrorFrame>
          ) : (
            byTable(fields).map(([table, fs]) => (
              <div key={table} role="group" aria-label={`${table} ${fs[0].table_label}`} data-testid={`form-table-${table}`}>
                <h3 className="m2-h3">
                  <Mono>{table}</Mono> {fs[0].table_label}
                </h3>
                <div className="m2-compose">
                {fs.map((f) => {
                  const fails = failuresOf(f.field);
                  return (
                    <div key={f.field} className="m2-fld" data-field={f.field}>
                      <label className="m2-lbl" htmlFor={`fld-${f.field}`}>
                        {f.label} <Mono>{f.name}</Mono>
                        {f.required && kind === "create" ? <span title={t("Required to create")}>{" "}{t("required")}</span> : null}
                      </label>
                      <Input f={f} value={values[f.field] ?? ""} onChange={(v) => (setValues({ ...values, [f.field]: v }), edit())} />
                      {f.check_table ? <span className="m2-prov">{t("Checked against {table} {label}", { table: f.check_table, label: f.check_table_label ?? "" })}</span> : null}
                      {fails.map((x) => (
                        <span key={x.check_id} className="m2-prov" role="alert" data-testid="field-failure">
                          {x.check_id}: {x.message}
                        </span>
                      ))}
                    </div>
                  );
                })}
                </div>
              </div>
            ))
          )}
          {missing.length > 0 ? <p className="m2-prov">{t("Still needed to create: {fields}", { fields: missing.map((f) => f.label).join(", ") })}</p> : null}
          <div className="m2-cta">
            <button type="button" className="m2-btn" disabled={busy || empty} onClick={() => void validate()}>
              {t("Check against the rules")}
            </button>
            <button type="button" className="m2-btn m2-strong" disabled={busy || !check || check.problems.length > 0} onClick={() => void submit()}>
              {t("Submit for approval")}
            </button>
          </div>
          {check ? <PrecheckView p={check} /> : null}
          {error ? <p className="m2-prov" role="alert">{error}</p> : null}
        </section>
      )}
    </div>
  );
}
