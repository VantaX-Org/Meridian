"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { exportFixSheet, importFixSheet, postAcceptAll, postSetValue } from "@/lib/api/v2/work";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { CHIPS, exportQueryOf, readState, viewFilters, type ChipId, type LedgerState } from "@/lib/v2/work";
import { useWorkSummary, useWorkViews } from "@/lib/v2/work-queries";
import {
  Button, Chip, Confirm, EmptyState, ErrorState, ExportMenu, Field, ImportDialog, Input, Select, Sheet, ShortcutSheet, Skeleton, Toggle,
  useSheet,
} from "@/ui/kit";
import { usePaletteContext } from "@/ui/kit/paletteContext";
import { CleanBoard } from "../CleanBoard";
import { CleaningQueue } from "../CleaningQueue";
import { Approvals } from "../Approvals";
import { Exceptions } from "../Exceptions";
import { ObjChip } from "../ObjChip";
import { SimulateSheet } from "../SimulateSheet";
import { Triage } from "../Triage";
import { useDo } from "../shared";
import { FixGrid } from "./FixGrid";
import { LoadFileDialog } from "./LoadFileDialog";
import { RuleRail } from "./RuleRail";
import { ScoreStrip } from "./ScoreStrip";
import { decidedByRule, isDraft } from "./fixlib";
import { useFixData } from "./useFixData";
import "./fix.css";

type Tool = "triage" | "exceptions" | "approvals" | "cleaning";
const TOOLS: Tool[] = ["cleaning", "approvals", "triage", "exceptions"];
const TOOL_LABEL: Record<Tool, () => string> = { cleaning: () => t("Cleaning queue"), approvals: () => t("Approvals"), triage: () => t("Triage"), exceptions: () => t("Exceptions") };

/**
 * The one fix screen. Scope pins it to one object (the object detail tab); the chips replace the old tabs. Triage, Exceptions,
 * Approvals and the cleaning queue stay reachable as tools in a sheet because their bulk actions have no chip equivalent.
 */
export function FixScreen({ scope }: { scope?: string }) {
  useInterfaceLang();
  const params = useSearchParams();
  const [state, setState] = useState<LedgerState>(() => { const s = readState(new URLSearchParams(params.toString())); return scope ? { ...s, module: scope } : s; });
  const [tool, setTool] = useState<Tool | null>(() => { const o = params.get("open"); return TOOLS.includes(o as Tool) ? (o as Tool) : null; });
  const [load, setLoad] = useState(false);
  const [sim, setSim] = useState(false);
  const [importing, setImporting] = useState(false);
  const [naming, setNaming] = useState(false);
  const [viewName, setViewName] = useState("");
  const [askAll, setAskAll] = useState(false);
  const [setTo, setSetTo] = useState("");
  const [onlyBlank, setOnlyBlank] = useState(true);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const sheets = useSheet();
  const run = useDo();
  const summary = useWorkSummary();
  const views = useWorkViews();
  const data = useFixData(state);
  const { q, all, rows, decide, readOnly, batchId } = data;

  const mod = scope ?? state.module ?? (() => { const m = new Set(all.map((r) => r.module)); return m.size === 1 ? [...m][0] : null; })();
  const drafts = useMemo(() => all.filter((r) => isDraft(r) && (!mod || r.module === mod)), [all, mod]);
  const decidedMap = useMemo(() => decidedByRule(all), [all]);
  // A rule is fully accepted when every loaded row of it is drafted and no more rows wait on the server.
  const fullRules = useMemo(() => {
    if (q.hasNextPage) return [];
    const by = new Map<string, { n: number; d: number }>();
    for (const r of all) for (const c of r.checks) { const e = by.get(c) ?? { n: 0, d: 0 }; e.n += 1; if (isDraft(r)) e.d += 1; by.set(c, e); }
    return [...by].filter(([, e]) => e.n > 0 && e.n === e.d).map(([c]) => c);
  }, [all, q.hasNextPage]);

  const pickRule = (id: string | null) => setState((s) => ({ ...s, rule: id, seg: null }));
  const chip = (id: ChipId) => setState((s) => ({ ...s, chip: id, seg: null }));
  const once = async (fn: () => Promise<unknown>) => { if (busy) return; setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const saveView = () => {
    const name = viewName.trim();
    if (!name) return;
    setNaming(false); setViewName("");
    void run(() => views.save({ route: "work", name, filters: viewFilters(state), columns: [], density: state.density }), () => t("View saved."));
  };
  const vs = views.data?.views ?? [];
  const sel = state.rule && !state.rule.includes(",") ? state.rule : null;

  const commands = useMemo(() => [
    { id: "fix-load", label: t("Create load file"), run: () => setLoad(true) },
    { id: "fix-clear", label: t("Show all rules"), run: () => pickRule(null) },
    ...CHIPS.map((c) => ({ id: `fix-chip-${c.id}`, label: c.label, run: () => chip(c.id) })),
  ], []);
  usePaletteContext(t("Fixes"), commands);

  const toolbar = (
    <div className="mx-links">
      <ExportMenu label={t("Export workbook")} formats={[{ id: "xlsx", label: t("Excel workbook") }]} onExport={() => exportFixSheet(exportQueryOf(state))} />
      <Button disabled={busy} onClick={() => setImporting(true)}>{t("Import workbook")}</Button>
      <ImportDialog open={importing} onClose={() => setImporting(false)} label={t("Import workbook")} closeLabel={t("Close")}
        accept=".xlsx" fileLabel={t("Choose the fix sheet")} hint={t("Drop the fix sheet you filled in.")} target={t("PROD")}
        apply={async (f) => {
          const r = await importFixSheet(f);
          await qc.invalidateQueries({ queryKey: ["v2"] });
          return t("{n} rows updated, {s} skipped.", { n: r.updated, s: r.skipped.length });
        }} />
      <Button variant="ghost" onClick={() => sheets.open("whatif", { module: state.module })}>{t("What if")}</Button>
      {all.length ? <Button variant="ghost" onClick={() => setSim(true)}>{t("Simulate fixing")}</Button> : null}
      <Button variant="ghost" onClick={() => setNaming(true)}>{t("Save this view")}</Button>
      {vs.length ? (
        <Select aria-label={t("Saved views")} value="" options={[{ value: "", label: t("Saved views") }, ...vs.map((v) => ({ value: v.id, label: v.name }))]}
          onChange={(e) => { const v = vs.find((x) => x.id === e.target.value); if (v) setState(readState(new URLSearchParams(), v)); }} />
      ) : null}
      {TOOLS.map((k) => <Button key={k} variant="ghost" onClick={() => setTool(k)}>{TOOL_LABEL[k]()}</Button>)}
    </div>
  );

  return (
    <div className="mx-fix" data-testid="fix-screen">
      <CleanBoard module={state.module} onReview={(id) => pickRule(id)} />
      <h2 className="mx-h2">{t("Fixes")}</h2>
      <p className="mx-muted">{mod ? <ObjChip code={mod} /> : t("Everything waiting for a decision")}</p>
      <ScoreStrip module={mod} drafts={drafts} fullRules={fullRules} onCreate={() => setLoad(true)} />
      <div className="mx-chips" role="group" aria-label={t("Work status")}>
        {CHIPS.map((c) => <Chip key={c.id} selected={state.chip === c.id} count={c.count(summary.data) ?? undefined} onClick={() => chip(c.id)}>{c.label}</Chip>)}
      </div>
      {toolbar}
      <div className="mx-fixlayout">
        <RuleRail module={mod} severity={state.severity ?? undefined} picked={sel} onPick={pickRule} decided={decidedMap} />
        <div className="mx-col">
          {sel ? (
            <div className="mx-fixbulk">
              <Button variant="secondary" disabled={busy} onClick={() => setAskAll(true)}>{t("Accept every proposed value")}</Button>
              <Field label={t("Or set one value for all")}><Input value={setTo} onChange={(e) => setSetTo(e.target.value)} /></Field>
              <Toggle label={t("Only where the field is empty")} checked={onlyBlank} onChange={setOnlyBlank} />
              <Button disabled={!setTo.trim() || busy} onClick={() => void once(() => run(() => postSetValue(sel, setTo, onlyBlank), (r) => t("{n} values set.", { n: r.updated ?? 0 })))}>{t("Set the value")}</Button>
            </div>
          ) : null}
          {q.isError ? <ErrorState heading={t("The records could not be loaded")} onRetry={() => void q.refetch()} retryLabel={t("Try again")} />
            : !q.isPending && !rows.length ? <EmptyState heading={t("No record matches")} body={t("Pick another status above.")} action={sel ? <Button onClick={() => pickRule(null)}>{t("Show all rules")}</Button> : undefined} />
            : q.isPending ? <Skeleton lines={6} label={t("Loading the records")} />
            : <FixGrid rows={rows} state={state} module={mod} drafts={drafts} fullRules={fullRules} loading={q.isFetching && !q.isFetchingNextPage}
                decide={readOnly ? () => undefined : (v) => decide.mutate(v)} hasMore={!!q.hasNextPage} loadingMore={q.isFetchingNextPage} onMore={() => void q.fetchNextPage()} />}
        </div>
      </div>
      <ShortcutSheet items={[
        { keys: "A", label: t("Accept") }, { keys: "R", label: t("Reject") }, { keys: "E", label: t("Edit") },
        { keys: "X", label: t("Select") }, { keys: "Shift+A", label: t("Accept all") }, { keys: "Ctrl+Z", label: t("Undo") },
      ]} />
      <LoadFileDialog open={load} onClose={() => setLoad(false)} count={drafts.length} batchId={batchId} />
      <Sheet open={tool !== null} onClose={() => setTool(null)} label={tool ? TOOL_LABEL[tool]() : ""} closeLabel={t("Close")}>
        {tool === "cleaning" ? <CleaningQueue /> : tool === "approvals" ? <Approvals /> : tool === "triage" ? <Triage /> : tool === "exceptions" ? <Exceptions /> : null}
      </Sheet>
      <Confirm open={naming} title={t("Name this view")} confirmLabel={t("Save this view")} cancelLabel={t("Cancel")} onConfirm={saveView} onCancel={() => { setNaming(false); setViewName(""); }}>
        <Field label={t("View name")}><Input value={viewName} onChange={(e) => setViewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveView(); }} /></Field>
        {viewName.trim() ? null : <p role="status" className="mx-muted">{t("A name is required.")}</p>}
      </Confirm>
      <SimulateSheet rows={all} open={sim} onClose={() => setSim(false)} />
      <Confirm open={askAll} title={t("Accept every proposed value?")} confirmLabel={t("Accept all")} cancelLabel={t("Cancel")}
        onConfirm={() => { setAskAll(false); if (sel) void once(() => run(() => postAcceptAll(sel), (r) => t("{n} fixes accepted. This cannot be undone here.", { n: r.accepted ?? r.updated ?? 0 }))); }} onCancel={() => setAskAll(false)}>
        <p>{sel ? t("Every record of {rule} with a proposed value gets that value. Each fix is logged.", { rule: sel }) : ""}</p>
      </Confirm>
    </div>
  );
}
