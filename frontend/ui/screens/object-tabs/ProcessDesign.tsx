"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createModel, deleteModel, saveModel, type ModelWithDocument } from "@/lib/api/v2/designer";
import { errorSentence } from "@/lib/api/v2/client";
import { saveFailure } from "@/lib/api/process-designer";
import { deleteActivity, sameDoc } from "@/lib/v2/designer-doc";
import { useModel, useModels, useReferenceModel } from "@/lib/v2/sys-queries";
import { t } from "@/lib/v2/i18n";
import type { L5, ModelSummary, ProcessModelDocument } from "@/types/process-model";
import { Button, Card, Confirm, DataTable, EmptyState, ErrorState, Field, FieldChip, Input, Select, Skeleton, StatTile, type Column } from "@/ui/kit";
import type { ObjectRun } from "@/ui/screens/object/useObjectRun";
import { useTabChat } from "./TabFrame";

interface ActRow { act: L5; l4: string; l4name: string }

/** Every activity under the processes that list this module; every activity when none lists it. Pure, so it has a test. */
export function moduleActivities(doc: ProcessModelDocument, module: string): ActRow[] {
  const l1 = doc.l1.some((x) => x.modules.includes(module)) ? doc.l1.filter((x) => x.modules.includes(module)) : doc.l1;
  return l1.flatMap((a) => a.l2.flatMap((b) => b.l3.flatMap((c) => c.l4.flatMap((d) => d.activities.map((act) => ({ act, l4: d.id, l4name: d.name }))))));
}

/** One model open for editing: remove activities, then save as a new version against the version it was opened at. */
function Editor({ data, module, onChanged }: { data: ModelWithDocument; module: string; onChanged: () => void }) {
  const [doc, setDoc] = useState<ProcessModelDocument>(data.document);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const dirty = !sameDoc(doc, data.document);
  const rows = moduleActivities(doc, module);
  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await saveModel(data.model.id, { document: doc, note: note.trim() || t("Edited in the designer"), base_version: data.version_no });
      setProblems([]);
      setNote("");
      setMsg(t("Saved as version {version_no}", { version_no: r.version_no }) + (r.warnings.length ? ` ${r.warnings.join(" ")}` : ""));
      onChanged();
    } catch (e) {
      const f = saveFailure(e);
      if (f.kind === "invalid") {
        setProblems(f.errors.map((x) => `${x.path ? `${x.path}: ` : ""}${x.message}`));
        setMsg(t("The model was not saved. Fix the problems listed below."));
      } else if (f.kind === "stale") setMsg(t("The model changed since you opened it. Reload it to see the newer version, then make your change again."));
      else setMsg(errorSentence(e, t("The model could not be saved.")));
    } finally {
      setBusy(false);
    }
  };
  const cols: Column<ActRow>[] = [
    { key: "p", label: t("Process"), render: (r) => <FieldChip code={r.l4} description={r.l4name} /> },
    { key: "a", label: t("Activity"), render: (r) => <FieldChip code={r.act.id} description={r.act.name} /> },
    { key: "t", label: t("Transaction"), render: (r) => r.act.tcode ? <code className="mx-code">{r.act.tcode}</code> : null },
    { key: "f", label: t("Fields"), align: "end", render: (r) => <span className="mx-num">{r.act.fields.length}</span> },
    { key: "x", label: "", render: (r) => <Button variant="ghost" onClick={() => setDoc(deleteActivity(doc, r.act.id))} aria-label={t("Delete activity {name}", { name: r.act.name })}>{t("Delete")}</Button> },
  ];
  return (
    <Card title={data.model.name} sub={t("Version {version_no}", { version_no: data.version_no }) + (dirty ? t(", unsaved changes") : "")}>
      {rows.length ? <DataTable label={t("Activities in {name}", { name: data.model.name })} rows={rows} rowKey={(r) => r.act.id} columns={cols} height={Math.min(420, 60 + 40 * rows.length)} /> : <EmptyState heading={t("This model has no activity for this object.")} />}
      <Field label={t("Change note")}><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Edited in the designer")} /></Field>
      <div className="mx-head-actions">
        <Button variant="primary" disabled={!dirty || busy} onClick={() => void save()}>{t("Save new version")}</Button>
        <Button disabled={!dirty || busy} onClick={() => { setDoc(data.document); setProblems([]); }}>{t("Discard changes")}</Button>
      </div>
      {msg ? <p role="status">{msg}</p> : null}
      {problems.length ? <ul aria-label={t("Problems")}>{problems.map((p) => <li key={p}>{p}</li>)}</ul> : null}
    </Card>
  );
}

/** Process models and the SAP reference model that cover this object, with create, edit, save and delete. */
export function ProcessDesign({ o, system, module }: { o: ObjectRun; system: string; module: string }) {
  const qc = useQueryClient();
  const models = useModels();
  const ref = useReferenceModel(true);
  const [open, setOpen] = useState<string | null>(null);
  const model = useModel(open);
  const [name, setName] = useState("");
  const [from, setFrom] = useState("reference");
  const [msg, setMsg] = useState<string | null>(null);
  const [removing, setRemoving] = useState<ModelSummary | null>(null);
  const l1 = (ref.data?.l1 ?? []).filter((x) => x.modules.includes(module));
  useTabChat(system, module, "design", o.label, [t("Which reference processes cover this object?")], () => ({
    text: t("{n} reference processes cover this object.", { n: l1.length }),
    evidence: l1.slice(0, 3).map((x) => `${x.id}: ${x.name}`),
  }));
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["v2", "process-models"] });
    void qc.invalidateQueries({ queryKey: ["v2", "process-model"] });
  };
  const create = async () => {
    if (!name.trim()) return setMsg(t("Give the model a name."));
    try {
      const r = await createModel(name.trim(), from);
      setName("");
      setOpen(r.model.id);
      setMsg(t("{name} created", { name: r.model.name }));
      refresh();
    } catch (e) {
      setMsg(errorSentence(e, t("The model could not be created.")));
    }
  };
  const remove = async (m: ModelSummary) => {
    setRemoving(null);
    try {
      await deleteModel(m.id);
      if (open === m.id) setOpen(null);
      setMsg(t("{name} deleted. Runs and readiness already computed stay.", { name: m.name }));
      refresh();
    } catch (e) {
      setMsg(errorSentence(e, t("The model could not be deleted.")));
    }
  };

  if (models.isLoading || ref.isLoading) return <Skeleton lines={5} label={t("Loading process models")} />;
  if (models.isError && ref.isError) return <ErrorState heading={t("Process models could not be loaded.")} retryLabel={t("Try again")} onRetry={() => { void models.refetch(); void ref.refetch(); }} />;
  const cols: Column<ModelSummary>[] = [
    { key: "n", label: t("Model"), render: (m) => <FieldChip code={m.id} description={m.name} /> },
    { key: "s", label: t("Status"), render: (m) => m.status === "published" ? t("Published") : t("Draft") },
    { key: "v", label: t("Version"), align: "end", render: (m) => <span className="mx-num">{m.current_version}</span> },
    { key: "u", label: t("Updated"), render: (m) => (m.updated_at ?? "").slice(0, 10) },
    { key: "a", label: "", render: (m) => (
      <span className="mx-head-actions">
        <Button onClick={() => setOpen(m.id)} aria-label={t("Open {name}", { name: m.name })}>{t("Open")}</Button>
        <Button variant="ghost" onClick={() => setRemoving(m)} aria-label={t("Delete {name}", { name: m.name })}>{t("Delete")}</Button>
      </span>
    ) },
  ];
  return (
    <div className="mx-col">
      <dl className="mx-tiles">
        <StatTile label={t("Models")} value={String(models.data?.length ?? 0)} />
        <StatTile label={t("Reference processes for this object")} value={String(l1.length)} />
      </dl>
      <Card title={t("Reference processes")}>
        {l1.length ? <ul className="mx-col">{l1.map((x) => <li key={x.id}><FieldChip code={x.id} description={x.name} />{" "}<span className="mx-muted">{x.description}</span></li>)}</ul> : <EmptyState heading={t("No reference process lists this object.")} />}
      </Card>
      <Card title={t("Your process models")}>
        {models.data?.length ? <DataTable columns={cols} rows={models.data} rowKey={(m) => m.id} label={t("Your process models")} /> : <EmptyState heading={t("No process model exists yet.")} />}
        <div className="mx-head-actions">
          <Field label={t("New model name")}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t("Copy from")}><Select value={from} onChange={(e) => setFrom(e.target.value)} options={[{ value: "reference", label: t("Reference model") }, ...(models.data ?? []).map((m) => ({ value: m.id, label: m.name }))]} /></Field>
          <Button variant="primary" onClick={() => void create()}>{t("Create model")}</Button>
        </div>
        {msg ? <p role="status">{msg}</p> : null}
      </Card>
      {open ? (model.isLoading ? <Skeleton lines={4} label={t("Loading the model")} /> : model.data ? <Editor key={`${model.data.model.id}:${model.data.version_no}`} data={model.data} module={module} onChanged={refresh} /> : <ErrorState heading={t("The model could not be loaded.")} />) : null}
      <Confirm open={removing !== null} danger title={t("Delete {name}?", { name: removing?.name ?? "" })} confirmLabel={t("Delete model")} cancelLabel={t("Cancel")} onConfirm={() => removing && void remove(removing)} onCancel={() => setRemoving(null)}>
        {t("Every version of this model is removed. Runs and readiness already computed stay.")}
      </Confirm>
    </div>
  );
}
