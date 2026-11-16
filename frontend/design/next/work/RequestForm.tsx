"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errorSentence } from "@/lib/api/v2/client";
import { createRequest, submitRequest, validateRequest, type ChangeRequest, type FormField, type Precheck, type RequestObject } from "@/lib/api/v2/requests";
import { useOpenItem, useUrlParam, useV2Session } from "@/lib/v2/hooks";
import { t } from "@/lib/v2/i18n";
import { useRequestForm } from "@/lib/v2/requests-queries";
import { objectWord } from "@/design/v2/inspector/request";
import { Button, Code, EmptyState, ErrorState, Skeleton } from "../kit";
import { PrecheckView } from "./Requests";
import "./queue.css";

const OBJECTS: readonly RequestObject[] = ["material", "customer", "vendor", "business_partner"];
const NUMERIC = ["DEC", "QUAN", "CURR", "INT1", "INT2", "INT4", "FLTP", "NUMC"];
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
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{t("Not set")}</option>
        {f.values.map((v) => (
          <option key={v.value} value={v.value}>
            {v.label && v.label !== v.value ? `${v.value}  ${v.label}` : v.value}
          </option>
        ))}
      </select>
    );
  return (
    <input
      id={id}
      value={value}
      maxLength={f.length > 0 ? f.length + (f.decimals ? 1 : 0) : undefined}
      inputMode={NUMERIC.includes(f.type) ? "decimal" : undefined}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** The data collection form: real SAP fields of an object, its rules run before the request goes for approval. */
export function WorkRequestForm() {
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
    <div className="nx-wq" data-testid="request-form">
      <h1 className="nx-wq-h">{t("Data collection form")}</h1>
      <p className="nx-wq-meta">{t("Fill in the SAP fields of a new or changed record. Meridian runs the object's rules before it goes for approval. Nothing is written to SAP until the request is approved.")}</p>
      {!canWrite ? (
        <EmptyState heading={t("Creating a request needs the master data write permission.")} />
      ) : (
        <section className="nx-wq" aria-label={t("Data collection form")}>
          <div className="nx-wq-bar">
            <label>
              {t("Object")}
              <select value={object} onChange={(e) => (setObject(e.target.value as RequestObject), setValues({}), edit())} data-testid="form-object">
                {OBJECTS.map((o) => (
                  <option key={o} value={o}>
                    {objectWord(o)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Kind")}
              <select value={kind} onChange={(e) => (setKind(e.target.value as Kind), edit())}>
                <option value="create">{t("New record")}</option>
                <option value="change">{t("Change a record")}</option>
              </select>
            </label>
            <Link className="nx-wq-link" href="/requests">
              {t("All requests")}
            </Link>
          </div>
          <div className="nx-wq-form">
            {kind === "change" ? (
              <label>
                {t("SAP key of the record to change, {field}", { field: form.data?.key_field ?? "" })}
                <input value={key} onChange={(e) => (setKey(e.target.value), edit())} />
              </label>
            ) : null}
            <label>
              {t("Title")}
              <input value={title} maxLength={200} onChange={(e) => (setTitle(e.target.value), edit())} />
            </label>
          </div>
          {form.isLoading ? (
            <Skeleton lines={6} />
          ) : form.isError ? (
            <ErrorState sentence={errorSentence(form.error, t("The form could not be loaded."))} onRetry={() => void form.refetch()} />
          ) : fields.length === 0 ? (
            <EmptyState heading={t("This object has no form fields.")} />
          ) : (
            byTable(fields).map(([table, fs]) => (
              <div key={table} className="nx-wq-card" role="group" aria-label={`${table} ${fs[0].table_label}`} data-testid={`form-table-${table}`}>
                <h2 className="nx-wq-row">
                  <Code code={table} text={fs[0].table_label} />
                </h2>
                <div className="nx-wq-form">
                  {fs.map((f) => {
                    const fails = failuresOf(f.field);
                    return (
                      <div key={f.field} className="nx-wq-cell" data-field={f.field}>
                        <label htmlFor={`fld-${f.field}`}>
                          <span className="nx-wq-row">
                            <Code code={f.name} text={f.label} />
                            {f.required && kind === "create" ? <small title={t("Required to create")}>{t("required")}</small> : null}
                          </span>
                        </label>
                        <Input f={f} value={values[f.field] ?? ""} onChange={(v) => (setValues({ ...values, [f.field]: v }), edit())} />
                        {f.check_table ? <small>{t("Checked against {table} {label}", { table: f.check_table, label: f.check_table_label ?? "" })}</small> : null}
                        {fails.map((x) => (
                          <small key={x.check_id} role="alert" data-testid="field-failure">
                            <Code code={x.check_id} text={x.message} />
                          </small>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
          {missing.length > 0 ? <p className="nx-wq-meta">{t("Still needed to create: {fields}", { fields: missing.map((f) => f.label).join(", ") })}</p> : null}
          <div className="nx-wq-row">
            <Button variant="secondary" loading={busy} disabled={busy || empty} onClick={() => void validate()}>
              {t("Check against the rules")}
            </Button>
            <Button variant="primary" disabled={busy || !check || check.problems.length > 0} onClick={() => void submit()}>
              {t("Submit for approval")}
            </Button>
          </div>
          {check ? <PrecheckView p={check} /> : null}
          {error ? (
            <p className="nx-wq-meta" role="alert">
              {error}
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}
