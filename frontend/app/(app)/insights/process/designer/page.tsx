"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ChoiceGroup, ConfirmDialog, ErrorState, Field, Input, Mono, Notice, PageHeader, Select, Skeleton, Stat } from "@/design";
import { useFindingHref, useLatestVersion } from "@/components/process/shared";
import { runScopeLabel } from "@/lib/run-scope";
import {
  adoptVariant, createModel, deleteModel, getModel, getOverlay, getReference, listModels, listVariants, patchModel, saveFailure, saveModel,
  pptxExportUrl, signavioExportUrl, type SaveFailure,
} from "@/lib/api/process-designer";
import { toast } from "sonner";
import { downloadAuthenticated } from "@/lib/api/download";
import { apiErrorMessage, apiErrorState } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import { useRole } from "@/hooks/use-role";
import { domainOf } from "@/design/tokens";
import type { L4, ModelOverlay, ModelSummary, NodeType, ProcessModelDocument, ProcessVariant } from "@/types/process-model";
import "./designer.css";
import { AttributeDrawer } from "./_components/attributes";
import { DesignerCanvas } from "./_components/canvas";
import { Discovered, skeletonFrom } from "./_components/discovered";
import * as D from "./_components/doc";
import { LevelTable } from "./_components/level-table";
import { ProcessTree, type TreeActions } from "./_components/tree";
import { OldVersionBanner, VersionsMenu } from "./_components/versions";

const NEW_NAME = ["New process", "New process area", "New process group", "New sub-process"];

/** The one line under the title. */
const DESIGNER_PURPOSE = "Draw how your business processes should run, and see which steps the data of the selected run breaks.";

export default function ProcessDesigner() {
  const sp = useSearchParams();
  const model = sp.get("model") ?? "reference";
  const vRaw = sp.get("v");
  const v = vRaw && /^[1-9]\d{0,5}$/.test(vRaw) ? vRaw : null;
  const overlayOn = sp.get("overlay") !== "none";
  const reference = model === "reference";

  const models = useQuery({ queryKey: queryKeys.processModels(), queryFn: listModels });
  const ref = useQuery({ queryKey: queryKeys.processReference(), queryFn: getReference, enabled: reference });
  const saved = useQuery({
    queryKey: queryKeys.processModel(model, v ?? undefined), queryFn: () => getModel(model, v ? Number(v) : undefined), enabled: !reference,
  });
  const { latest } = useLatestVersion();
  const overlay = useQuery({
    queryKey: queryKeys.processOverlay(model, latest?.id), enabled: !reference && !!latest && overlayOn, retry: false, meta: { ignoreError: true },
    queryFn: () => getOverlay(model, latest!.id),
  });
  const variants = useQuery({
    queryKey: queryKeys.processVariants(latest?.id), enabled: !!latest, retry: false, meta: { ignoreError: true },
    queryFn: () => listVariants(latest!.id),
  });
  const findingHref = useFindingHref(latest?.id);

  const doc = reference ? ref.data : saved.data?.document;
  const versionNo = reference ? 0 : saved.data?.version_no ?? 0;
  const currentVersion = reference ? 0 : saved.data?.model.current_version ?? 0;
  const failed = reference ? ref.error : saved.error;
  if (!doc) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Process designer" meta={DESIGNER_PURPOSE} />
        {failed ? (
          <ErrorState {...apiErrorState(failed)}
            onRetry={() => void (reference ? ref.refetch() : saved.refetch())} />
        ) : <Skeleton height={240} />}
      </div>
    );
  }
  return (
    <Editor key={`${model}:${v ?? ""}:${versionNo}`}
      model={model} initial={doc} versionNo={versionNo} currentVersion={currentVersion} viewingOld={!reference && versionNo !== currentVersion}
      models={models.data ?? []} overlay={overlayOn ? overlay.data ?? null : null} overlayOn={overlayOn}
      variants={variants.data ?? []} latestId={latest?.id} latestLabel={latest ? runScopeLabel(latest) : undefined} findingHref={findingHref} />
  );
}

interface EditorProps {
  model: string;
  initial: ProcessModelDocument;
  versionNo: number;
  currentVersion: number;
  viewingOld: boolean;
  models: ModelSummary[];
  overlay: ModelOverlay | null;
  overlayOn: boolean;
  variants: ProcessVariant[];
  latestId: string | undefined;
  /** "As of" label of the run the overlay reads. */
  latestLabel: string | undefined;
  findingHref: (module: string, checkId: string) => string | undefined;
}

function Editor(p: EditorProps) {
  const { model, initial, versionNo, currentVersion, viewingOld, overlay, overlayOn } = p;
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const attr = sp.get("attr");
  const node = sp.get("node");
  const reference = model === "reference";
  // Wave 16: every designer write needs `analyse` (or run_process_discovery, the process owner's right), the
  // export needs `export` (or export_process). Without them the controls are not rendered and the reference
  // prompt never opens. Mirrors api/routes/process_designer.py and process_export.py.
  const role = useRole();
  const canDesign = role.can("analyse") || role.can("run_process_discovery");
  const canExport = role.can("export") || role.can("export_process");
  const editable = canDesign && !reference && !viewingOld;

  const [doc, setDoc] = useState(initial);
  const [note, setNote] = useState("");
  const [fail, setFail] = useState<SaveFailure | null>(null);
  const [prompt, setPrompt] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  // A model or version picked while there are unsaved edits waits here for "Discard unsaved changes?".
  const [leaving, setLeaving] = useState<{ body: string; confirmLabel: string; run: () => void } | null>(null);
  const dirty = doc !== initial;
  /** Runs `run` now, or after the discard confirm when there are unsaved edits. */
  const guard = (body: string, confirmLabel: string, run: () => void) => { if (dirty) setLeaving({ body, confirmLabel, run }); else run(); };

  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, x] of Object.entries(patch)) { if (x) next.set(k, x); else next.delete(k); }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const refresh = () => {
    [queryKeys.processModelAll(), queryKeys.processModels(), queryKeys.processModelVersionsAll(), queryKeys.processOverlayAll(), queryKeys.processVariantsAll()]
      .forEach((queryKey) => void qc.invalidateQueries({ queryKey }));
  };

  const create = useMutation({
    // "Create from this model" copies what is on screen: with unsaved edits, the draft is saved as the new model's
    // first version, so nothing is dropped by the switch to it.
    mutationFn: async (a: { name: string; from: string; draft?: ProcessModelDocument }) => {
      const r = await createModel(a.name, a.from);
      if (a.draft) await saveModel(r.model.id, { document: a.draft, note: note || "Copied with unsaved edits", base_version: r.version_no });
      return r;
    },
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: queryKeys.processModels() }); setNaming(null); setPrompt(false); go({ model: r.model.id, v: null, attr: null }); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const save = useMutation({
    mutationFn: () => saveModel(model, { document: doc, note, base_version: versionNo }),
    onSuccess: () => { setNote(""); setFail(null); refresh(); },
    onError: (e) => setFail(saveFailure(e)),
  });
  const restore = useMutation({
    mutationFn: () => saveModel(model, { document: initial, note: `Restored version ${versionNo}`, base_version: currentVersion }),
    onSuccess: () => { refresh(); go({ v: null }); },
    onError: (e) => setFail(saveFailure(e)),
  });
  const copy = useMutation({
    mutationFn: async () => {
      const r = await createModel("Copy of model", model);
      await saveModel(r.model.id, { document: doc, note, base_version: r.version_no });
      return r;
    },
    onSuccess: (r) => { refresh(); go({ model: r.model.id, v: null, attr: null }); },
    onError: (e) => setFail(saveFailure(e)),
  });
  const adopt = useMutation({
    mutationFn: (a: { variantId: string; l4Id: string }) => adoptVariant(model, { variant_id: a.variantId, l4_id: a.l4Id }),
    onSuccess: refresh,
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  // Rename and delete the open model (PATCH / DELETE /process-designer/models/{id}, permission `analyse` or `run_process_discovery`).
  const modelName = p.models.find((m) => m.id === model)?.name ?? "";
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const rename = useMutation({
    mutationFn: (name: string) => patchModel(model, { name }),
    onSuccess: (r) => { setRenaming(null); refresh(); toast.success(`Model renamed to ${r.name}`); },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => deleteModel(model),
    onSuccess: () => {
      setDeleting(false);
      toast.success(`Model ${modelName} deleted`);
      void qc.invalidateQueries({ queryKey: queryKeys.processModels() });
      switchTo("reference");
    },
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const renameTo = renaming?.trim() ?? "";

  const saveRef = useRef(() => {});
  useEffect(() => { saveRef.current = () => { if (dirty && editable && !save.isPending) save.mutate(); }; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur();
      setTimeout(() => saveRef.current(), 0);
    };
    const onLeave = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onLeave);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("beforeunload", onLeave); };
  }, [dirty]);

  const blocked = () => { if (reference && canDesign) setPrompt(true); };
  const edit = (fn: (d: ProcessModelDocument) => ProcessModelDocument) => { if (editable) setDoc(fn); else blocked(); };

  const located = node ? D.locate(doc, node) : null;
  const found = node && !located ? D.findActivity(doc, node) : null;
  const l4: L4 | null = located?.level === 4 ? (located.item as L4) : found?.l4 ?? null;
  const parent = located && located.level < 4 ? located.item : null;
  const parentLevel = (located && located.level < 4 ? located.level : 0) as D.Level | 0;

  const ov = overlayOn && overlay ? overlay.activities : null;
  const actColour = (id: string) => ov?.[id]?.dq_status;
  const acts = D.allL4(doc).flatMap((x) => x.activities);
  const count = (c: string) => acts.filter((a) => actColour(a.id) === c).length;
  const unmapped = p.variants.filter(D.isUnmapped);
  const noOverlay = ov ? undefined : reference ? "Create your own model to see the data on it." : !overlayOn ? "Turn on Selected run above to see this." : "Needs a finished run.";

  const actions: TreeActions = {
    rename: (id, name) => edit((d) => D.renameItem(d, id, name)),
    add: (parentId) => {
      if (!editable) return blocked();
      const level = parentId ? (D.locate(doc, parentId)?.level ?? 0) + 1 : 1;
      const r = D.addChild(doc, parentId, NEW_NAME[level - 1]);
      setDoc(r.doc);
      go({ node: r.id, attr: null });
    },
    remove: (id) => { edit((d) => D.removeItem(d, id)); if (id === node) go({ node: null, attr: null }); },
    move: (id, dir) => edit((d) => D.moveItem(d, id, dir)),
  };

  const switchTo = (m: string) => go({ model: m, v: null, attr: null, node: null });
  const exportZip = useMutation({
    mutationFn: () => downloadAuthenticated(
      signavioExportUrl(model, viewingOld ? versionNo : undefined, overlayOn ? p.latestId : undefined), "process-model.zip"),
    onSuccess: () => toast.success("Signavio package exported"),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });
  const exportPptx = useMutation({
    mutationFn: () => downloadAuthenticated(pptxExportUrl(model, viewingOld ? versionNo : undefined), "process-model.pptx"),
    onSuccess: () => toast.success("PowerPoint exported"),
    onError: (e) => toast.error(apiErrorMessage(e)),
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Process designer"
        meta={<>
          <span className="block m-text-body m-ink-2">{DESIGNER_PURPOSE}</span>
          <span className="mt-1 block">
            {reference ? "The SAP reference model is read-only; create your own model to edit it" : `Version ${versionNo} of ${currentVersion}; every save keeps a new version`}
            {p.latestLabel ? `. Data as of ${p.latestLabel}` : ". No finished run yet, so no data is shown on the model"}
          </span>
        </>}
        actions={<>
          <Select
            label="Process model"
            value={model}
            options={[{ value: "reference", label: "Reference model" }, ...p.models.map((m) => ({ value: m.id, label: m.name }))]}
            onValueChange={(m) => { if (m !== model) guard("Switching models drops the edits you have not saved to this one.", "Discard and switch", () => switchTo(m)); }} />
          {!reference ? <VersionsMenu modelId={model} shown={viewingOld ? versionNo : null}
            onPick={(no) => guard("Opening another version drops the edits you have not saved.", "Discard and open", () => go({ v: no ? String(no) : null }))} /> : null}
          {canDesign ? <Button variant={reference ? "primary" : "secondary"} onClick={() => setNaming(naming === null ? "" : null)}>{reference ? "Create a model to edit" : "New model"}</Button> : null}
          {canDesign && !reference && modelName ? <Button variant="ghost" onClick={() => setRenaming(modelName)}>Rename</Button> : null}
          {canDesign && !reference && modelName ? <Button variant="ghost" onClick={() => setDeleting(true)}>Delete</Button> : null}
          {canExport ? <Button variant="secondary" disabled={dirty} pending={exportZip.isPending} onClick={() => exportZip.mutate()}>Export to Signavio</Button> : null}
          {canExport ? <Button variant="secondary" disabled={dirty} pending={exportPptx.isPending} onClick={() => exportPptx.mutate()}>Export to PowerPoint</Button> : null}
        </>} />

      <ConfirmDialog open={leaving !== null} onOpenChange={(o) => { if (!o) setLeaving(null); }}
        title="Discard unsaved changes?" body={leaving?.body ?? ""}
        confirmLabel={leaving?.confirmLabel ?? "Discard"} cancelLabel="Keep editing" tone="danger"
        onConfirm={() => { const l = leaving; setLeaving(null); setDoc(initial); l?.run(); }} />
      <ConfirmDialog open={renaming !== null} onOpenChange={(o) => { if (!o) setRenaming(null); }}
        title="Rename model" confirmLabel="Save name" pending={rename.isPending}
        confirmDisabled={!renameTo || renameTo === modelName}
        onConfirm={() => { if (renameTo && renameTo !== modelName) rename.mutate(renameTo); }}
        body={
          <Field label="Name">
            <Input value={renaming ?? ""} autoFocus onChange={(e) => setRenaming(e.target.value)} />
          </Field>
        } />
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} tone="danger"
        title={`Delete ${modelName}?`} confirmLabel="Delete model" pending={remove.isPending} typeToConfirm={modelName}
        onConfirm={() => remove.mutate()}
        body={<p className="m-ink-2">The model and all {currentVersion.toLocaleString()} of its versions are removed for everyone{dirty ? ", with the edits you have not saved" : ""}. This cannot be undone.</p>} />

      {naming !== null ? (
        <form className="flex items-center gap-2" onSubmit={(e) => {
          e.preventDefault();
          if (naming.trim()) create.mutate({ name: naming.trim(), from: model, draft: dirty && !reference ? doc : undefined });
        }}>
          <Input aria-label="Model name" autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} />
          <Button variant="primary" type="submit" disabled={!naming.trim() || create.isPending}>
            {reference ? "Create from reference" : dirty ? "Create from this model, with your unsaved edits" : "Create from this model"}
          </Button>
          <Button variant="ghost" onClick={() => setNaming(null)}>Close</Button>
        </form>
      ) : null}

      {prompt ? (
        <Notice tone="info" title="Create a model from the reference to edit it"
          action={<><Button variant="primary" disabled={create.isPending} onClick={() => create.mutate({ name: "My process model", from: "reference" })}>Create model</Button><Button variant="ghost" onClick={() => setPrompt(false)}>Not now</Button></>}>
          The reference model is shared and read-only.
        </Notice>
      ) : null}
      {viewingOld ? <OldVersionBanner viewing={versionNo} latest={currentVersion} busy={restore.isPending} onRestore={canDesign ? () => restore.mutate() : undefined} onLatest={() => go({ v: null })} /> : null}
      {fail?.kind === "stale" ? (
        <Notice tone="warning" title={`Someone saved version ${fail.current ?? "a newer one"} while you edited`}
          action={<><Button variant="secondary" onClick={() => { setFail(null); setDoc(initial); refresh(); }}>Reload</Button><Button variant="secondary" disabled={copy.isPending} onClick={() => copy.mutate()}>Save as a copy</Button></>}>
          Reload to take their version, or save your changes as a copy.
        </Notice>
      ) : null}
      {fail?.kind === "invalid" ? (
        <Notice tone="danger" title="The model was not saved">
          <ul>{fail.errors.slice(0, 8).map((e, i) => <li key={i}>{e.path ? <><Mono>{e.path}</Mono>{" "}</> : null}{e.message}</li>)}</ul>
        </Notice>
      ) : null}
      {fail?.kind === "other" ? <Notice tone="danger" title="The model was not saved">{fail.message}</Notice> : null}
      {dirty && editable ? (
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <span className="m-text-body">Unsaved changes</span>
          <Input aria-label="Version note" placeholder="What changed" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button variant="primary" type="submit" disabled={save.isPending}>Save</Button>
          <Button variant="ghost" onClick={() => { setDoc(initial); setFail(null); }}>Discard</Button>
        </form>
      ) : null}

      <ChoiceGroup
        label="Show data on the model"
        showLabel
        value={overlayOn ? "run" : "none"}
        onChange={(v) => go({ overlay: v === "run" ? null : "none" })}
        options={[{ value: "run", label: "Selected run" }, { value: "none", label: "None" }]}
      />

      <div className="flex gap-6 flex-wrap">
        <Stat label="Activities" value={acts.length} delta={`${D.allL4(doc).length} sub-processes in ${doc.l1.length} processes.`} />
        <Stat label="No-go" value={ov ? count("red") : "—"} delta={noOverlay ?? (count("red") ? "Activities with a blocking failure." : "No activity is blocked.")} />
        <Stat label="At risk" value={ov ? count("amber") : "—"} delta={noOverlay ?? (count("amber") ? "Activities with some failing fields." : "No activity is at risk.")} />
        <Stat label="Discovered variants" value={p.latestId ? p.variants.length : "—"} delta={p.latestId ? "Document types found in the data." : "Run an analysis to discover variants."} />
        <Stat label="Unmapped" value={p.latestId ? unmapped.length : "—"}
          delta={p.latestId ? (unmapped.length ? "Found in the data, not on any sub-process." : "Every variant sits on a sub-process.") : "Run an analysis to find unmapped variants."} />
      </div>

      <div className="flex flex-col gap-4 md:flex-row">
        <aside className="w-full md:w-[320px] flex-shrink-0 flex flex-col gap-4" aria-label="Process tree">
          <ProcessTree doc={doc} selected={node} editable={editable} canDesign={canDesign} onBlocked={blocked} actions={actions}
            colour={(item, level) => (ov ? D.worstUnder(item, level, actColour) : null)}
            onSelect={(id) => go({ node: id, attr: null })} />
          {canDesign ? <Discovered variants={unmapped} onCreate={(g) => edit((d) => skeletonFrom(d, g))} /> : null}
        </aside>
        <section className="flex-1 min-w-0 overflow-x-auto" aria-label="Process view" data-tour="designer-canvas">
          {l4 ? (
            <>
              <div className="flex items-center justify-between gap-2 mb-2">
                <h2 className="m-text-h font-semibold m-ink">{l4.name}</h2>
                <Button variant="secondary" onClick={() => go({ attr: l4.id })}>Sub-process details</Button>
              </div>
              <DesignerCanvas key={l4.id} l4={l4} domain={domainOf(doc.l1.find((x) => D.locate({ ...doc, l1: [x] }, l4.id))?.modules[0])} overlay={ov} selected={attr} editable={editable} canDesign={canDesign} onBlocked={blocked}
                onSelect={(id) => go({ attr: id })}
                onMove={(id, x, y) => edit((d) => D.moveNode(d, l4.id, id, x, y))}
                onConnect={(s, t) => edit((d) => D.connect(d, l4.id, s, t))}
                onDeleteNode={(id, withAct) => edit((d) => D.removeNode(d, l4.id, id, withAct))}
                onDeleteFlow={(id) => edit((d) => D.removeFlow(d, l4.id, id))}
                onAdd={(type: NodeType) => {
                  if (!editable) return blocked();
                  const r = D.addNode(doc, l4.id, type);
                  setDoc(r.doc);
                  go({ attr: r.actId ?? r.nodeId });
                }}
                onLayout={() => edit((d) => D.autoLayout(d, l4.id))} />
            </>
          ) : (
            <LevelTable doc={doc} parent={parent} parentLevel={parentLevel} colour={actColour} actions={actions} editable={editable} canDesign={canDesign} onBlocked={blocked}
              onOpen={(id) => go({ node: id, attr: null })} />
          )}
        </section>
      </div>

      <AttributeDrawer doc={doc} attr={attr} editable={editable} canDesign={canDesign} onBlocked={blocked} onClose={() => go({ attr: null })}
        overlay={ov} unmapped={unmapped} canAdopt={editable && !dirty}
        onAdopt={(variantId, l4Id) => adopt.mutate({ variantId, l4Id })} findingHref={p.findingHref}
        patchActivity={(id, patch) => edit((d) => D.patchActivity(d, id, patch))}
        patchL4={(id, patch) => edit((d) => D.patchItem<L4>(d, id, patch))}
        patchNode={(l4Id, nodeId, label) => edit((d) => D.patchNode(d, l4Id, nodeId, { label }))}
        patchFlow={(l4Id, flowId, patch) => edit((d) => D.patchFlow(d, l4Id, flowId, patch))} />
    </div>
  );
}
