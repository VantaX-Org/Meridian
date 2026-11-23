"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createObjectContract, setEnforcement, type ContractBreachList, type ContractThresholds } from "@/lib/api/v2/step9";
import { updateContract, type Contract } from "@/lib/api/v2/roles";
import { useLandscape } from "@/lib/v2/queries";
import { t } from "@/lib/v2/i18n";
import { Button, Card, Confirm, EmptyState, ErrorState, Field, Input, Select, Skeleton, Stepper, Toggle, useToast } from "@/ui/kit";
import { refreshV2 } from "./common";

const DIMS = ["completeness", "accuracy", "consistency", "timeliness", "uniqueness", "validity"] as const;
type Dim = (typeof DIMS)[number];

/** The limit fields as typed: text, so an empty box means no limit. */
interface Terms { min: string; crit: string; dims: Record<Dim, string> }

const blank = (): Terms => ({ min: "", crit: "", dims: { completeness: "", accuracy: "", consistency: "", timeliness: "", uniqueness: "", validity: "" } });
const fromThresholds = (x: ContractThresholds): Terms => {
  const f = blank();
  f.min = x.min_score === undefined ? "" : String(x.min_score);
  f.crit = x.max_critical_breaches === undefined ? "" : String(x.max_critical_breaches);
  for (const d of DIMS) f.dims[d] = x.dimensions?.[d] === undefined ? "" : String(x.dimensions[d]);
  return f;
};

/** The thresholds the backend accepts (min score 0 to 100, breaches a whole number from 0), or the reason they are not. */
function parse(f: Terms): { value: ContractThresholds } | { error: string } {
  const out: ContractThresholds = {};
  if (f.min.trim()) {
    const n = Number(f.min);
    if (!Number.isFinite(n) || n < 0 || n > 100) return { error: t("Minimum score must be from 0 to 100.") };
    out.min_score = n;
  }
  if (f.crit.trim()) {
    const n = Number(f.crit);
    if (!Number.isInteger(n) || n < 0) return { error: t("Critical breaches must be a whole number from 0.") };
    out.max_critical_breaches = n;
  }
  const dims: Partial<Record<Dim, number>> = {};
  for (const d of DIMS) {
    if (!f.dims[d].trim()) continue;
    const n = Number(f.dims[d]);
    if (!Number.isFinite(n) || n < 0 || n > 100) return { error: t("Each dimension limit must be from 0 to 100.") };
    dims[d] = n;
  }
  if (Object.keys(dims).length) out.dimensions = dims;
  return { value: out };
}

function TermsFields({ value, onChange }: { value: Terms; onChange: (v: Terms) => void }) {
  return (
    <div className="mx-col">
      <Field label={t("Minimum score")} hint={t("0 to 100, blank for no limit")}><Input inputMode="decimal" value={value.min} onChange={(e) => onChange({ ...value, min: e.target.value })} /></Field>
      <Field label={t("Critical breaches allowed")} hint={t("Blank for no limit")}><Input inputMode="numeric" value={value.crit} onChange={(e) => onChange({ ...value, crit: e.target.value })} /></Field>
      {DIMS.map((d) => (
        <Field key={d} label={t("Minimum {dim}", { dim: d })} hint={t("0 to 100, blank for no limit")}>
          <Input inputMode="decimal" value={value.dims[d]} onChange={(e) => onChange({ ...value, dims: { ...value.dims, [d]: e.target.value } })} />
        </Field>
      ))}
    </div>
  );
}

function TermsForm({ id, b }: { id: string; b: ContractBreachList }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [enforce, setEnforce] = useState(b.enforce);
  const [f, setF] = useState(() => fromThresholds(b.thresholds));
  const [ask, setAsk] = useState(false);
  const p = parse(f);
  const save = useMutation({
    mutationFn: () => setEnforcement(id, { enforce, thresholds: "value" in p ? p.value : null }),
    onSuccess: () => { setAsk(false); toast(t("Contract terms saved"), "good"); void refreshV2(qc); },
    onError: () => setAsk(false),
  });
  return (
    <div className="mx-col">
      <Toggle label={t("Enforce on load")} checked={enforce} onChange={setEnforce} />
      <TermsFields value={f} onChange={setF} />
      {"error" in p ? <p role="alert" className="mx-muted">{p.error}</p> : null}
      {save.isError ? <p role="alert" className="mx-muted">{t("The terms could not be saved")}</p> : null}
      <div className="mx-head-actions">
        <Button variant="primary" disabled={"error" in p || save.isPending} onClick={() => (enforce && !b.enforce ? setAsk(true) : save.mutate())}>{t("Save terms")}</Button>
      </div>
      <Confirm
        open={ask}
        title={t("Enforce this contract?")}
        confirmLabel={t("Enforce contract")}
        cancelLabel={t("Cancel")}
        onConfirm={() => save.mutate()}
        onCancel={() => setAsk(false)}
        danger
      >
        <p>{t("While a run breaches these limits, pinning it as a baseline is refused unless someone forces it and gives a reason.")}</p>
      </Confirm>
    </div>
  );
}

/** Edit the limits of one contract and switch enforcement on or off. */
export function TermsEditor({ id, b }: { id: string; b: ContractBreachList }) {
  return <TermsForm key={`${id}:${b.enforce}:${JSON.stringify(b.thresholds)}`} id={id} b={b} />;
}

function EditForm({ c }: { c: Contract }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState(c.name);
  const [desc, setDesc] = useState(c.description ?? "");
  const [producer, setProducer] = useState(c.producer);
  const [consumer, setConsumer] = useState(c.consumer);
  const [submit, setSubmit] = useState(c.status === "pending_approval");
  const save = useMutation({
    mutationFn: () => updateContract(c.id, { name: name.trim(), description: desc.trim(), producer: producer.trim(), consumer: consumer.trim(), status: submit ? "pending_approval" : "draft" }),
    onSuccess: () => { toast(t("Contract saved"), "good"); void refreshV2(qc); },
  });
  const ok = name.trim() && producer.trim() && consumer.trim();
  return (
    <div className="mx-col">
      <Field label={t("Name")}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t("Producer")}><Input value={producer} onChange={(e) => setProducer(e.target.value)} /></Field>
      <Field label={t("Consumer")}><Input value={consumer} onChange={(e) => setConsumer(e.target.value)} /></Field>
      <Field label={t("Description")} hint={t("Optional")}><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
      <Toggle label={t("Send for approval")} checked={submit} onChange={setSubmit} />
      {save.isError ? <p role="alert" className="mx-muted">{t("The contract could not be saved")}</p> : null}
      <div className="mx-head-actions">
        <Button variant="secondary" disabled={!ok || save.isPending} onClick={() => save.mutate()}>{t("Save contract")}</Button>
      </div>
    </div>
  );
}

/** Edit a draft or pending contract. Any other status is read only: the backend refuses the change, so say how to get a draft. */
export function ContractEditor({ c }: { c: Contract }) {
  const open = c.status === "draft" || c.status === "pending_approval";
  return (
    <Card title={t("Edit contract")} sub={open ? undefined : t("Only a draft or a contract waiting for approval can be edited. Create a new version to change this one.")}>
      {open ? <EditForm key={`${c.id}:${c.version}:${c.status}:${c.name}`} c={c} /> : null}
    </Card>
  );
}

/** A new contract for one object, in three steps: pick the object, set the limits, review. */
export function ObjectContractFlow({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const land = useLandscape(null);
  const [step, setStep] = useState(0);
  const [module, setModule] = useState("");
  const [name, setName] = useState("");
  const [consumer, setConsumer] = useState("");
  const [enforce, setEnforce] = useState(false);
  const [f, setF] = useState(blank);
  const p = parse(f);
  const objects = land.data?.objects ?? [];
  const label = objects.find((o) => o.module === module)?.label ?? module;
  const make = useMutation({
    mutationFn: () => createObjectContract({ name: name.trim(), module, consumer: consumer.trim(), enforce, thresholds: "value" in p ? p.value : {} }),
    onSuccess: () => { toast(t("Contract created"), "good"); void refreshV2(qc); onDone(); },
  });
  const steps = [{ id: "object", label: t("Object") }, { id: "limits", label: t("Limits") }, { id: "review", label: t("Review") }];
  const ready = [Boolean(module), Boolean(name.trim() && consumer.trim()) && "value" in p, true][step];
  return (
    <Card title={t("New contract for an object")}>
      <div className="mx-col">
        <Stepper steps={steps} current={step} label={t("Contract steps")} />
        {land.isPending ? <Skeleton lines={4} label={t("Loading objects")} /> : land.isError ? <ErrorState heading={t("This could not be loaded")} retryLabel={t("Try again")} onRetry={() => void land.refetch()} /> : objects.length === 0 ? <EmptyState heading={t("No objects")} body={t("Connect a system to list its objects.")} /> : step === 0 ? (
          <Field label={t("Object")} hint={t("The data the contract covers")}>
            <Select value={module} onChange={(e) => { setModule(e.target.value); if (!name.trim()) setName(t("{object} quality", { object: objects.find((o) => o.module === e.target.value)?.label ?? "" })); }} options={[{ value: "", label: t("Choose an object") }, ...objects.map((o) => ({ value: o.module, label: o.label }))]} />
          </Field>
        ) : step === 1 ? (
          <>
            <Field label={t("Contract name")}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label={t("Consumer")} hint={t("The team that relies on it")}><Input value={consumer} onChange={(e) => setConsumer(e.target.value)} /></Field>
            <Toggle label={t("Enforce on load")} checked={enforce} onChange={setEnforce} />
            <TermsFields value={f} onChange={setF} />
            {"error" in p ? <p role="alert" className="mx-muted">{p.error}</p> : null}
          </>
        ) : (
          <dl className="mx-col">
            <p>{t("Object")}: {label}</p>
            <p>{t("Contract name")}: {name.trim()}</p>
            <p>{t("Consumer")}: {consumer.trim()}</p>
            <p>{enforce ? t("Enforced on load") : t("Not enforced")}</p>
            {"value" in p && Object.keys(p.value).length === 0 ? <p>{t("No limits set")}</p> : null}
            {"value" in p && p.value.min_score !== undefined ? <p>{t("Minimum score")}: {p.value.min_score}</p> : null}
            {"value" in p && p.value.max_critical_breaches !== undefined ? <p>{t("Critical breaches allowed")}: {p.value.max_critical_breaches}</p> : null}
            {"value" in p ? Object.entries(p.value.dimensions ?? {}).map(([k, v]) => <p key={k}>{k}: {v}</p>) : null}
          </dl>
        )}
        {make.isError ? <p role="alert" className="mx-muted">{t("The contract could not be created")}</p> : null}
        <div className="mx-head-actions">
          {step < 2 ? <Button variant="primary" disabled={!ready} onClick={() => setStep(step + 1)}>{t("Next")}</Button> : <Button variant="primary" disabled={make.isPending} onClick={() => make.mutate()}>{t("Create object contract")}</Button>}
          {step > 0 ? <Button variant="ghost" onClick={() => setStep(step - 1)}>{t("Back")}</Button> : null}
          <Button variant="ghost" onClick={onDone}>{t("Cancel")}</Button>
        </div>
      </div>
    </Card>
  );
}
