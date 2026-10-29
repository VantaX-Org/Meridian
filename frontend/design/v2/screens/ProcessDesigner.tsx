"use client";

import { useState } from "react";
import { createModel, deleteModel, patchModel, saveModel, type ModelWithDocument } from "@/lib/api/v2/designer";
import { saveFailure } from "@/lib/api/process-designer";
import { addChild, addNode, childrenOf, locate, moveItem, patchItem, removeItem, renameItem, patchActivity, type Level, type TreeItem } from "@/app/(app)/insights/process/designer/_components/doc";
import type { L4, L5, ProcessModelDocument } from "@/types/process-model";
import { formatDate, labelOf } from "@/lib/format";
import { addField, deleteActivity, fieldError, LEVEL_WORD, moveActivity, removeField, sameDoc, toggleMandatory } from "@/lib/v2/designer-doc";
import { useV2Session } from "@/lib/v2/hooks";
import { useLandscape } from "@/lib/v2/queries";
import { useModel, useModels, useModelVersions, useRefreshV2 } from "@/lib/v2/sys-queries";
import { ConfirmBar, Field, Gate } from "../forms";
import { ResultFrame, useOutcome } from "../inspector/shared";
import { Dash, Dot, EmptyFrame, ErrorFrame, Mono, Skeleton, V2Link } from "../parts";

type Run = ReturnType<typeof useOutcome>["run"];

/* ---- the detail of one selected item ---- */

function ActivityEditor({ act, index, count, doc, apply, canDesign }: { act: L5; index: number; count: number; doc: ProcessModelDocument; apply: (d: ProcessModelDocument) => void; canDesign: boolean }) {
  const [field, setField] = useState("");
  const [shown, setShown] = useState(false);
  const [removing, setRemoving] = useState(false);
  const err = shown ? fieldError(field, act.fields.map((f) => f.field)) : undefined;
  return (
    <li className="m2-act5" aria-label={act.name}>
      <div className="m2-sv-h">
        <Field label="Activity">{(p) => <input {...p} disabled={!canDesign} value={act.name} onChange={(e) => apply(patchActivity(doc, act.id, { name: e.target.value }))} />}</Field>
        {canDesign ? (
          <span className="m2-node-acts">
            <button type="button" className="m2-mini" aria-label={`Move ${act.name} up`} disabled={index === 0} onClick={() => apply(moveActivity(doc, act.id, -1))}>Up</button>
            <button type="button" className="m2-mini" aria-label={`Move ${act.name} down`} disabled={index === count - 1} onClick={() => apply(moveActivity(doc, act.id, 1))}>Down</button>
            <button type="button" className="m2-mini" aria-label={`Delete ${act.name}`} onClick={() => setRemoving(true)}>Delete</button>
          </span>
        ) : null}
      </div>
      {removing ? <ConfirmBar message={`${act.name} and its field mapping are removed when you save.`} confirmLabel="Delete activity" onConfirm={() => apply(deleteActivity(doc, act.id))} onCancel={() => setRemoving(false)} /> : null}
      {act.fields.length === 0 ? (
        <p className="m2-rp m2-meta">No field is mapped to this activity.</p>
      ) : (
        <ul className="m2-lk" aria-label={`Fields of ${act.name}`}>
          {act.fields.map((f) => (
            <li key={f.field}>
              <Mono>{f.field}</Mono>
              <span className="m2-meta">
                <label className="m2-chk">
                  <input type="checkbox" disabled={!canDesign} checked={f.mandatory} onChange={() => apply(toggleMandatory(doc, act.id, f.field))} />
                  Mandatory
                </label>{" "}
                {canDesign ? (
                  <button type="button" className="m2-mini" aria-label={`Unmap ${f.field}`} onClick={() => apply(removeField(doc, act.id, f.field))}>Unmap</button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canDesign ? (
        <form
          className="m2-form6"
          aria-label={`Map a field to ${act.name}`}
          onSubmit={(e) => {
            e.preventDefault();
            setShown(true);
            if (fieldError(field, act.fields.map((x) => x.field))) return;
            apply(addField(doc, act.id, field));
            setField("");
            setShown(false);
          }}
        >
          <Field label="Map a field" error={err} hint="TABLE.FIELD">{(p) => <input {...p} className="m2-mono" value={field} onChange={(e) => setField(e.target.value)} placeholder="MARA.MATNR" />}</Field>
          <div className="m2-acts"><button type="submit" className="m2-btn m2-sm">Map field</button></div>
        </form>
      ) : null}
    </li>
  );
}

function Detail({ doc, id, apply, canDesign, select }: { doc: ProcessModelDocument; id: string | null; apply: (d: ProcessModelDocument, select?: string) => void; canDesign: boolean; select: (id: string | null) => void }) {
  const [child, setChild] = useState("");
  const [shown, setShown] = useState(false);
  const hit = locate(doc, id);
  const level = (hit?.level ?? 0) as 0 | Level;
  const next = level + 1;
  const add = () => {
    setShown(true);
    if (!child.trim()) return;
    if (level === 4) {
      const r = addNode(doc, hit!.item.id, "task", child.trim());
      apply(r.doc);
    } else {
      const r = addChild(doc, hit?.item.id ?? null, child.trim());
      apply(r.doc, r.id);
    }
    setChild("");
    setShown(false);
  };
  const label = level === 4 ? "Activity" : LEVEL_WORD[next as 1 | 2 | 3 | 4];
  return (
    <section aria-label="Selected item" data-testid="designer-detail">
      {hit ? (
        <>
          <h2 className="m2-h2">{`${LEVEL_WORD[level as 1]}: ${hit.item.name || "unnamed"}`}</h2>
          <p className="m2-rp m2-meta"><Mono>{hit.item.id}</Mono></p>
          <div className="m2-form6">
            <Field label="Name" error={!hit.item.name.trim() ? "A name is required" : undefined}>
              {(p) => <input {...p} disabled={!canDesign} value={hit.item.name} onChange={(e) => apply(renameItem(doc, hit.item.id, e.target.value))} />}
            </Field>
            <Field label="Description">{(p) => <input {...p} disabled={!canDesign} value={hit.item.description} onChange={(e) => apply(patchItem(doc, hit.item.id, { description: e.target.value }))} />}</Field>
            {level === 4 ? (
              <Field label="Transaction code">{(p) => <input {...p} className="m2-mono" disabled={!canDesign} value={(hit.item as L4).tcode ?? ""} onChange={(e) => apply(patchItem<L4>(doc, hit.item.id, { tcode: e.target.value.toUpperCase() || null }))} />}</Field>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <h2 className="m2-h2">The model</h2>
          <p className="m2-rp m2-meta">Choose an item in the tree to rename it, reorder it, add what sits under it, or map fields to its activities.</p>
        </>
      )}
      {canDesign && level < 5 ? (
        <form
          className="m2-form6"
          style={{ marginTop: 16 }}
          aria-label={`Add ${label.toLowerCase()}`}
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Field label={`New ${label.toLowerCase()}`} error={shown && !child.trim() ? "Enter a name" : undefined}>{(p) => <input {...p} value={child} onChange={(e) => setChild(e.target.value)} />}</Field>
          <div className="m2-acts"><button type="submit" className="m2-btn">{`Add ${label.toLowerCase()}`}</button></div>
        </form>
      ) : null}
      {level === 4 ? (
        <>
          <h3 style={{ marginTop: 16 }}>Activities and the fields they read</h3>
          {(hit!.item as L4).activities.length === 0 ? (
            <p className="m2-rp m2-meta">This step has no activity yet. Add one above, then map the fields it reads or writes.</p>
          ) : (
            <ul className="m2-srcs" style={{ gap: 16 }} aria-label="Activities">
              {(hit!.item as L4).activities.map((a, i, all) => (
                <ActivityEditor key={a.id} act={a} index={i} count={all.length} doc={doc} apply={(d) => apply(d)} canDesign={canDesign} />
              ))}
            </ul>
          )}
        </>
      ) : null}
      {hit ? <p className="m2-prov"><button type="button" className="m2-linkbtn" onClick={() => select(null)}>Back to the model</button></p> : null}
    </section>
  );
}

/* ---- the tree ---- */

function Tree({ doc, items, depth: level, selected, select, apply, canDesign }: { doc: ProcessModelDocument; items: TreeItem[]; depth: Level; selected: string | null; select: (id: string) => void; apply: (d: ProcessModelDocument, select?: string) => void; canDesign: boolean }) {
  const [removing, setRemoving] = useState<TreeItem | null>(null);
  return (
    <>
      <ul className={level === 1 ? "m2-tree" : undefined}>
        {items.map((it, i) => {
          const kids = level < 4 ? childrenOf(it, level) : [];
          return (
            <li key={it.id}>
              <div className="m2-node" data-current={selected === it.id ? "true" : undefined}>
                <span className="m2-lvl">{`L${level}`}</span>
                <button type="button" className="m2-pick-n" aria-current={selected === it.id ? "true" : undefined} onClick={() => select(it.id)}>
                  {it.name || "Unnamed"}
                  {level === 4 ? <span className="m2-meta">{` ${(it as L4).activities.length} activities`}</span> : null}
                </button>
                {canDesign ? (
                  <span className="m2-node-acts">
                    <button type="button" className="m2-mini" aria-label={`Move ${it.name} up`} disabled={i === 0} onClick={() => apply(moveItem(doc, it.id, -1))}>Up</button>
                    <button type="button" className="m2-mini" aria-label={`Move ${it.name} down`} disabled={i === items.length - 1} onClick={() => apply(moveItem(doc, it.id, 1))}>Down</button>
                    <button type="button" className="m2-mini" aria-label={`Delete ${it.name}`} onClick={() => setRemoving(it)}>Delete</button>
                  </span>
                ) : null}
              </div>
              {kids.length ? <Tree doc={doc} items={kids} depth={(level + 1) as Level} selected={selected} select={select} apply={apply} canDesign={canDesign} /> : null}
            </li>
          );
        })}
      </ul>
      {removing ? (
        <ConfirmBar
          message={`${removing.name || "This item"} and everything under it are removed when you save.`}
          confirmLabel={`Delete ${LEVEL_WORD[level as 1].toLowerCase()}`}
          onConfirm={() => {
            apply(removeItem(doc, removing.id));
            setRemoving(null);
          }}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
    </>
  );
}

/* ---- the editor of one model version ---- */

function Editor({ data, canDesign, run, pending, onChanged }: { data: ModelWithDocument; canDesign: boolean; run: Run; pending: string | null; onChanged: () => void }) {
  const [doc, setDoc] = useState<ProcessModelDocument>(data.document);
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const dirty = !sameDoc(doc, data.document);
  const apply = (d: ProcessModelDocument, select?: string) => {
    setDoc(d);
    setProblems([]);
    if (select) setSelected(select);
  };
  const save = () =>
    void run("save", async () => {
      try {
        const r = await saveModel(data.model.id, { document: doc, note: note.trim() || "Edited in the designer", base_version: data.version_no });
        setProblems([]);
        onChanged();
        return { tone: "ok", title: `Saved as version ${r.version_no}`, detail: r.warnings.length ? r.warnings.join(" ") : "Changes show in process readiness on the next run." };
      } catch (e) {
        const f = saveFailure(e);
        if (f.kind === "invalid") {
          setProblems(f.errors.map((x) => `${x.path ? `${x.path}: ` : ""}${x.message}`));
          return { tone: "fail", title: "The model was not saved", detail: "Fix the problems listed below." };
        }
        if (f.kind === "stale") return { tone: "fail", title: "The model changed since you opened it", detail: "Reload it to see the newer version, then make your change again." };
        throw e;
      }
    });
  return (
    <>
      <div className="m2-des">
        <section aria-label="Process tree">
          <div className="m2-sechead"><h2 className="m2-h2">Model</h2><span className="m2-sub">{`Version ${data.version_no}`}{dirty ? ", unsaved changes" : ""}</span></div>
          {doc.l1.length === 0 ? <EmptyFrame>The model has no process yet. Add the first one on the right.</EmptyFrame> : <Tree doc={doc} items={doc.l1} depth={1} selected={selected} select={setSelected} apply={apply} canDesign={canDesign} />}
          {canDesign ? (
            <p className="m2-prov"><button type="button" className="m2-linkbtn" onClick={() => setSelected(null)}>Add a process at the top level</button></p>
          ) : null}
        </section>
        <Detail doc={doc} id={selected} apply={apply} canDesign={canDesign} select={setSelected} />
      </div>
      {canDesign ? (
        <form
          className="m2-form6"
          style={{ marginTop: 24 }}
          aria-label="Save the model"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty) save();
          }}
        >
          <Field label="What changed" hint="Kept with the version.">{(p) => <input {...p} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <div className="m2-acts">
            <button type="submit" className="m2-btn m2-strong" disabled={!dirty || pending !== null}>{pending === "save" ? "Saving…" : "Save as a new version"}</button>
            <button type="button" className="m2-btn m2-ghost" disabled={!dirty} onClick={() => apply(data.document)}>Discard changes</button>
          </div>
        </form>
      ) : null}
      {problems.length ? (
        <ul className="m2-hint-list" role="alert" aria-label="Problems in the model">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

/**
 * `/v2/o/{system}/{module}/processes/design`: the L1 to L5 process model as a tree you edit. Add, rename, reorder and
 * delete processes, areas, sub-processes, steps and activities; map TABLE.FIELD to an activity; save a new version;
 * publish the model. Models are tenant-wide, so the process that reads this object is one among them. Needs analyse or
 * run process discovery to change anything; without it the tree is read-only.
 */
export function ProcessDesigner({ system, module }: { system: string; module: string }) {
  const { can } = useV2Session();
  const canDesign = can("analyse") || can("run_process_discovery");
  const refresh = useRefreshV2();
  const models = useModels();
  const label = useLandscape(null).data?.objects.find((o) => o.module === module.replace(/-/g, "_"))?.label ?? labelOf(module.replace(/-/g, "_"));
  const [picked, setPicked] = useState<string | null>(null);
  const id = picked ?? models.data?.[0]?.id ?? null;
  const model = useModel(id);
  const versions = useModelVersions(id);
  const { outcome, pending, run } = useOutcome();
  const [naming, setNaming] = useState("");
  const [from, setFrom] = useState("reference");
  const [shown, setShown] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const back = `/v2/o/${system}/${module}/processes`;
  const m = model.data?.model;

  const create = () => {
    setShown(true);
    if (!naming.trim()) return;
    void run("create", async () => {
      const r = await createModel(naming.trim(), from);
      setPicked(r.model.id);
      setNaming("");
      setShown(false);
      refresh();
      return { tone: "ok", title: `${r.model.name} created`, detail: from === "reference" ? "Copied from the reference model derived from the configuration." : "Copied from the model you chose." };
    });
  };
  const publish = () =>
    void run("publish", async () => {
      const next = m?.status === "published" ? "draft" : "published";
      await patchModel(m!.id, { status: next });
      refresh();
      return { tone: "ok", title: next === "published" ? "Model published" : "Model back to draft", detail: next === "published" ? "Process readiness reads the published model." : undefined };
    });
  const doRename = () =>
    void run("rename", async () => {
      await patchModel(m!.id, { name: (rename ?? "").trim() });
      setRename(null);
      refresh();
      return { tone: "ok", title: "Model renamed" };
    });
  const doDelete = () =>
    void run("delete", async () => {
      await deleteModel(m!.id);
      setPicked(null);
      setRemoving(false);
      refresh();
      return { tone: "ok", title: "Model deleted", detail: "Runs and readiness already computed stay." };
    });

  return (
    <>
      <div className="m2-sechead" style={{ marginTop: 0 }}>
        <h2 className="m2-h2">Process designer</h2>
        <span className="m2-sub">{label}</span>
      </div>
      <p className="m2-statusline">
        <V2Link href={back}>Back to the processes of {label}</V2Link>
        {m ? (
          <>
            <Dot />
            <span>{`${m.status === "published" ? "Published" : "Draft"}, version ${m.current_version}`}</span>
            {m.updated_at ? <span>{`updated ${formatDate(m.updated_at, "date")}`}</span> : null}
          </>
        ) : null}
      </p>
      {!canDesign ? <Gate>Changing the model needs the analyse or run process discovery permission. You can read it.</Gate> : null}

      {models.isLoading ? (
        <Skeleton width="100%" height={80} />
      ) : models.isError ? (
        <ErrorFrame onRetry={() => void models.refetch()}>The process models could not be read.</ErrorFrame>
      ) : (
        <div className="m2-form6" style={{ marginTop: 16 }}>
          {(models.data ?? []).length > 0 ? (
            <Field label="Model">
              {(p) => (
                <select {...p} value={id ?? ""} onChange={(e) => setPicked(e.target.value)}>
                  {(models.data ?? []).map((x) => (
                    <option key={x.id} value={x.id}>{`${x.name} (${x.status === "published" ? "published" : "draft"}, v${x.current_version})`}</option>
                  ))}
                </select>
              )}
            </Field>
          ) : (
            <EmptyFrame>No process model exists yet. Create one from the reference model, which is derived from the configuration of your systems.</EmptyFrame>
          )}
        </div>
      )}

      {canDesign ? (
        <form
          className="m2-form6"
          style={{ marginTop: 16 }}
          aria-label="Create a model"
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <h3>Create a model</h3>
          <div className="m2-grid2">
            <Field label="Name" error={shown && !naming.trim() ? "Enter a name" : undefined}>{(p) => <input {...p} value={naming} onChange={(e) => setNaming(e.target.value)} />}</Field>
            <Field label="Start from">
              {(p) => (
                <select {...p} value={from} onChange={(e) => setFrom(e.target.value)}>
                  <option value="reference">The reference model</option>
                  {(models.data ?? []).map((x) => (
                    <option key={x.id} value={x.id}>{x.name}</option>
                  ))}
                </select>
              )}
            </Field>
          </div>
          <div className="m2-acts"><button type="submit" className="m2-btn" disabled={pending !== null}>Create model</button></div>
        </form>
      ) : null}

      {m && canDesign ? (
        <div className="m2-acts" style={{ marginTop: 16 }}>
          <button type="button" className="m2-btn m2-strong" disabled={pending !== null} onClick={publish}>{m.status === "published" ? "Unpublish" : "Publish model"}</button>
          <button type="button" className="m2-btn" onClick={() => setRename(m.name)}>Rename model</button>
          <button type="button" className="m2-btn m2-ghost" aria-expanded={removing} onClick={() => setRemoving((x) => !x)}>Delete model</button>
        </div>
      ) : null}
      {rename !== null ? (
        <form
          className="m2-form6"
          style={{ marginTop: 8 }}
          aria-label="Rename the model"
          onSubmit={(e) => {
            e.preventDefault();
            if (rename.trim()) doRename();
          }}
        >
          <Field label="Model name">{(p) => <input {...p} value={rename} onChange={(e) => setRename(e.target.value)} />}</Field>
          <div className="m2-acts">
            <button type="submit" className="m2-btn" disabled={!rename.trim() || pending !== null}>Save name</button>
            <button type="button" className="m2-btn m2-ghost" onClick={() => setRename(null)}>Cancel</button>
          </div>
        </form>
      ) : null}
      {removing && m ? <ConfirmBar message={`${m.name} and all its versions are deleted. Readiness already computed stays.`} confirmLabel="Delete model" pending={pending === "delete"} onConfirm={doDelete} onCancel={() => setRemoving(false)} /> : null}
      {outcome ? <ResultFrame outcome={outcome} /> : null}

      <div className="m2-sec">
        {id && model.isLoading ? (
          <Skeleton width="100%" height={220} />
        ) : id && model.isError ? (
          <ErrorFrame onRetry={() => void model.refetch()}>The model could not be read.</ErrorFrame>
        ) : model.data ? (
          <Editor key={`${model.data.model.id}:${model.data.version_no}`} data={model.data} canDesign={canDesign} run={run} pending={pending} onChanged={refresh} />
        ) : null}
      </div>
      {versions.data?.length ? (
        <section className="m2-sec" aria-label="Versions">
          <div className="m2-sechead"><h2 className="m2-h2">Versions</h2></div>
          <ul className="m2-hist">
            {versions.data.slice(0, 8).map((v) => (
              <li key={v.version_no}>
                <span className="m2-d">{v.created_at ? formatDate(v.created_at, "date") : <Dash />}</span>
                <span>{`Version ${v.version_no}: ${v.note ?? "no note"}`}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <p className="m2-prov">A step is blocked in process readiness when a field it reads fails a critical or high rule. Map the fields each activity reads here, and the Processes tab shows them on the next run.</p>
    </>
  );
}
