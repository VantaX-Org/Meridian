"use client";

import { Flow, REQUEST_STEPS } from "@/ui/screens/flow";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  createRequest, deleteCriticalField, deleteDefault, deleteDerivation, getRequestForm, listCriticalFields, listDefaults, listDerivations,
  putCriticalField, putDefault, putDerivation, submitRequest, updateRequest, validateRequest,
  type FormField, type Precheck, type RequestKind, type RequestObject,
} from "@/lib/api/v2/requests";
import { useFixture, withFixture } from "@/lib/api/v2/fixture";
import { errorSentence } from "@/lib/api/v2/client";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Code, DataTable, Field, Input, Select, Split, Tabs, useToast } from "@/ui/kit";
import { Async, Empty, Head, useRead, useScreenScope, useSystemPick } from "../mdm/catalogue/shared";
import { kindText, objectText } from "./RequestsScreen";

const OBJECTS: RequestObject[] = ["material", "customer", "vendor", "business_partner"];
const KINDS: RequestKind[] = ["create", "change", "mass_change"];

const SAMPLE_VALUES = "FERT, HALB"; // i18n-ignore: sample SAP codes

export function PrecheckView({ p }: { p: Precheck }) {
  return (
    <Card title={t("Checks before submission")} sub={`${p.rules_run} ${t("rules run")}`}>
      {p.problems.length ? <p className="mx-muted">{p.problems.join(", ")}</p> : null}
      {p.failures.length ? (
        <DataTable label={t("Failed checks")} rows={p.failures} rowKey={(f) => `${f.check_id}-${f.field ?? ""}`} height={200} rowHeight={36}
          columns={[
            { key: "c", label: t("Check"), render: (f) => <Code code={f.check_id} description={f.message} /> },
            { key: "f", label: t("Field"), render: (f) => (f.field ? <Code code={f.field} /> : t("n/a")) },
            { key: "s", label: t("Severity"), render: (f) => f.severity },
          ]} />
      ) : <p className="mx-muted">{t("No failed checks")}</p>}
      {p.duplicates.length ? (
        <DataTable label={t("Possible duplicates")} rows={p.duplicates} rowKey={(d) => d.master_record_id} height={160} rowHeight={36}
          columns={[
            { key: "k", label: t("Existing record"), render: (d) => <Code code={d.sap_object_key ?? d.master_record_id} description={d.domain} /> },
            { key: "s", label: t("Match score"), align: "end", sort: (d) => d.score, render: (d) => `${Math.round(d.score * 100)}%` },
            { key: "b", label: t("Band"), render: (d) => d.band },
          ]} />
      ) : null}
    </Card>
  );
}

function FormInput({ f, value, onChange }: { f: FormField; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={`${f.label} (${f.field})`} hint={f.required ? t("Required") : undefined}>
      {f.values.length ? (
        <Select value={value} onChange={(e) => onChange(e.target.value)}
          options={[{ value: "", label: t("Choose a value") }, ...f.values.map((v) => ({ value: v.value, label: `${v.value} ${v.label}` }))]} />
      ) : <Input value={value} maxLength={f.length || undefined} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

/** Defaults, derivations and critical fields: the rules that shape request entry. */
function EntryRules() {
  const toast = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState("defaults");
  const [o, setO] = useState<RequestObject>("material");
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [c, setC] = useState("");
  const defs = useRead(["cr", "defaults"], listDefaults, tab === "defaults");
  const ders = useRead(["cr", "derivations"], listDerivations, tab === "derivations");
  const crit = useRead(["cr", "critical"], listCriticalFields, tab === "critical");
  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ["b7b"] });
      setA(""); setB(""); setC("");
    } catch { toast(t("The change could not be saved"), "bad"); }
  };
  const del = (fn: () => Promise<unknown>) => <Button variant="ghost" onClick={() => void run(fn)}>{t("Remove")}</Button>;
  return (
    <Card title={t("Entry rules")} sub={t("Defaults, derivations and critical fields")}>
      <Tabs idBase="er" label={t("Entry rule types")} value={tab} onChange={(v) => { setTab(v); setA(""); setB(""); setC(""); }}
        items={[{ id: "defaults", label: t("Defaults") }, { id: "derivations", label: t("Derivations") }, { id: "critical", label: t("Critical fields") }]} />
      <Field label={t("Object")}><Select value={o} onChange={(e) => setO(e.target.value as RequestObject)} options={OBJECTS.map((x) => ({ value: x, label: objectText(x) }))} /></Field>
      {tab === "defaults" ? (
        <>
          <Field label={t("Field")}><Input value={a} placeholder="MARA.MTART" onChange={(e) => setA(e.target.value)} /></Field>
          <Field label={t("Value")}><Input value={b} onChange={(e) => setB(e.target.value)} /></Field>
          <Button variant="primary" disabled={!a || !b} onClick={() => void run(() => putDefault(o, a, b))}>{t("Save default")}</Button>
          <Async q={defs} lines={3}>{(d) => d.items.length ? (
            <DataTable label={t("Defaults")} rows={d.items} rowKey={(x) => x.id} height={200} rowHeight={36} columns={[
              { key: "f", label: t("Field"), render: (x) => <Code code={x.field} description={objectText(x.object)} /> },
              { key: "v", label: t("Value"), render: (x) => x.value },
              { key: "d", label: "", render: (x) => del(() => deleteDefault(x.id)) },
            ]} />) : <Empty heading={t("No defaults yet")} />}</Async>
        </>
      ) : null}
      {tab === "derivations" ? (
        <>
          <Field label={t("When this field")}><Input value={a} placeholder="MARA.MTART" onChange={(e) => setA(e.target.value)} /></Field>
          <Field label={t("has one of these values, comma separated")}><Input value={b} placeholder={SAMPLE_VALUES} onChange={(e) => setB(e.target.value)} /></Field>
          <Field label={t("set this field")}><Input value={c} placeholder="MARA.MATKL" onChange={(e) => setC(e.target.value)} /></Field>
          <DerivationSave disabled={!a || !b || !c} onSave={(act) => void run(() => putDerivation(o, a, b.split(",").map((s) => s.trim()).filter(Boolean), c, act))} />
          <Async q={ders} lines={3}>{(d) => d.items.length ? (
            <DataTable label={t("Derivations")} rows={d.items} rowKey={(x) => x.id} height={200} rowHeight={36} columns={[
              { key: "w", label: t("When"), render: (x) => <Code code={x.when_field} description={x.when_values.join(", ")} /> },
              { key: "t", label: t("Sets"), render: (x) => <Code code={x.target_field} description={x.value ?? x.source_field ?? undefined} /> },
              { key: "d", label: "", render: (x) => del(() => deleteDerivation(x.id)) },
            ]} />) : <Empty heading={t("No derivations yet")} />}</Async>
        </>
      ) : null}
      {tab === "critical" ? (
        <>
          <Field label={t("Field")} hint={t("A change to this field adds a critical field approval step.")}><Input value={a} placeholder="LFA1.BANKN" onChange={(e) => setA(e.target.value)} /></Field>
          <Button variant="primary" disabled={!a} onClick={() => void run(() => putCriticalField(o, a))}>{t("Mark critical")}</Button>
          <Async q={crit} lines={3}>{(d) => d.items.length ? (
            <DataTable label={t("Critical fields")} rows={d.items} rowKey={(x) => x.id} height={200} rowHeight={36} columns={[
              { key: "f", label: t("Field"), render: (x) => <Code code={x.field} description={objectText(x.object)} /> },
              { key: "d", label: "", render: (x) => del(() => deleteCriticalField(x.id)) },
            ]} />) : <Empty heading={t("No critical fields yet")} />}</Async>
        </>
      ) : null}
    </Card>
  );
}

/** A derivation sets a fixed value or copies another field; this picks which. */
function DerivationSave({ disabled, onSave }: { disabled: boolean; onSave: (a: { value: string } | { source_field: string }) => void }) {
  const [mode, setMode] = useState("value");
  const [v, setV] = useState("");
  return (
    <>
      <Field label={t("to")}><Select value={mode} onChange={(e) => setMode(e.target.value)} options={[{ value: "value", label: t("this fixed value") }, { value: "source_field", label: t("a copy of this field") }]} /></Field>
      <Field label={mode === "value" ? t("Value") : t("Field")}><Input value={v} onChange={(e) => setV(e.target.value)} /></Field>
      <Button variant="primary" disabled={disabled || !v} onClick={() => onSave(mode === "value" ? { value: v } : { source_field: v })}>{t("Save derivation")}</Button>
    </>
  );
}

export function RequestNewScreen() {
  const router = useRouter();
  const fx = useFixture();
  const toast = useToast();
  const sys = useSystemPick();
  const [object, setObject] = useState<RequestObject>("material");
  const [kind, setKind] = useState<RequestKind>("create");
  const [title, setTitle] = useState("");
  const [key, setKey] = useState("");
  const [keys, setKeys] = useState("");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [draftId, setDraftId] = useState("");
  const [pre, setPre] = useState<Precheck | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRead(["cr", "form", object, sys.id], () => getRequestForm(object, sys.id || undefined));
  useScreenScope("request-new", t("New request"), [
    { prompt: t("What does this request need?"), answer: () => ({ text: (form.data?.fields ?? []).filter((f) => f.required).map((f) => f.field).join(", ") || t("None") }) },
  ]);

  const save = async (): Promise<string> => {
    const records = keys.split(/[\s,]+/).filter(Boolean);
    // a saved draft keeps the record, the records and the system edited after it, not only the title and values
    if (draftId) {
      await updateRequest(draftId, { title, payload: vals, object_key: kind === "change" ? key : undefined, record_keys: kind === "mass_change" ? records : undefined, target_system_id: sys.id || undefined });
      return draftId;
    }
    const r = await createRequest({ kind, object, target_system_id: sys.id || null, object_key: key || null, title: title || null, payload: vals, record_keys: kind === "mass_change" ? records : undefined });
    setDraftId(r.id);
    return r.id;
  };
  const act = async (fn: (id: string) => Promise<void>) => {
    setBusy(true);
    // the API's reason (e.g. "Propose at least one field.") tells the person what to fix
    try { await fn(await save()); } catch (e) { toast(errorSentence(e, t("The request could not be saved")), "bad"); } finally { setBusy(false); }
  };

  const left = (
    <>
      <Card title={t("What do you want to do")}>
        <Field label={t("Object")}><Select value={object} onChange={(e) => { setObject(e.target.value as RequestObject); setVals({}); setDraftId(""); setPre(null); }} options={OBJECTS.map((x) => ({ value: x, label: objectText(x) }))} /></Field>
        <Field label={t("Type")}><Select value={kind} onChange={(e) => { setKind(e.target.value as RequestKind); setDraftId(""); setPre(null); }} options={KINDS.map((x) => ({ value: x, label: kindText(x) }))} /></Field>
        {sys.control}
        <Field label={t("Title")}><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        {kind === "change" ? <Field label={t("Record to change")} hint={form.data?.key_field}><Input value={key} onChange={(e) => setKey(e.target.value)} /></Field> : null}
        {kind === "mass_change" ? <Field label={t("Records to change")} hint={t("Separate keys with commas or spaces.")}><Input value={keys} onChange={(e) => setKeys(e.target.value)} /></Field> : null}
      </Card>
      <Card title={t("Values")}>
        {form.data ? <Code code={form.data.key_field} description={t("Key field")} /> : null}
        <Async q={form} lines={5}>{(f) => f.fields.length ? (
          <>{f.fields.map((x) => <FormInput key={x.field} f={x} value={vals[x.field] ?? ""} onChange={(v) => setVals((p) => ({ ...p, [x.field]: v }))} />)}</>
        ) : <Empty heading={t("No fields for this object")} />}</Async>
        <Button variant="secondary" disabled={busy} onClick={() => void act(async (id) => toast(`${t("Draft saved")} ${id}`, "good"))}>{t("Save draft")}</Button>
        <Button variant="secondary" disabled={busy} onClick={() => void act(async (id) => setPre(await validateRequest(id)))}>{t("Validate")}</Button>
        <Button variant="primary" disabled={busy} onClick={() => void act(async (id) => { await submitRequest(id); router.push(withFixture(`/requests/${encodeURIComponent(id)}`, fx)); })}>{t("Submit")}</Button>
      </Card>
      {pre ? <PrecheckView p={pre} /> : null}
    </>
  );
  return (
    <>
      <Head place="requests" stepper={<Flow label={t("Data request")} at={pre ? 1 : 0} steps={REQUEST_STEPS()} />} title={t("New request")} context={t("Change or add master data")} />
      <Split left={left} right={<EntryRules />} leftLabel={t("Request form")} rightLabel={t("Entry rules")} />
    </>
  );
}
