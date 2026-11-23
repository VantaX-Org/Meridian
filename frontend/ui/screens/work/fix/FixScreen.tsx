"use client";

import { useMemo, useState } from "react";
import type { WorkRow } from "@/lib/api/v2/types";
import { formatDate, formatModuleName } from "@/lib/format";
import { useStatus } from "@/lib/v2/queries";
import { useCurrentSystem } from "@/ui/shell/global";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { exportFixSheet, importFixSheet, postAcceptAll, postSetValue } from "@/lib/api/v2/work";
import { t, useInterfaceLang } from "@/lib/v2/i18n";
import { CHIPS, exportQueryOf, readState, viewFilters, type ChipId, type LedgerState } from "@/lib/v2/work";
import { useWorkGroups, useWorkViews } from "@/lib/v2/work-queries";
import {
  ActionMenu, Button, Chip, Confirm, CycleStepper, EmptyState, ErrorState, ExportMenu, Field, ImportDialog, Input, Sheet, ShortcutSheet, Skeleton, Toggle,
  useSheet,
} from "@/ui/kit";
import { useAletheiaScope } from "@/ui/kit/aletheia";
import { usePaletteContext } from "@/ui/kit/paletteContext";
import { CleanBoard } from "../CleanBoard";
import { CleaningQueue } from "../CleaningQueue";
import { Approvals } from "../Approvals";
import { Exceptions } from "../Exceptions";
import { SimulateSheet } from "../SimulateSheet";
import { Triage } from "../Triage";
import { useDo } from "../shared";
import { acceptable, FixGrid } from "./FixGrid";
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
  const [state, setState] = useState<LedgerState>(() => { const s = readState(new URLSearchParams(params.toString())); const base = scope ? { ...s, module: scope } : s; return base.chip === "tofix" && !base.seg ? { ...base, chip: null } : base; });
  const [tool, setTool] = useState<Tool | null>(() => { const o = params.get("open"); return TOOLS.includes(o as Tool) ? (o as Tool) : null; });
  const [board, setBoard] = useState(false);
  const [load, setLoad] = useState(false);
  const [sim, setSim] = useState(false);
  const [importing, setImporting] = useState(false);
  const [naming, setNaming] = useState(false);
  const [viewName, setViewName] = useState("");
  const [askAll, setAskAll] = useState(false);
  const [setTo, setSetTo] = useState("");
  const [onlyBlank, setOnlyBlank] = useState(true);
  const [busy, setBusy] = useState(false);
  const [setOne, setSetOne] = useState(false);
  const [preview, setPreview] = useState<WorkRow[] | null>(null);
  const qc = useQueryClient();
  const sheets = useSheet();
  const run = useDo();
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
  const CARD_CHIPS: { id: string; label: () => string; on: (s: LedgerState) => boolean; set: Partial<LedgerState> }[] = [
    { id: "all", label: () => t("All"), on: (s) => !s.chip && !s.seg, set: { chip: null, seg: null } },
    { id: "proposal", label: () => t("With a proposal"), on: (s) => s.seg === "proposed", set: { chip: null, seg: "proposed" } },
    { id: "person", label: () => t("Needs a person"), on: (s) => s.seg === "manual", set: { chip: null, seg: "manual" } },
    { id: "decided", label: () => t("Decided"), on: (s) => s.chip === "approvals", set: { chip: "approvals", seg: null } },
  ];
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

  const { current: system } = useCurrentSystem();
  const status = useStatus().data;
  const sysRun = status?.systems?.find((x) => x.system_id === system?.id) ?? status?.systems?.[0];
  const obj = mod ? sysRun?.objects.find((o) => o.module === mod) : undefined;
  const runNo = obj?.run_number ?? sysRun?.run_number ?? null;
  const runAt = obj?.run_at ?? sysRun?.run_at ?? null;
  const groups = useWorkGroups({ module: mod ?? undefined, severity: state.severity ?? undefined }, true).data?.groups;
  const rule = sel ? groups?.find((g) => g.check_id === sel) : undefined;
  const left = rule ? Math.max(0, rule.records - (decidedMap.get(rule.check_id) ?? 0)) : null;
  const proposals = acceptable(rows).length;
  useAletheiaScope({
    key: "fix", label: rule ? t("Rule {id}", { id: rule.check_id }) : mod ? formatModuleName(mod) : t("Fix records"),
    suggestions: [t("Which rule should I fix first?"), t("Why is this value wrong?")],
  });
  const cardHead = (
    <div className="mx-fixcard-h" data-testid="fix-card-head">
      <div className="mx-fixcard-r">
        {rule ? (
          <p className="mx-fixcard-t" data-testid="rule-head">
            <code className="mx-code">{rule.check_id}</code> <span>{rule.message ?? ""}</span>
            {rule.field ? <span className="mx-muted"> {t("Field {f}", { f: rule.field })}</span> : null}
            <span className="mx-muted"> {t("{n} failing", { n: rule.records })}, {t("{n} left after drafts", { n: left ?? 0 })}</span>
          </p>
        ) : <p className="mx-fixcard-t">{t("All rules over tolerance")}</p>}
      </div>
      <div className="mx-fixcard-b">
        <div className="mx-chips" role="group" aria-label={t("Show")}>
          {CARD_CHIPS.map((c) => <Chip key={c.id} selected={c.on(state)} onClick={() => setState((x) => ({ ...x, ...c.set }))}>{c.label()}</Chip>)}
        </div>
        <span className="mx-fixcard-act">
          <Button variant="secondary" disabled={busy || !proposals} onClick={() => setPreview(acceptable(rows))}>{t("Apply all {n} proposals", { n: proposals })} <kbd className="mx-kbd">Shift A</kbd></Button>
          <Button variant="ghost" disabled={busy || !sel} onClick={() => setSetOne(true)}>{t("Set one value for selected")}</Button>
        </span>
      </div>
    </div>
  );

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
      <ActionMenu label={t("More tools")} items={[
        { id: "whatif", label: t("What if"), onClick: () => sheets.open("whatif", { module: state.module }) },
        { id: "simulate", label: t("Simulate fixing"), disabled: !all.length, onClick: () => setSim(true) },
        ...(sel ? [{ id: "acceptrule", label: t("Accept every proposed value"), disabled: busy, onClick: () => setAskAll(true) }] : []),
        { id: "save", label: t("Save this view"), onClick: () => setNaming(true) },
        ...vs.map((v) => ({ id: `view-${v.id}`, label: t("Saved view: {name}", { name: v.name }), onClick: () => setState(readState(new URLSearchParams(), v)) })),
        ...TOOLS.map((k) => ({ id: k, label: TOOL_LABEL[k](), onClick: () => setTool(k) })),
      ]} />
      <ShortcutSheet triggerLabel={t("Shortcuts")} items={[
        { keys: "A", label: t("Accept") }, { keys: "R", label: t("Reject") }, { keys: "E", label: t("Edit") },
        { keys: "X", label: t("Select") }, { keys: "Shift+A", label: t("Accept all") }, { keys: "Ctrl+Z", label: t("Undo") },
      ]} />
    </div>
  );

  return (
    <div className="mx-fix" data-testid="fix-screen">
      <div className="mx-fixrun">
        <div className="mx-fixrun-l" data-testid="run-line">
          <span>{system?.name ?? ""}</span>{system ? <span aria-hidden="true"> / </span> : null}
          <strong>{mod ? formatModuleName(mod) : t("All objects")}</strong><span aria-hidden="true"> / </span><h1 className="mx-fixrun-h">{t("Fix records")}</h1>
          {runNo !== null ? <span className="mx-muted">{" "}{t("Run {n}", { n: runNo })}{runAt ? `, ${formatDate(runAt)}` : ""}</span> : null}
        </div>
        <CycleStepper label={t("Cycle steps")} step="clean" labels={{ pull: t("Pull"), clean: t("Clean"), upload: t("Upload"), score: t("Re-score"), compare: t("Compare") }} />
        <Button variant="ghost" aria-expanded={board} aria-controls="fix-board" onClick={() => setBoard((v) => !v)}>{board ? t("Hide the clean board") : t("Show the clean board")}</Button>
      </div>
      {board ? <div id="fix-board"><h2 className="mx-h2">{t("Clean cycle")}</h2><CleanBoard module={state.module} onReview={(id) => pickRule(id)} /></div> : null}
      <ScoreStrip module={mod} drafts={drafts} fullRules={fullRules} onCreate={() => setLoad(true)} />
      {toolbar}
      <div className="mx-fixlayout">
        <RuleRail module={mod} severity={state.severity ?? undefined} picked={sel} onPick={pickRule} decided={decidedMap} />
        <div className="mx-col">
          {q.isError || q.isPending || !rows.length ? (
            <div className="mx-fixgrid-main">
              {cardHead}
              {q.isError ? <ErrorState heading={t("The records could not be loaded")} onRetry={() => void q.refetch()} retryLabel={t("Try again")} />
                : q.isPending ? <Skeleton lines={6} label={t("Loading the records")} />
                : <EmptyState heading={t("No record matches")} body={t("Pick another status above.")} action={sel ? <Button onClick={() => pickRule(null)}>{t("Show all rules")}</Button> : undefined} />}
            </div>
          ) : <FixGrid rows={rows} state={state} module={mod} drafts={drafts} fullRules={fullRules} loading={q.isFetching && !q.isFetchingNextPage}
                decide={readOnly ? () => undefined : (v) => decide.mutate(v)} hasMore={!!q.hasNextPage} loadingMore={q.isFetchingNextPage} onMore={() => void q.fetchNextPage()} preview={preview} setPreview={setPreview} head={cardHead} />}
        </div>
      </div>
      <LoadFileDialog open={load} onClose={() => setLoad(false)} count={drafts.length} batchId={batchId} />
      <Sheet open={tool !== null} onClose={() => setTool(null)} label={tool ? TOOL_LABEL[tool]() : ""} closeLabel={t("Close")}>
        {tool === "cleaning" ? <CleaningQueue /> : tool === "approvals" ? <Approvals /> : tool === "triage" ? <Triage /> : tool === "exceptions" ? <Exceptions /> : null}
      </Sheet>
      <Confirm open={naming} title={t("Name this view")} confirmLabel={t("Save this view")} cancelLabel={t("Cancel")} onConfirm={saveView} onCancel={() => { setNaming(false); setViewName(""); }}>
        <Field label={t("View name")}><Input value={viewName} onChange={(e) => setViewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveView(); }} /></Field>
        {viewName.trim() ? null : <p role="status" className="mx-muted">{t("A name is required.")}</p>}
      </Confirm>
      <Confirm open={setOne} title={t("Set one value for selected")} confirmLabel={t("Set the value")} cancelLabel={t("Cancel")}
        onConfirm={() => { setSetOne(false); if (sel && setTo.trim()) void once(() => run(() => postSetValue(sel, setTo, onlyBlank), (r) => t("{n} values set.", { n: r.updated ?? 0 }))); }} onCancel={() => setSetOne(false)}>
        <Field label={t("Or set one value for all")}><Input value={setTo} onChange={(e) => setSetTo(e.target.value)} /></Field>
        <Toggle label={t("Only where the field is empty")} checked={onlyBlank} onChange={setOnlyBlank} />
      </Confirm>
      <SimulateSheet rows={all} open={sim} onClose={() => setSim(false)} />
      <Confirm open={askAll} title={t("Accept every proposed value?")} confirmLabel={t("Accept all")} cancelLabel={t("Cancel")}
        onConfirm={() => { setAskAll(false); if (sel) void once(() => run(() => postAcceptAll(sel), (r) => t("{n} fixes accepted. This cannot be undone here.", { n: r.accepted ?? r.updated ?? 0 }))); }} onCancel={() => setAskAll(false)}>
        <p>{sel ? t("Every record of {rule} with a proposed value gets that value. Each fix is logged.", { rule: sel }) : ""}</p>
      </Confirm>
    </div>
  );
}
