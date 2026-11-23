"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createDefinition, dryRun, getDefinition, getFacts, newVersion, type Facts, type WorkflowDefinition } from "@/lib/api/v2/requests";
import { t } from "@/lib/v2/i18n";
import { Button, Confirm, Field, Input, Select, Stepper, Textarea, Toggle, useToast } from "@/ui/kit";
import { Async, useRead } from "../mdm/catalogue/shared";
import { objectText } from "./RequestsScreen";

type Raw = Record<string, unknown>;
/** One step as typed. `raw` keeps every part of the stored step this form does not show (conditions, fallback, named users). */
interface Row { raw: Raw; name: string; rule: string; action: string; quorum: string; sla: string }

const asRaw = (v: unknown): Raw => (v && typeof v === "object" ? (v as Raw) : {});
const toRow = (s: Raw): Row => {
  const a = asRaw(s.assignee);
  return { raw: s, name: String(s.name ?? ""), rule: String(a.rule ?? "role"), action: typeof a.action === "string" ? a.action : "", quorum: String(s.quorum ?? "any"), sla: s.sla_hours == null ? "" : String(s.sla_hours) };
};
const blankRow = (): Row => ({ raw: {}, name: "", rule: "role", action: "approve", quorum: "any", sla: "" });

/** The step as the backend reads it: stored parts kept, the shown ones replaced. A blank SLA drops the limit. */
function toStep(r: Row): Raw {
  const { sla_hours: _drop, ...rest } = r.raw;
  void _drop;
  const a: Raw = { ...asRaw(r.raw.assignee), rule: r.rule };
  if (r.rule === "role") { if (r.action.trim()) a.action = r.action.trim(); } else delete a.action;
  return { ...rest, name: r.name.trim(), assignee: a, quorum: r.quorum, ...(r.sla.trim() ? { sla_hours: Number(r.sla) } : {}) };
}
const slaOk = (r: Row) => !r.sla.trim() || (Number.isFinite(Number(r.sla)) && Number(r.sla) > 0 && Number(r.sla) <= 8760);

function Form({ facts, base, mode, onDone }: { facts: Facts; base?: WorkflowDefinition; mode: "create" | "version"; onDone: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const create = mode === "create";
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [kind, setKind] = useState(base?.object_kind ?? facts.object_kinds[0] ?? "");
  const [rows, setRows] = useState<Row[]>(() => (base ? (Array.isArray(base.definition.steps) ? (base.definition.steps as unknown[]).map((s) => toRow(asRaw(s))) : []) : [blankRow()]));
  const [on, setOn] = useState(false);
  const [ask, setAsk] = useState(false);
  const rules = facts.assignee_rules.filter((r) => r !== "users");
  const doc: Raw = { ...(base?.definition ?? { notify_requester: true, distinct_approvers: true }), steps: rows.map(toStep) };
  const last = create ? 2 : 1;
  const check = useRead(["wf", "edit-dry", kind, JSON.stringify(doc)], () => dryRun(doc, kind, {}), step === last);
  const save = useMutation({
    mutationFn: () => (create ? createDefinition({ name: name.trim(), description: desc.trim() || null, object_kind: kind, definition: doc, activate: on }) : newVersion((base as WorkflowDefinition).id, doc, on)),
    onSuccess: (d) => { setAsk(false); toast(create ? t("Workflow created") : t("Version {n} created", { n: d.version }), "good"); void qc.invalidateQueries({ queryKey: ["b7b"] }); onDone(); },
    onError: () => setAsk(false),
  });
  const set = (i: number, p: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const steps = [...(create ? [{ id: "details", label: t("Details") }] : []), { id: "steps", label: t("Steps") }, { id: "review", label: t("Review") }];
  const stepsOk = rows.length > 0 && rows.every((r) => r.name.trim() && slaOk(r));
  const ready = step === last ? check.data?.valid === true : create && step === 0 ? Boolean(name.trim() && kind) : stepsOk;
  const onSteps = step === last - 1;
  return (
    <div className="mx-col">
      <Stepper steps={steps} current={step} label={t("Workflow steps")} />
      {create && step === 0 ? (
        <>
          <Field label={t("Workflow name")}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t("Description")} hint={t("Optional")}><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
          <Field label={t("Approves")} hint={t("The kind of request this workflow handles")}><Select value={kind} onChange={(e) => setKind(e.target.value)} options={facts.object_kinds.map((k) => ({ value: k, label: objectText(k) }))} /></Field>
        </>
      ) : null}
      {onSteps ? (
        <>
          {rows.map((r, i) => (
            <fieldset key={i} className="mx-col">
              <legend>{t("Step {n}", { n: i + 1 })}</legend>
              <Field label={t("Step name {n}", { n: i + 1 })}><Input value={r.name} onChange={(e) => set(i, { name: e.target.value })} /></Field>
              {r.rule === "users" ? <p>{t("Approvers: named people, kept as stored.")}</p> : (
                <Field label={t("Approver rule {n}", { n: i + 1 })}><Select value={r.rule} onChange={(e) => set(i, { rule: e.target.value })} options={rules.map((x) => ({ value: x, label: x }))} /></Field>
              )}
              {r.rule === "role" ? <Field label={t("Permission {n}", { n: i + 1 })} hint={t("Anyone holding it may decide")}><Input value={r.action} onChange={(e) => set(i, { action: e.target.value })} /></Field> : null}
              <Field label={t("Approvals needed {n}", { n: i + 1 })}><Select value={r.quorum} onChange={(e) => set(i, { quorum: e.target.value })} options={[{ value: "any", label: t("Any one approver") }, { value: "all", label: t("Every approver") }]} /></Field>
              <Field label={t("SLA hours {n}", { n: i + 1 })} hint={t("Blank for no limit")} error={slaOk(r) ? undefined : t("From above 0 to 8760.")}><Input inputMode="decimal" value={r.sla} onChange={(e) => set(i, { sla: e.target.value })} /></Field>
              <Button variant="ghost" disabled={rows.length < 2} onClick={() => setRows(rows.filter((_, j) => j !== i))}>{t("Remove step {n}", { n: i + 1 })}</Button>
            </fieldset>
          ))}
          <Button variant="secondary" onClick={() => setRows([...rows, blankRow()])}>{t("Add step")}</Button>
        </>
      ) : null}
      {step === last ? (
        <Async q={check} lines={4}>
          {(d) => (
            <div className="mx-col">
              {create ? <p>{name.trim()}</p> : <p>{base?.name} v{(base?.version ?? 0) + 1}</p>}
              {d.problems.map((p) => <p key={p} role="alert" className="mx-muted">{p}</p>)}
              {d.steps.map((s) => <p key={s.index}>{s.index + 1}. {s.name}, {s.quorum}{s.sla_hours ? `, ${s.sla_hours} h` : ""}</p>)}
              <Toggle label={t("Make this the active version")} checked={on} onChange={setOn} />
            </div>
          )}
        </Async>
      ) : null}
      {save.isError ? <p role="alert" className="mx-muted">{t("The workflow could not be saved")}</p> : null}
      <div className="mx-head-actions">
        {step < last ? <Button variant="primary" disabled={!ready} onClick={() => setStep(step + 1)}>{t("Next")}</Button>
          : <Button variant="primary" disabled={!ready || save.isPending} onClick={() => (on ? setAsk(true) : save.mutate())}>{create ? t("Create workflow") : t("Save new version")}</Button>}
        {step > 0 ? <Button variant="ghost" onClick={() => setStep(step - 1)}>{t("Back")}</Button> : null}
        <Button variant="ghost" onClick={onDone}>{t("Cancel")}</Button>
      </div>
      <Confirm open={ask} title={t("Activate this version?")} confirmLabel={t("Activate version")} cancelLabel={t("Cancel")} onConfirm={() => save.mutate()} onCancel={() => setAsk(false)} danger>
        <p>{t("New {object} approvals start on this version. Approvals already in progress keep the version they started on.", { object: objectText(kind) })}</p>
      </Confirm>
    </div>
  );
}

function Loaded({ id, onDone }: { id?: string; onDone: () => void }) {
  const facts = useRead(["wf", "facts"], getFacts);
  const base = useRead(["wf", "def", id ?? ""], () => getDefinition(id as string), Boolean(id));
  return (
    <Async q={facts}>
      {(f) => id ? <Async q={base}>{(b) => <Form key={b.id} facts={f} base={b} mode="version" onDone={onDone} />}</Async> : <Form facts={f} mode="create" onDone={onDone} />}
    </Async>
  );
}

/** Create a workflow (three steps) or add a version to one: a fresh read of the stored version, edit the steps, review the dry run. */
export function WorkflowEditor({ id, onDone }: { id?: string; onDone: () => void }) {
  return <Loaded id={id} onDone={onDone} />;
}
