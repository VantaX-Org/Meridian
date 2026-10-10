"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, Mono, Select, Skeleton, Stat } from "@/design";
import { useFindingHref, useLatestVersion } from "@/components/process/shared";
import {
  adoptVariant, createModel, getModel, getOverlay, getReference, listModels, listVariants, saveFailure, saveModel,
  signavioExportUrl, type SaveFailure,
} from "@/lib/api/process-designer";
import { downloadAuthenticated } from "@/lib/api/download";
import { apiErrorMessage } from "@/lib/error";
import { queryKeys } from "@/lib/query-keys";
import type { L4, ModelOverlay, ModelSummary, NodeType, ProcessModelDocument, ProcessVariant } from "@/types/process-model";
import { AttributeDrawer } from "./_components/attributes";
import { DesignerCanvas } from "./_components/canvas";
import { Discovered, skeletonFrom } from "./_components/discovered";
import * as D from "./_components/doc";
import { LevelTable } from "./_components/level-table";
import { ProcessTree, type TreeActions } from "./_components/tree";
import { OldVersionBanner, VersionsMenu } from "./_components/versions";

const NEW_NAME = ["New process", "New process area", "New process group", "New sub-process"];

function Banner({ tone, title, children, action }: { tone: "info" | "warning" | "danger"; title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  const border = tone === "danger" ? "var(--m-critical)" : tone === "warning" ? "var(--m-warning)" : "var(--m-line)";
  return (
    <div className="rounded border p-3 flex items-start justify-between gap-3" style={{ borderColor: border, background: "var(--m-sheet-2)" }}>
      <div>
        <strong>{title}</strong>
        {children ? <div className="ui-note">{children}</div> : null}
      </div>
      {action ? <span className="flex gap-2">{action}</span> : null}
    </div>
  );
}

export default function ProcessDesigner() {
  const sp = useSearchParams();
  const model = sp.get("model") ?? "reference";
  const v = sp.get("v");
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
      <div className="flex flex-col gap-4 p-6">
        <div>
          <h2 className="text-[22px] font-semibold">Process designer</h2>
          <p style={{ color: "var(--m-ink-2)" }}>Design the process model and see where the data behind it breaks.</p>
        </div>
        {failed ? (
          <ErrorState message={apiErrorMessage(failed)}
            onRetry={() => void (reference ? ref.refetch() : saved.refetch())} />
        ) : <Skeleton height={240} />}
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
  const attr = sp.get("attr");
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
  const refresh = () => {
    [queryKeys.processModelAll(), queryKeys.processModels(), queryKeys.processModelVersionsAll(), queryKeys.processOverlayAll(), queryKeys.processVariantsAll()]
      .forEach((queryKey) => void qc.invalidateQueries({ queryKey }));
  };

  const create = useMutation({
    mutationFn: (a: { name: string; from: string }) => createModel(a.name, a.from),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: queryKeys.processModels() }); setNaming(null); setPrompt(false); go({ model: r.model.id, v: null, attr: null }); },
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
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-[22px] font-semibold">Process designer</h2>
          <p style={{ color: "var(--m-ink-2)" }}>
            {reference ? "The shipped reference model, read-only. Create a model from it to edit." : `Version ${versionNo} of ${currentVersion}. Changes are saved as a new version.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={model}
            options={[{ value: "reference", label: "Reference model" }, ...p.models.map((m) => ({ value: m.id, label: m.name }))]}
            onValueChange={(m) => !dirty && go({ model: m, v: null, attr: null, node: null })} />
          {!reference ? <VersionsMenu modelId={model} shown={viewingOld ? versionNo : null} onPick={(no) => go({ v: no ? String(no) : null })} /> : null}
          <Button variant="secondary" onClick={() => setNaming(naming === null ? "" : null)}>New model</Button>
          <Button variant="secondary" disabled={dirty} onClick={() => void exportZip()}>Export to Signavio</Button>
        </div>
      </div>

      {naming !== null ? (
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (naming.trim()) create.mutate({ name: naming.trim(), from: model }); }}>
          <input aria-label="Model name" autoFocus value={naming} onChange={(e) => setNaming(e.target.value)}
            className="rounded border px-2 py-1 text-[13px]" style={{ borderColor: "var(--m-line)" }} />
          <Button variant="primary" type="submit" disabled={!naming.trim() || create.isPending}>Create from {reference ? "reference" : "this model"}</Button>
          <Button variant="ghost" onClick={() => setNaming(null)}>Close</Button>
        </form>
      ) : null}

      {prompt ? (
        <Banner tone="info" title="Create a model from the reference to edit it"
          action={<><Button variant="primary" disabled={create.isPending} onClick={() => create.mutate({ name: "My process model", from: "reference" })}>Create model</Button><Button variant="ghost" onClick={() => setPrompt(false)}>Not now</Button></>}>
          The reference model is shared and read-only.
        </Banner>
      ) : null}
      {viewingOld ? <OldVersionBanner viewing={versionNo} latest={currentVersion} busy={restore.isPending} onRestore={() => restore.mutate()} onLatest={() => go({ v: null })} /> : null}
      {fail?.kind === "stale" ? (
        <Banner tone="warning" title={`Someone saved version ${fail.current ?? "a newer one"} while you edited`}
          action={<><Button variant="secondary" onClick={() => { setFail(null); setDoc(initial); refresh(); }}>Reload</Button><Button variant="secondary" disabled={copy.isPending} onClick={() => copy.mutate()}>Save as a copy</Button></>}>
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
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
          <span>Unsaved changes</span>
          <input aria-label="Version note" placeholder="What changed" value={note} onChange={(e) => setNote(e.target.value)}
            className="rounded border px-2 py-1 text-[13px]" style={{ borderColor: "var(--m-line)" }} />
          <Button variant="primary" type="submit" disabled={save.isPending}>Save</Button>
          <Button variant="ghost" onClick={() => { setDoc(initial); setFail(null); }}>Discard</Button>
        </form>
      ) : null}

      <div className="flex items-center gap-2">
        <span>Overlay</span>
        <Button variant={overlayOn ? "primary" : "secondary"} onClick={() => go({ overlay: null })}>Latest analysis</Button>
        <Button variant={!overlayOn ? "primary" : "secondary"} onClick={() => go({ overlay: "none" })}>None</Button>
      </div>

      <div className="flex gap-6 flex-wrap">
        <Stat label="Activities" value={acts.length} delta={`${D.allL4(doc).length} sub-processes in ${doc.l1.length} processes.`} />
        <Stat label="Blocked" value={ov ? count("red") : "—"} delta={noOverlay ?? (count("red") ? "Activities with a blocking failure." : "No activity is blocked.")} />
        <Stat label="Degraded" value={ov ? count("amber") : "—"} delta={noOverlay ?? (count("amber") ? "Activities with some failing fields." : "No activity is degraded.")} />
        <Stat label="Discovered variants" value={p.latestId ? p.variants.length : "—"} delta={p.latestId ? "Document types found in the data." : "Run an analysis to discover variants."} />
        <Stat label="Unmapped" value={p.latestId ? unmapped.length : "—"}
          delta={p.latestId ? (unmapped.length ? "Found in the data, not on any sub-process." : "Every variant sits on a sub-process.") : "Run an analysis to find unmapped variants."} />
      </div>

      <div className="flex flex-col gap-4 md:flex-row">
        <aside className="w-full md:w-[320px] flex-shrink-0 flex flex-col gap-4" aria-label="Process tree">
          <ProcessTree doc={doc} selected={node} editable={editable} onBlocked={blocked} actions={actions}
            colour={(item, level) => (ov ? D.worstUnder(item, level, actColour) : null)}
            onSelect={(id) => go({ node: id, attr: null })} />
          <Discovered variants={unmapped} onCreate={(g) => edit((d) => skeletonFrom(d, g))} />
        </aside>
        <section className="flex-1 min-w-0 overflow-x-auto" aria-label="Process view">
          {l4 ? (
            <>
              <div className="flex items-center justify-between gap-2 mb-2">
                <h2 className="text-[17px] font-semibold">{l4.name}</h2>
                <Button variant="secondary" onClick={() => go({ attr: l4.id })}>Sub-process details</Button>
              </div>
              <DesignerCanvas key={l4.id} l4={l4} overlay={ov} selected={attr} editable={editable} onBlocked={blocked}
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
            <LevelTable doc={doc} parent={parent} parentLevel={parentLevel} colour={actColour} actions={actions} editable={editable} onBlocked={blocked}
              onOpen={(id) => go({ node: id, attr: null })} />
          )}
        </section>
      </div>

      <AttributeDrawer doc={doc} attr={attr} editable={editable} onBlocked={blocked} onClose={() => go({ attr: null })}
        overlay={ov} unmapped={unmapped} canAdopt={editable && !dirty}
        onAdopt={(variantId, l4Id) => adopt.mutate({ variantId, l4Id })} findingHref={p.findingHref}
        patchActivity={(id, patch) => edit((d) => D.patchActivity(d, id, patch))}
        patchL4={(id, patch) => edit((d) => D.patchItem<L4>(d, id, patch))}
        patchNode={(l4Id, nodeId, label) => edit((d) => D.patchNode(d, l4Id, nodeId, { label }))}
        patchFlow={(l4Id, flowId, patch) => edit((d) => D.patchFlow(d, l4Id, flowId, patch))} />
    </div>
  );
}
