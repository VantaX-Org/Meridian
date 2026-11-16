"use client";

/**
 * `/next/o/{system}/{module}/processes/design`: the L1 to L5 process model as a tree you edit. Add, rename, reorder and
 * delete processes, areas, sub-processes, steps and activities; map TABLE.FIELD to an activity; save a new version;
 * publish, rename, delete or export the model. Models are tenant-wide, so the process that reads this object is one
 * among them. Needs analyse or run process discovery to change anything; without it the tree is read-only.
 */
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { createModel, deleteModel, patchModel, saveModel, type ModelWithDocument } from "@/lib/api/v2/designer";
import { saveFailure } from "@/lib/api/process-designer";
import { v2Download } from "@/lib/api/v2/download";
import { errorSentence } from "@/lib/api/v2/client";
import { addChild, addNode, childrenOf, locate, moveItem, patchItem, removeItem, renameItem, patchActivity, type Level, type TreeItem } from "@/lib/v2/process-doc";
import type { L4, L5, ProcessModelDocument } from "@/types/process-model";
import { formatDate } from "@/lib/format";
import { addField, deleteActivity, fieldError, LEVEL_WORD, moveActivity, removeField, sameDoc, toggleMandatory } from "@/lib/v2/designer-doc";
import { useV2Session } from "@/lib/v2/hooks";
import { useModel, useModels, useModelVersions, useRefreshV2 } from "@/lib/v2/sys-queries";
import { describeField } from "@/lib/v2/sap-fields";
import { t, lc } from "@/lib/v2/i18n";
import { Button, Code, Confirm, EmptyState, ErrorState, Skeleton, useToast } from "../../kit";
import type { ObjectRun } from "../useObjectRun";
import "./designer.css";

/** What the shared confirm dialog is asking. */
interface Ask {
  title: string;
  consequence: string;
  confirmLabel: string;
  onConfirm: () => void;
}

type Apply = (d: ProcessModelDocument, select?: string) => void;

/** A labelled input: the label, the control, then the hint or the error under it. */
function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (p: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode }) {
  const id = useId();
  const note = error ? `${id}-e` : hint ? `${id}-h` : undefined;
  return (
    <div className="nx-field">
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": note })}
      {error ? <p id={`${id}-e`} className="nx-error-line" role="alert">{error}</p> : hint ? <p id={`${id}-h`} className="nx-sub">{hint}</p> : null}
    </div>
  );
}

/* ---- the detail of one selected item ---- */

function ActivityEditor({ act, index, count, doc, apply, canDesign, ask }: { act: L5; index: number; count: number; doc: ProcessModelDocument; apply: Apply; canDesign: boolean; ask: (a: Ask) => void }) {
  const [field, setField] = useState("");
  const [shown, setShown] = useState(false);
  const err = shown ? fieldError(field, act.fields.map((f) => f.field)) : undefined;
  return (
    <li className="nx-pd-act" aria-label={act.name}>
      <div className="nx-pd-row">
        <Field label={t("Activity")}>{(p) => <input {...p} className="nx-input" disabled={!canDesign} value={act.name} onChange={(e) => apply(patchActivity(doc, act.id, { name: e.target.value }))} />}</Field>
        {canDesign ? (
          <span className="nx-pd-acts">
            <Button size={32} aria-label={t("Move {name} up", { name: act.name })} disabled={index === 0} onClick={() => apply(moveActivity(doc, act.id, -1))}>{t("Up")}</Button>
            <Button size={32} aria-label={t("Move {name} down", { name: act.name })} disabled={index === count - 1} onClick={() => apply(moveActivity(doc, act.id, 1))}>{t("Down")}</Button>
            <Button
              size={32}
              variant="danger"
              aria-label={t("Delete {name}", { name: act.name })}
              onClick={() => ask({ title: t("Delete activity"), consequence: t("{name} and its field mapping are removed when you save.", { name: act.name }), confirmLabel: t("Delete activity"), onConfirm: () => apply(deleteActivity(doc, act.id)) })}
            >
              {t("Delete")}
            </Button>
          </span>
        ) : null}
      </div>
      {act.fields.length === 0 ? (
        <p className="nx-sub">{t("No field is mapped to this activity.")}</p>
      ) : (
        <ul className="nx-pd-fields" aria-label={t("Fields of {name}", { name: act.name })}>
          {act.fields.map((f) => (
            <li key={f.field} className="nx-pd-row">
              <Code code={f.field} text={describeField(f.field)} />
              <span className="nx-pd-acts">
                <label className="nx-check">
                  <input type="checkbox" disabled={!canDesign} checked={f.mandatory} onChange={() => apply(toggleMandatory(doc, act.id, f.field))} />
                  {t("Mandatory")}
                </label>
                {canDesign ? <Button size={32} variant="quiet" aria-label={t("Unmap {field}", { field: f.field })} onClick={() => apply(removeField(doc, act.id, f.field))}>{t("Unmap")}</Button> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canDesign ? (
        <form
          className="nx-pd-form"
          aria-label={t("Map a field to {name}", { name: act.name })}
          onSubmit={(e) => {
            e.preventDefault();
            setShown(true);
            if (fieldError(field, act.fields.map((x) => x.field))) return;
            apply(addField(doc, act.id, field));
            setField("");
            setShown(false);
          }}
        >
          <Field label={t("Map a field")} error={err} hint={t("The table and field, such as MARA.MATNR")}>{(p) => <input {...p} className="nx-input nx-mono" value={field} onChange={(e) => setField(e.target.value)} placeholder="MARA.MATNR" />}</Field>
          <Button type="submit">{t("Map field")}</Button>
        </form>
      ) : null}
    </li>
  );
}

function Detail({ doc, id, apply, canDesign, select, ask }: { doc: ProcessModelDocument; id: string | null; apply: Apply; canDesign: boolean; select: (id: string | null) => void; ask: (a: Ask) => void }) {
  const [child, setChild] = useState("");
  const [shown, setShown] = useState(false);
  const hit = locate(doc, id);
  const level = (hit?.level ?? 0) as 0 | Level;
  const add = () => {
    setShown(true);
    if (!child.trim()) return;
    if (level === 4) {
      apply(addNode(doc, hit!.item.id, "task", child.trim()).doc);
    } else {
      const r = addChild(doc, hit?.item.id ?? null, child.trim());
      apply(r.doc, r.id);
    }
    setChild("");
    setShown(false);
  };
  const label = level === 4 ? t("Activity") : LEVEL_WORD[(level + 1) as 1 | 2 | 3 | 4];
  const activities = level === 4 ? (hit!.item as L4).activities : [];
  return (
    <section className="nx-pd-detail" aria-label={t("Selected level")} data-testid="designer-detail">
      {hit ? (
        <>
          <h2 className="nx-pd-h">{`${LEVEL_WORD[level as 1]}: ${hit.item.name || "unnamed"}`}</h2>
          <p className="nx-sub"><code className="nx-mono">{hit.item.id}</code></p>
          <div className="nx-pd-form">
            <Field label={t("Name")} error={!hit.item.name.trim() ? t("A name is required") : undefined}>
              {(p) => <input {...p} className="nx-input" disabled={!canDesign} value={hit.item.name} onChange={(e) => apply(renameItem(doc, hit.item.id, e.target.value))} />}
            </Field>
            <Field label={t("Description")}>{(p) => <input {...p} className="nx-input" disabled={!canDesign} value={hit.item.description} onChange={(e) => apply(patchItem(doc, hit.item.id, { description: e.target.value }))} />}</Field>
            {level === 4 ? (
              <Field label={t("Transaction code")}>{(p) => <input {...p} className="nx-input nx-mono" disabled={!canDesign} value={(hit.item as L4).tcode ?? ""} onChange={(e) => apply(patchItem<L4>(doc, hit.item.id, { tcode: e.target.value.toUpperCase() || null }))} />}</Field>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <h2 className="nx-pd-h">{t("The model")}</h2>
          <p className="nx-sub">{t("Choose a level in the tree to rename it, reorder it, add what sits under it, or map fields to its activities.")}</p>
        </>
      )}
      {canDesign && level < 5 ? (
        <form
          className="nx-pd-form"
          aria-label={t("Add {label}", { label: lc(label) })}
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Field label={t("New {label}", { label: lc(label) })} error={shown && !child.trim() ? t("Enter a name") : undefined}>{(p) => <input {...p} className="nx-input" value={child} onChange={(e) => setChild(e.target.value)} />}</Field>
          <Button type="submit">{t("Add {label}", { label: lc(label) })}</Button>
        </form>
      ) : null}
      {level === 4 ? (
        <>
          <h3 className="nx-pd-h3">{t("Activities and the fields they read")}</h3>
          {activities.length === 0 ? (
            <p className="nx-sub">{t("This step has no activity yet. Add one above, then map the fields it reads or writes.")}</p>
          ) : (
            <ul className="nx-pd-list" aria-label={t("Activities")}>
              {activities.map((a, i, all) => (
                <ActivityEditor key={a.id} act={a} index={i} count={all.length} doc={doc} apply={(d) => apply(d)} canDesign={canDesign} ask={ask} />
              ))}
            </ul>
          )}
        </>
      ) : null}
      {hit ? <p><Button variant="quiet" size={32} onClick={() => select(null)}>{t("Back to the model")}</Button></p> : null}
    </section>
  );
}

/* ---- the tree ---- */

function Tree({ doc, items, depth: level, selected, select, apply, canDesign, ask }: { doc: ProcessModelDocument; items: TreeItem[]; depth: Level; selected: string | null; select: (id: string) => void; apply: Apply; canDesign: boolean; ask: (a: Ask) => void }) {
  return (
    <ul className="nx-pd-tree">
      {items.map((it, i) => {
        const kids = level < 4 ? childrenOf(it, level) : [];
        return (
          <li key={it.id}>
            <div className="nx-pd-node" data-current={selected === it.id ? "true" : undefined}>
              <span className="nx-pd-lvl">{`L${level}`}</span>
              <button type="button" className="nx-pd-pick" aria-current={selected === it.id ? "true" : undefined} onClick={() => select(it.id)}>
                {it.name || t("Unnamed")}
                {level === 4 ? <span className="nx-sub">{" "}{t("{activitiesCount, plural, one {# activity} other {# activities}}", { activitiesCount: (it as L4).activities.length })}</span> : null}
              </button>
              {canDesign ? (
                <span className="nx-pd-acts">
                  <Button size={32} aria-label={t("Move {name} up", { name: it.name })} disabled={i === 0} onClick={() => apply(moveItem(doc, it.id, -1))}>{t("Up")}</Button>
                  <Button size={32} aria-label={t("Move {name} down", { name: it.name })} disabled={i === items.length - 1} onClick={() => apply(moveItem(doc, it.id, 1))}>{t("Down")}</Button>
                  <Button
                    size={32}
                    variant="danger"
                    aria-label={t("Delete {name}", { name: it.name })}
                    onClick={() =>
                      ask({
                        title: t("Delete {LEVEL_WORD}", { LEVEL_WORD: lc(LEVEL_WORD[level as 1]) }),
                        consequence: t("{name} and everything under it are removed when you save.", { name: it.name || t("This level") }),
                        confirmLabel: t("Delete {LEVEL_WORD}", { LEVEL_WORD: lc(LEVEL_WORD[level as 1]) }),
                        onConfirm: () => apply(removeItem(doc, it.id)),
                      })
                    }
                  >
                    {t("Delete")}
                  </Button>
                </span>
              ) : null}
            </div>
            {kids.length ? <Tree doc={doc} items={kids} depth={(level + 1) as Level} selected={selected} select={select} apply={apply} canDesign={canDesign} ask={ask} /> : null}
          </li>
        );
      })}
    </ul>
  );
}

/* ---- the editor of one model version ---- */

function Editor({ data, canDesign, onChanged }: { data: ModelWithDocument; canDesign: boolean; onChanged: () => void }) {
  const toast = useToast();
  const [doc, setDoc] = useState<ProcessModelDocument>(data.document);
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const [stale, setStale] = useState(false);
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState<Ask | null>(null);
  const dirty = !sameDoc(doc, data.document);
  const apply: Apply = (d, select) => {
    setDoc(d);
    setProblems([]);
    if (select) setSelected(select);
  };
  const save = async () => {
    setSaving(true);
    try {
      const r = await saveModel(data.model.id, { document: doc, note: note.trim() || t("Edited in the designer"), base_version: data.version_no });
      setProblems([]);
      setStale(false);
      toast({ tone: "good", text: `${t("Saved as version {version_no}", { version_no: r.version_no })}. ${r.warnings.length ? r.warnings.join(" ") : t("Changes show in process readiness on the next run.")}` });
      onChanged();
    } catch (e) {
      const f = saveFailure(e);
      if (f.kind === "invalid") {
        setProblems(f.errors.map((x) => `${x.path ? `${x.path}: ` : ""}${x.message}`));
        toast({ tone: "bad", text: `${t("The model was not saved")}. ${t("Fix the problems listed below.")}` });
      } else if (f.kind === "stale") {
        setStale(true);
        toast({ tone: "bad", text: `${t("The model changed since you opened it")}. ${t("Reload it to see the newer version, then make your change again.")}` });
      } else {
        toast({ tone: "bad", text: errorSentence(e, t("It did not go through")) });
      }
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <div className="nx-pd-grid">
        <section aria-label={t("Process tree")}>
          <div className="nx-pd-head"><h2 className="nx-pd-h">{t("Model")}</h2><span className="nx-sub">{t("Version {version_no}", { version_no: data.version_no })}{dirty ? t(", unsaved changes") : ""}</span></div>
          {doc.l1.length === 0 ? (
            <EmptyState heading={t("The model has no process yet. Add the first one on the right.")} />
          ) : (
            <Tree doc={doc} items={doc.l1} depth={1} selected={selected} select={setSelected} apply={apply} canDesign={canDesign} ask={setAsking} />
          )}
          {canDesign ? <p><Button variant="quiet" size={32} onClick={() => setSelected(null)}>{t("Add a process at the top level")}</Button></p> : null}
        </section>
        <Detail doc={doc} id={selected} apply={apply} canDesign={canDesign} select={setSelected} ask={setAsking} />
      </div>
      {canDesign ? (
        <form
          className="nx-pd-form nx-pd-save"
          aria-label={t("Save the model")}
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty && !saving) void save();
          }}
        >
          <Field label={t("What changed")} hint={t("Kept with the version.")}>{(p) => <input {...p} className="nx-input" value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <div className="nx-actions">
            <Button type="submit" variant="primary" disabled={!dirty} reason={t("Change the model first.")} loading={saving} loadingLabel={t("Saving…")}>{t("Save as a new version")}</Button>
            <Button disabled={!dirty} onClick={() => apply(data.document)}>{t("Discard changes")}</Button>
          </div>
        </form>
      ) : null}
      {stale ? <p className="nx-error-line" role="alert">{t("The model changed since you opened it")}. {t("Reload it to see the newer version, then make your change again.")}</p> : null}
      {problems.length ? (
        <ul className="nx-pd-problems" role="alert" aria-label={t("Problems in the model")}>
          {problems.map((p) => <li key={p} className="nx-error-line">{p}</li>)}
        </ul>
      ) : null}
      <Confirm
        open={asking !== null}
        title={asking?.title ?? ""}
        consequence={asking?.consequence ?? ""}
        confirmLabel={asking?.confirmLabel ?? ""}
        danger
        onConfirm={() => {
          asking?.onConfirm();
          setAsking(null);
        }}
        onCancel={() => setAsking(null)}
      />
    </>
  );
}

/** Saves the current version of the model as a PowerPoint deck (GET /process-designer/models/{id}/export/pptx). */
function PptxExport({ modelId }: { modelId: string }) {
  const session = useV2Session();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const allowed = session.can("export") || session.can("export_process");
  return (
    <Button
      loading={busy}
      disabled={!allowed}
      reason={t("Exporting needs the export permission.")}
      onClick={async () => {
        if (session.fixture) return toast({ text: t("Fixture mode: no file is produced"), tone: "neutral" });
        setBusy(true);
        try {
          await v2Download(`/process-designer/models/${encodeURIComponent(modelId)}/export/pptx`, {}, "process-model.pptx");
          toast({ text: t("Deck downloading"), tone: "good" });
        } catch (err) {
          toast({ text: errorSentence(err, t("The export failed.")), tone: "bad" });
        } finally {
          setBusy(false);
        }
      }}
    >
      {t("Export to PowerPoint")}
    </Button>
  );
}

export function ProcessDesigner({ o }: { o: ObjectRun }) {
  const { can } = useV2Session();
  const canDesign = can("analyse") || can("run_process_discovery");
  const refresh = useRefreshV2();
  const toast = useToast();
  const models = useModels();
  const label = o.label;
  const [picked, setPicked] = useState<string | null>(null);
  const id = picked ?? models.data?.[0]?.id ?? null;
  const model = useModel(id);
  const versions = useModelVersions(id);
  const [pending, setPending] = useState<string | null>(null);
  const [naming, setNaming] = useState("");
  const [from, setFrom] = useState("reference");
  const [shown, setShown] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const back = `/next/o/${o.systemSeg}/${o.moduleSeg}/processes`;
  const m = model.data?.model;

  const run = async (key: string, job: () => Promise<{ title: string; detail?: string }>) => {
    setPending(key);
    try {
      const r = await job();
      toast({ tone: "good", text: r.detail ? `${r.title}. ${r.detail}` : r.title });
    } catch (e) {
      toast({ tone: "bad", text: errorSentence(e, t("It did not go through")) });
    } finally {
      setPending(null);
    }
  };
  const create = () => {
    setShown(true);
    if (!naming.trim()) return;
    void run("create", async () => {
      const r = await createModel(naming.trim(), from);
      setPicked(r.model.id);
      setNaming("");
      setShown(false);
      refresh();
      return { title: t("{name} created", { name: r.model.name }), detail: from === "reference" ? t("Copied from the reference model derived from the configuration.") : t("Copied from the model you chose.") };
    });
  };
  const publish = () =>
    void run("publish", async () => {
      const next = m?.status === "published" ? "draft" : "published";
      await patchModel(m!.id, { status: next });
      refresh();
      return { title: next === "published" ? t("Model published") : t("Model back to draft"), detail: next === "published" ? t("Process readiness reads the published model.") : undefined };
    });
  const doRename = () =>
    void run("rename", async () => {
      await patchModel(m!.id, { name: (rename ?? "").trim() });
      setRename(null);
      refresh();
      return { title: t("Model renamed") };
    });
  const doDelete = () => {
    setRemoving(false);
    void run("delete", async () => {
      await deleteModel(m!.id);
      setPicked(null);
      refresh();
      return { title: t("Model deleted"), detail: t("Runs and readiness already computed stay.") };
    });
  };

  return (
    <div className="nx-pd" data-testid="process-designer">
      <div className="nx-pd-head">
        <h2 className="nx-pd-h">{t("Process designer")}</h2>
        <span className="nx-sub">{label}</span>
      </div>
      <p className="nx-sub">
        <Link className="nx-link" href={back}>{t("Back to the processes of {label}", { label })}</Link>
        {m ? (
          <>
            {" "}
            <span>{t("{value}, version {current_version}", { value: m.status === "published" ? t("Published") : t("Draft"), current_version: m.current_version })}</span>
            {m.updated_at ? <>{" "}<span>{t("updated {updated_at}", { updated_at: formatDate(m.updated_at, "date") })}</span></> : null}
          </>
        ) : null}
      </p>
      {!canDesign ? <p className="nx-note">{t("Changing the model needs the analyse or run process discovery permission. You can read it.")}</p> : null}

      {models.isLoading ? (
        <Skeleton lines={3} label={t("Loading the process models")} />
      ) : models.isError ? (
        <ErrorState sentence={t("The process models could not be read.")} error={models.error} onRetry={() => void models.refetch()} />
      ) : (models.data ?? []).length > 0 ? (
        <div className="nx-pd-form">
          <Field label={t("Model")}>
            {(p) => (
              <select {...p} className="nx-input" value={id ?? ""} onChange={(e) => setPicked(e.target.value)}>
                {(models.data ?? []).map((x) => (
                  <option key={x.id} value={x.id}>{`${x.name} (${x.status === "published" ? "published" : "draft"}, v${x.current_version})`}</option>
                ))}
              </select>
            )}
          </Field>
        </div>
      ) : (
        <EmptyState heading={t("No process model exists yet. Create one from the reference model, which is derived from the configuration of your systems.")} />
      )}

      {canDesign ? (
        <form
          className="nx-pd-form"
          aria-label={t("Create a model")}
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <h3 className="nx-pd-h3">{t("Create a model")}</h3>
          <div className="nx-pd-two">
            <Field label={t("Name")} error={shown && !naming.trim() ? t("Enter a name") : undefined}>{(p) => <input {...p} className="nx-input" value={naming} onChange={(e) => setNaming(e.target.value)} />}</Field>
            <Field label={t("Start from")}>
              {(p) => (
                <select {...p} className="nx-input" value={from} onChange={(e) => setFrom(e.target.value)}>
                  <option value="reference">{t("The reference model")}</option>
                  {(models.data ?? []).map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <div><Button type="submit" loading={pending === "create"} loadingLabel={t("Saving…")}>{t("Create model")}</Button></div>
        </form>
      ) : null}

      {m ? (
        <div className="nx-actions">
          {canDesign ? (
            <>
              <Button variant="primary" loading={pending === "publish"} loadingLabel={t("Saving…")} onClick={publish}>{m.status === "published" ? t("Unpublish") : t("Publish model")}</Button>
              <Button onClick={() => setRename(m.name)}>{t("Rename model")}</Button>
              <Button variant="danger" onClick={() => setRemoving(true)}>{t("Delete model")}</Button>
            </>
          ) : null}
          <PptxExport modelId={m.id} />
        </div>
      ) : null}
      {rename !== null ? (
        <form
          className="nx-pd-form"
          aria-label={t("Rename the model")}
          onSubmit={(e) => {
            e.preventDefault();
            if (rename.trim()) doRename();
          }}
        >
          <Field label={t("Model name")}>{(p) => <input {...p} className="nx-input" value={rename} onChange={(e) => setRename(e.target.value)} />}</Field>
          <div className="nx-actions">
            <Button type="submit" disabled={!rename.trim()} reason={t("Enter a name")} loading={pending === "rename"} loadingLabel={t("Saving…")}>{t("Save name")}</Button>
            <Button variant="quiet" onClick={() => setRename(null)}>{t("Cancel")}</Button>
          </div>
        </form>
      ) : null}
      <Confirm
        open={removing && !!m}
        title={t("Delete model")}
        consequence={t("{name} and all its versions are deleted. Readiness already computed stays.", { name: m?.name ?? "" })}
        confirmLabel={t("Delete model")}
        danger
        onConfirm={doDelete}
        onCancel={() => setRemoving(false)}
      />

      <div>
        {id && model.isLoading ? (
          <Skeleton lines={8} label={t("Loading the model")} />
        ) : id && model.isError ? (
          <ErrorState sentence={t("The model could not be read.")} error={model.error} onRetry={() => void model.refetch()} />
        ) : model.data ? (
          <Editor key={`${model.data.model.id}:${model.data.version_no}`} data={model.data} canDesign={canDesign} onChanged={refresh} />
        ) : null}
      </div>
      {versions.data?.length ? (
        <section aria-label={t("Versions")}>
          <h2 className="nx-pd-h">{t("Versions")}</h2>
          <ul className="nx-pd-list">
            {versions.data.slice(0, 8).map((v) => (
              <li key={v.version_no} className="nx-pd-row">
                <span>{t("Version {version_no}: {note}", { version_no: v.version_no, note: v.note ?? t("no note") })}</span>
                <span className="nx-sub">{v.created_at ? formatDate(v.created_at, "date") : ""}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="nx-sub">{t("A step is blocked in process readiness when a field it reads fails a critical or high rule. Map the fields each activity reads here, and the Processes tab shows them on the next run.")}</p>
    </div>
  );
}
