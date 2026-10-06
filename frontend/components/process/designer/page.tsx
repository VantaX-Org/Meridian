"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Banner, Button, EmptyState, FilterBar, Input, Mono, PageHeader, SegmentedControl, Select, TableSkeleton, Tally, useDrawerParam } from "@/components/ui-core";
import { useFindingHref, useLatestVersion } from "@/components/process/shared";
import {
  adoptVariant, createModel, getModel, getOverlay, getReference, listModels, listVariants, saveFailure, saveModel,
  signavioExportUrl, type SaveFailure,
} from "@/lib/api/process-designer";
import { downloadAuthenticated } from "@/lib/api/download";
import type { L4, ModelOverlay, ModelSummary, NodeType, ProcessModelDocument, ProcessVariant } from "@/types/process-model";
import { AttributeDrawer } from "./attributes";
import { DesignerCanvas } from "./canvas";
import { Discovered, skeletonFrom } from "./discovered";
import * as D from "./doc";
import { LevelTable } from "./level-table";
import { ProcessTree, type TreeActions } from "./tree";
import { OldVersionBanner, VersionsMenu } from "./versions";

const NEW_NAME = ["New process", "New process area", "New process group", "New sub-process"];

export function ProcessDesigner() {
  const sp = useSearchParams();
  const model = sp.get("model") ?? "reference";
  const v = sp.get("v");
  const overlayOn = sp.get("overlay") !== "none";
  const reference = model === "reference";

  const models = useQuery({ queryKey: ["pd.models"], queryFn: listModels });
  const ref = useQuery({ queryKey: ["pd.reference"], queryFn: getReference, enabled: reference });
  const saved = useQuery({ queryKey: ["pd.model", model, v], queryFn: () => getModel(model, v ? Number(v) : undefined), enabled: !reference });
  const { latest } = useLatestVersion();
  const overlay = useQuery({
    queryKey: ["pd.overlay", model, latest?.id], enabled: !reference && !!latest && overlayOn, retry: false, meta: { ignoreError: true },
    queryFn: () => getOverlay(model, latest!.id),
  });
  const variants = useQuery({
    queryKey: ["pd.variants", latest?.id], enabled: !!latest, retry: false, meta: { ignoreError: true },
    queryFn: () => listVariants(latest!.id),
  });
  const findingHref = useFindingHref(latest?.id);

  const doc = reference ? ref.data : saved.data?.document;
  const versionNo = reference ? 0 : saved.data?.version_no ?? 0;
  const currentVersion = reference ? 0 : saved.data?.model.current_version ?? 0;
  const failed = reference ? ref.error : saved.error;
  if (!doc) {
    return (
      <div className="ui-page">
        <PageHeader title="Process designer" summary="Design the process model and see where the data behind it breaks." />
        {failed ? <EmptyState>The process model could not be read. Check the model in the address bar, or open the reference model.</EmptyState> : <TableSkeleton rows={6} />}
      </div>
    );
  }
  return (
    <Editor key={`${model}:${v ?? ""}:${versionNo}`}
      model={model} initial={doc} versionNo={versionNo} currentVersion={currentVersion} viewingOld={!reference && versionNo !== currentVersion}
      models={models.data ?? []} overlay={overlayOn ? overlay.data ?? null : null} overlayOn={overlayOn}
      variants={variants.data ?? []} latestId={latest?.id} findingHref={findingHref} />
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
  findingHref: (module: string, checkId: string) => string | undefined;
}

function Editor(p: EditorProps) {
  const { model, initial, versionNo, currentVersion, viewingOld, overlay, overlayOn } = p;
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const qc = useQueryClient();
  const attr = useDrawerParam("attr");
  const node = sp.get("node");
  const reference = model === "reference";
  const editable = !reference && !viewingOld;

  const [doc, setDoc] = useState(initial);
  const [note, setNote] = useState("");
  const [fail, setFail] = useState<SaveFailure | null>(null);
  const [prompt, setPrompt] = useState(false);
  const [naming, setNaming] = useState<string | null>(null);
  const dirty = doc !== initial;

  const go = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, x] of Object.entries(patch)) { if (x) next.set(k, x); else next.delete(k); }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const refresh = () => ["pd.model", "pd.models", "pd.versions", "pd.overlay", "pd.variants"].forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));

  const create = useMutation({
    mutationFn: (a: { name: string; from: string }) => createModel(a.name, a.from),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: ["pd.models"] }); setNaming(null); setPrompt(false); go({ model: r.model.id, v: null, attr: null }); },
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
  });

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

  const blocked = () => { if (reference) setPrompt(true); };
  const edit = (fn: (d: ProcessModelDocument) => ProcessModelDocument) => { if (editable) setDoc(fn); else blocked(); };

  // What the URL points at.
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
  const noOverlay = ov ? undefined : "Open a saved model with an analysis to see this.";

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

  const exportZip = () => downloadAuthenticated(
    signavioExportUrl(model, viewingOld ? versionNo : undefined, overlayOn ? p.latestId : undefined), "process-model.zip");

  return (
    <div className="ui-page">
      <PageHeader title="Process designer"
        summary={reference ? "The shipped reference model, read-only. Create a model from it to edit." : `Version ${versionNo} of ${currentVersion}. Changes are saved as a new version.`}
        actions={
          <>
            <Select aria-label="Model" value={model} disabled={dirty}
              options={[{ value: "reference", label: "Reference model" }, ...p.models.map((m) => ({ value: m.id, label: m.name }))]}
              onValueChange={(m) => go({ model: m, v: null, attr: null, node: null })} />
            {!reference ? <VersionsMenu modelId={model} shown={viewingOld ? versionNo : null} onPick={(no) => go({ v: no ? String(no) : null })} /> : null}
            <Button variant="secondary" onClick={() => setNaming(naming === null ? "" : null)}>New model</Button>
            <Button variant="secondary" disabled={dirty} onClick={() => void exportZip()}>Export to Signavio</Button>
          </>
        } />

      {naming !== null ? (
        <form className="aurora-designer__bar" onSubmit={(e) => { e.preventDefault(); if (naming.trim()) create.mutate({ name: naming.trim(), from: model }); }}>
          <Input aria-label="Model name" autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} />
          <Button size="sm" variant="primary" type="submit" disabled={!naming.trim() || create.isPending}>Create from {reference ? "reference" : "this model"}</Button>
          <Button size="sm" variant="ghost" onClick={() => setNaming(null)}>Close</Button>
        </form>
      ) : null}

      {prompt ? (
        <Banner tone="info" title="Create a model from the reference to edit it"
          action={<><Button size="sm" variant="primary" disabled={create.isPending} onClick={() => create.mutate({ name: "My process model", from: "reference" })}>Create model</Button>{" "}<Button size="sm" variant="ghost" onClick={() => setPrompt(false)}>Not now</Button></>}>
          The reference model is shared and read-only.
        </Banner>
      ) : null}
      {viewingOld ? <OldVersionBanner viewing={versionNo} latest={currentVersion} busy={restore.isPending} onRestore={() => restore.mutate()} onLatest={() => go({ v: null })} /> : null}
      {fail?.kind === "stale" ? (
        <Banner tone="warning" title={`Someone saved version ${fail.current ?? "a newer one"} while you edited`}
          action={<><Button size="sm" variant="secondary" onClick={() => { setFail(null); setDoc(initial); refresh(); }}>Reload</Button>{" "}<Button size="sm" variant="secondary" disabled={copy.isPending} onClick={() => copy.mutate()}>Save as a copy</Button></>}>
          Reload to take their version, or save your changes as a copy.
        </Banner>
      ) : null}
      {fail?.kind === "invalid" ? (
        <Banner tone="danger" title="The model was not saved">
          <ul>{fail.errors.slice(0, 8).map((e, i) => <li key={i}>{e.path ? <><Mono>{e.path}</Mono>{" "}</> : null}{e.message}</li>)}</ul>
        </Banner>
      ) : null}
      {fail?.kind === "other" ? <Banner tone="danger" title="The model was not saved">{fail.message}</Banner> : null}
      {dirty && editable ? (
        <form className="aurora-designer__bar" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <span>Unsaved changes</span>
          <Input aria-label="Version note" placeholder="What changed" value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" variant="primary" type="submit" disabled={save.isPending}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => { setDoc(initial); setFail(null); }}>Discard</Button>
        </form>
      ) : null}

      <FilterBar>
        <span>Overlay</span>
        <SegmentedControl ariaLabel="Overlay" value={overlayOn ? "latest" : "none"}
          options={[{ id: "latest", label: "Latest analysis" }, { id: "none", label: "None" }]}
          onChange={(id) => go({ overlay: id === "none" ? "none" : null })} />
      </FilterBar>

      <Tally level={3} label="Process model" figures={[
        { label: "Activities", value: acts.length, href: `/process/designer?model=${model}`, verdict: `${D.allL4(doc).length} sub-processes in ${doc.l1.length} processes.` },
        { label: "Blocked", value: ov ? count("red") : null, href: "/process?tab=readiness", tone: count("red") ? "danger" : undefined,
          verdict: noOverlay ?? (count("red") ? "Activities with a blocking failure." : "No activity is blocked.") },
        { label: "Degraded", value: ov ? count("amber") : null, href: "/process?tab=readiness", tone: count("amber") ? "warning" : undefined,
          verdict: noOverlay ?? (count("amber") ? "Activities with some failing fields." : "No activity is degraded.") },
        { label: "Discovered variants", value: p.latestId ? p.variants.length : null, href: "/process",
          verdict: p.latestId ? "Document types found in the data." : "Run an analysis to discover variants." },
        { label: "Unmapped", value: p.latestId ? unmapped.length : null, href: `/process/designer?model=${model}#discovered`,
          verdict: p.latestId ? (unmapped.length ? "Found in the data, not on any sub-process." : "Every variant sits on a sub-process.") : "Run an analysis to find unmapped variants." },
      ]} />

      <div className="aurora-designer">
        <aside className="aurora-designer__rail" aria-label="Process tree">
          <ProcessTree doc={doc} selected={node} editable={editable} onBlocked={blocked} actions={actions}
            colour={(item, level) => (ov ? D.worstUnder(item, level, actColour) : null)}
            onSelect={(id) => go({ node: id, attr: null })} />
          <Discovered variants={unmapped} onCreate={(g) => edit((d) => skeletonFrom(d, g))} />
        </aside>
        <section className="aurora-designer__main" aria-label="Process view">
          {l4 ? (
            <>
              <div className="aurora-designer__bar">
                <h2 className="aurora-designer__rail-title">{l4.name}</h2>
                <Button size="sm" variant="secondary" onClick={() => attr.setValue(l4.id, { replace: true })}>Sub-process details</Button>
              </div>
              <DesignerCanvas key={l4.id} l4={l4} overlay={ov} selected={attr.value} editable={editable} onBlocked={blocked}
                onSelect={(id) => attr.setValue(id, { replace: true })}
                onMove={(id, x, y) => edit((d) => D.moveNode(d, l4.id, id, x, y))}
                onConnect={(s, t) => edit((d) => D.connect(d, l4.id, s, t))}
                onDeleteNode={(id, withAct) => edit((d) => D.removeNode(d, l4.id, id, withAct))}
                onDeleteFlow={(id) => edit((d) => D.removeFlow(d, l4.id, id))}
                onAdd={(type: NodeType) => {
                  if (!editable) return blocked();
                  const r = D.addNode(doc, l4.id, type);
                  setDoc(r.doc);
                  attr.setValue(r.actId ?? r.nodeId, { replace: true });
                }}
                onLayout={() => edit((d) => D.autoLayout(d, l4.id))} />
            </>
          ) : (
            <LevelTable doc={doc} parent={parent} parentLevel={parentLevel} colour={actColour} actions={actions} editable={editable} onBlocked={blocked}
              onOpen={(id) => go({ node: id, attr: null })} />
          )}
        </section>
      </div>

      <AttributeDrawer doc={doc} attr={attr.value} editable={editable} onBlocked={blocked} onClose={attr.close}
        overlay={ov} unmapped={unmapped} canAdopt={editable && !dirty}
        onAdopt={(variantId, l4Id) => adopt.mutate({ variantId, l4Id })} findingHref={p.findingHref}
        patchActivity={(id, patch) => edit((d) => D.patchActivity(d, id, patch))}
        patchL4={(id, patch) => edit((d) => D.patchItem<L4>(d, id, patch))}
        patchNode={(l4Id, nodeId, label) => edit((d) => D.patchNode(d, l4Id, nodeId, { label }))}
        patchFlow={(l4Id, flowId, patch) => edit((d) => D.patchFlow(d, l4Id, flowId, patch))} />
    </div>
  );
}
